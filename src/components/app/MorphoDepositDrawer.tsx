"use client";

import { useEffect, useState } from "react";
import { NumericFormat } from "react-number-format";
import { Button } from "../ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  useAccount,
  useConnect,
  useWriteContract,
  useReadContract,
} from "wagmi";
import { parseUnits } from "viem";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { erc20Abi } from "viem";
import { base } from "viem/chains";
import {
  DEPOSIT_CONTRACT_ABI,
  BASE_DEPOSIT_CONTRACT_ADDR,
  WITHDRAW_CONTRACT_ABI,
  BASE_WITHDRAW_CONTRACT_ADDR,
  BASE_USDC_ADDR,
  BASE_CHAIN_ID,
} from "@/chain/yield";
import { useBalance } from "@/chain/balance";
import { formatDistanceToNow } from "date-fns";
import { sdk } from "@farcaster/frame-sdk";

const USDC_DECIMALS = 6;

export function AaveDepositDrawer({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { writeContractAsync } = useWriteContract();

  const [amount, setAmount] = useState("1");
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const parsedAmount = parseFloat(amount);
  const isDisabled = sending || !parsedAmount || parsedAmount <= 0;
  const rawAmount =
    parsedAmount && !isNaN(parsedAmount)
      ? parseUnits(amount, USDC_DECIMALS)
      : 0n;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: BASE_USDC_ADDR,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address ?? "0x", BASE_DEPOSIT_CONTRACT_ADDR],
    query: {
      enabled: !!address && rawAmount > 0n,
    },
  });

  const [isApproved, setIsApproved] = useState(false);
  const [lastAction, setLastAction] = useState<"deposit" | "withdraw" | null>(
    null
  );

  useEffect(() => {
    if (isOpen && !isConnected) {
      connect({ connector: farcasterFrame() });
    }
  }, [isOpen, isConnected, connect]);

  const { balance, transactions, refetch } = useBalance({ address });
  console.log("transactions", transactions);

  useEffect(() => {
    if (isOpen) {
      refetch();
    }
  }, [isOpen, refetch]);
  


  useEffect(() => {
    if (allowance !== undefined) {
      setIsApproved(allowance >= rawAmount);
    }
  }, [allowance, rawAmount]);

  const handleApprove = async () => {
    if (!isConnected) await connect({ connector: farcasterFrame() });
    if (!address) return;

    try {
      setSending(true);
      await writeContractAsync({
        address: BASE_USDC_ADDR,
        abi: erc20Abi,
        functionName: "approve",
        args: [BASE_DEPOSIT_CONTRACT_ADDR, rawAmount],
        chainId: base.id,
      });
      await refetchAllowance?.();
      setIsApproved(true);
    } catch (e) {
      console.error("Approval failed", e);
    } finally {
      setSending(false);
    }
  };

  const handleDeposit = async () => {
    if (!isConnected) await connect({ connector: farcasterFrame() });
    if (!address) return;

    try {
      setSending(true);
      const tx = await writeContractAsync({
        address: BASE_DEPOSIT_CONTRACT_ADDR,
        abi: DEPOSIT_CONTRACT_ABI,
        functionName: "deposit",
        args: [address],
        chainId: base.id,
      });
      setTxHash(tx);
      setSuccess(true);
      await refetch();
    } catch (e) {
      console.error("Deposit failed", e);
    } finally {
      setSending(false);
      setLastAction("deposit");
    }
  };

  const handleWithdraw = async (amountToWithdraw: number) => {
    if (!isConnected) await connect({ connector: farcasterFrame() });
    if (!address || !balance || balance <= 0 || amountToWithdraw <= 0) return;

    try {
      setSending(true);

      const amountInWei = parseUnits(amountToWithdraw.toString(), 6);

      const tx = await writeContractAsync({
        address: BASE_WITHDRAW_CONTRACT_ADDR,
        abi: WITHDRAW_CONTRACT_ABI,
        functionName: "withdraw",
        args: [BASE_USDC_ADDR, amountInWei, address],
        chainId: base.id,
      });

      setTxHash(tx);
      setSuccess(true);
      setLastAction("withdraw");
      await refetch();
    } catch (e) {
      console.error("Withdraw failed", e);
    } finally {
      setSending(false);
    }
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="top-[110px] md:top-1/2 p-4 md:w-[min(92vw,560px)] md:max-w-none max-h-[calc(100dvh-110px)] md:max-h-[85vh] overflow-y-auto">
        <div className="scroll-smooth space-y-4">
          <ResponsiveDialogTitle className="text-lg text-center font-medium">
            <div className="flex flex-col items-center">
              <div className="text-2xl mb-6 relative w-16 h-16 rounded-full bg-green-200 text-purple-800 flex items-center justify-center">
                💸
              </div>
            </div>
            Earn up to{" "}
            <a
              className="text-green-400"
              onClick={(e) => {
                e.preventDefault();
                sdk.actions.openUrl(
                  "https://app.aave.com/reserve-overview/?underlyingAsset=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913&marketName=proto_base_v3"
                );
              }}
            >
              5.3%
            </a>{" "}
            yield on USDC
          </ResponsiveDialogTitle>

          <div className="flex flex-col text-center">
            <p className="text-white/50 px-12 text-md mb-6">
              Deposit USDC to earn yield. Use earned rewards across other mini
              apps.
            </p>

            <NumericFormat
              inputMode="decimal"
              pattern="[0-9]*"
              value={amount}
              onValueChange={(values) => setAmount(values.value)}
              onFocus={() => {
                if (amount === "0") setAmount("");
              }}
              thousandSeparator
              allowNegative={false}
              allowLeadingZeros={false}
              decimalScale={4}
              prefix="$"
              placeholder="0"
              className={`leading-none text-5xl bg-transparent text-center font-medium outline-none w-full placeholder-white/20 ${
                amount === "" || amount === "0"
                  ? "text-white/20"
                  : "text-primary"
              }`}
            />
          </div>

          {/* <p className="hidden text-center mt-2 opacity-30 text-sm">Upgrading, check later...</p> */}

          {!isApproved ? (
            <Button
              onClick={handleApprove}
              disabled={isDisabled || sending}
              className="w-full bg-primary"
            >
              {sending ? `Approving...` : `Approve`}
            </Button>
          ) : (
            <Button
              onClick={handleDeposit}
              disabled={isDisabled || sending}
              className="w-full bg-primary"
            >
              {sending ? `Depositing ${amount}...` : `Deposit`}
            </Button>
          )}
          {balance === undefined ? (
            <p className="text-center text-white/40 text-sm">
              Loading balance... {address} {balance}
            </p>
          ) : balance > 0 ? (
            <Button
              onClick={() => handleWithdraw(balance)}
              disabled={sending}
              className="w-full bg-secondary text-white"
            >
              {sending ? "Withdrawing..." : "Withdraw All"}
            </Button>
          ) : (
            <p className="text-center text-white/40 text-sm">
              Nothing to withdraw yet
            </p>
          )}

          <div className="pt-4">
            <p className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
              {transactions.filter((t) => t.type === "deposit").length === 0
                ? "No deposits yet"
                : "Recent deposits"}
            </p>
            <div className="divide-y divide-white/10">
              {transactions
                .filter((t) => t.type === "deposit")
                .sort((a, b) => b.timestamp - a.timestamp)
                .map((deposit, i) => (
                  <a
                    key={i}
                    href={deposit.url}
                    onClick={(e) => {
                      e.preventDefault();
                      sdk.actions.openUrl(deposit.url);
                    }}
                    className="flex justify-between text-sm py-3 px-2 rounded hover:bg-white/5 transition-colors"
                  >
                    <span className="text-white/80">
                      ${deposit.amountUsd.toFixed(2)}
                    </span>
                    <span className="text-white/40">
                      {formatDistanceToNow(deposit.timestamp * 1000, {
                        addSuffix: true,
                      })}
                    </span>
                  </a>
                ))}
            </div>
          </div>

          {success && txHash && (
            <p className="text-center text-green-400 text-sm mt-2">
              {lastAction === "withdraw"
                ? "Withdrawal successful!"
                : "Deposit successful!"}

              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                View on explorer
              </a>
            </p>
          )}

          <div className="hidden">
            <p className="ml-2 mt-6 text-center text-sm opacity-30">
              Featured Mini Apps
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-3 gap-3 pt-4">
              {/* Card 1 */}
              <div className="bg-[#121212] rounded-xl p-4 flex flex-col items-center text-center">
                <img
                  src="/amps.jpeg"
                  alt="Stable Finance"
                  className="w-16 h-16 rounded-2xl mb-3"
                />
                <p className="text-white text-sm font-medium mb-2">Amps</p>
                <Button className="py-2 rounded-[8px] px-3 mt-1 text-sm bg-white/5 text-white/30">
                  Amplify
                </Button>
              </div>

              {/* Card 2 */}
              <div className="bg-[#121212] rounded-xl p-4 flex flex-col items-center text-center">
                <img
                  src="/megapot.jpg"
                  alt="Nook Savings App"
                  className="w-16 h-16 rounded-2xl mb-3"
                />
                <p className="text-white text-sm font-medium mb-2">Megapot</p>
                <Button className="py-2 rounded-[8px] px-3 mt-1 text-sm bg-white/5 text-white/30">
                  Bet
                </Button>
              </div>

              {/* Card 3 */}
              <div className="bg-[#121212] rounded-xl p-4 flex flex-col items-center text-center">
                <img
                  src="/tipr.png"
                  alt="Nook Savings App"
                  className="w-16 h-16 rounded-2xl mb-3"
                />
                <p className="text-white text-sm font-medium mb-2">Tipr</p>
                <Button className="py-2 rounded-[8px] px-3 mt-1 text-sm bg-white/5 text-white/30">
                  Tip
                </Button>
              </div>
            </div>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
