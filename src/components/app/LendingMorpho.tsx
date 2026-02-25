"use client";

import { useEffect, useState } from "react";
import { NumericFormat } from "react-number-format";
import sdk from "@farcaster/frame-sdk";
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
import {
  parseUnits,
  formatUnits,
  createPublicClient,
  http,
  erc20Abi,
} from "viem";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import "@morpho-org/blue-sdk-viem/lib/augment/MarketParams";
import { base } from "viem/chains";
import { erc4626Abi } from "viem";
import { SuccessShareDrawer } from "@/components/app/SuccessShareDrawer";
import { LoaderCircle } from "lucide-react";

import { toast } from "sonner";

import clsx from "clsx";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;
const VAULT_ADDRESS = "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca";

const client = createPublicClient({
  chain: base,
  transport: http(),
});

export function MorphoDepositDrawer({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { writeContractAsync } = useWriteContract();

  const [amount, setAmount] = useState("10");
  const [isCustomInput, setIsCustomInput] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [sending, setSending] = useState(false);

  const [txHash, setTxHash] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isApproved, setIsApproved] = useState(false);

  const parsedAmount = parseFloat(amount);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const exceedsBalance = usdcBalance !== null && parsedAmount > usdcBalance;
  const isDisabled =
    isDepositing ||
    isWithdrawing ||
    !parsedAmount ||
    parsedAmount <= 0 ||
    exceedsBalance;

  const [apy, setApy] = useState<number | null>(null);
  const [netApy, setNetApy] = useState<number | null>(null);
  const [showSuccessDrawer, setShowSuccessDrawer] = useState(false);
  const [rewardMessage, setRewardMessage] = useState<string | null>(null);

  const [monthlyEarn, setMonthlyEarn] = useState<number | null>(null);

  const {
    data: vaultBalanceRaw,
    isLoading: isBalanceLoading,
    refetch: refetchVaultBalance,
  } = useReadContract({
    address: VAULT_ADDRESS,
    abi: erc4626Abi,
    functionName: "balanceOf",
    args: [address ?? "0x"],
    chainId: base.id,
    query: {
      enabled: !!address,
    },
  });

  const { data: usdcEquivalent } = useReadContract({
    address: VAULT_ADDRESS,
    abi: erc4626Abi,
    functionName: "convertToAssets",
    args: [vaultBalanceRaw ?? 0n],
    query: {
      enabled: !!vaultBalanceRaw,
    },
  });

  const vaultBalance = usdcEquivalent
    ? parseFloat(formatUnits(usdcEquivalent, USDC_DECIMALS))
    : 0;

  useEffect(() => {
    if (typeof netApy !== "number" || vaultBalance <= 0) {
      setMonthlyEarn(0);
      return;
    }

    setMonthlyEarn((vaultBalance * netApy) / 12);
  }, [vaultBalance, netApy]);

  useEffect(() => {
    const fetchApy = async () => {
      try {
        const response = await fetch("https://blue-api.morpho.org/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `
              query VaultByAddress($address: String!, $chainId: Int) {
                vaultByAddress(address: $address, chainId: $chainId) {
                  state {
                    apy
                    netApy
                  }
                }
              }
            `,
            variables: {
              address: VAULT_ADDRESS,
              chainId: 8453,
            },
          }),
        });

        const json = await response.json();
        const state = json?.data?.vaultByAddress?.state;

        if (typeof state?.apy === "number") setApy(state.apy);
        if (typeof state?.netApy === "number") setNetApy(state.netApy);
      } catch (err) {
        console.error("Failed to fetch Morpho vault stats:", err);
      }
    };

    fetchApy();
  }, []);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!address) return;

      const balance = await client.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });

      const formatted = parseFloat(formatUnits(balance, USDC_DECIMALS));
      setUsdcBalance(formatted);
    };

    fetchBalance();
  }, [address]);

  const rawAmount =
    parsedAmount && !isNaN(parsedAmount)
      ? parseUnits(amount, USDC_DECIMALS)
      : 0n;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address ?? "0x", VAULT_ADDRESS],
    query: {
      enabled: !!address && rawAmount > 0n,
    },
  });

  const [totalDeposited, setTotalDeposited] = useState<number | null>(null);

  const formatMonthlyEarnings = (value: number) => {
    if (value <= 0) return "0.00";
    if (value < 0.000001) return "<0.000001";
    if (value < 0.01) return value.toFixed(6);
    return value.toFixed(2);
  };

  useEffect(() => {
    if (allowance !== undefined) {
      setIsApproved(allowance >= rawAmount);
    }
  }, [allowance, rawAmount]);

  const handleApprove = async (): Promise<boolean> => {
    if (!isConnected) await connect({ connector: farcasterFrame() });
    if (!address) return false;

    try {
      setSending(true);

      const txHash = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [VAULT_ADDRESS, rawAmount],
        chainId: base.id,
      });

      await client.waitForTransactionReceipt({ hash: txHash });
      await refetchAllowance?.();

      setTimeout(() => {
        setIsApproved(true);
      }, 500);
      return true;
    } catch (e) {
      console.error("Approval failed", e);
      return false;
    } finally {
      setSending(false);
    }
  };

  const handleDeposit = async () => {
    if (!isConnected) await connect({ connector: farcasterFrame() });
    if (!address || rawAmount === 0n) return;

    const context = await sdk.context;
    const fid = context?.user?.fid;

    try {
      setIsDepositing(true);

      const tx = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: erc4626Abi,
        functionName: "deposit",
        args: [rawAmount, address],
        chainId: base.id,
      });

      // ✅ WAIT until the deposit is mined
      await client.waitForTransactionReceipt({ hash: tx });

      // 🔔 Notify the homepage to update wallet + earn pills immediately.
      window.dispatchEvent(
        new CustomEvent("tab:balance-updated", {
          detail: {
            deltaUsdc: -parsedAmount,
            earnDeltaUsd: parsedAmount,
          },
        })
      );

      // ✅ NOW refetch vault balance
      await refetchVaultBalance();

      setTxHash(tx);
      setSuccess(true);
      setShowSuccessDrawer(true);

      // Log earn deposit
      try {
        await fetch(`/api/yield`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fid,
            address,
            amount: parsedAmount,
          }),
        });
      } catch (err) {
        console.error("Failed to post deposit to /api/yield:", err);
      }
    } catch (e) {
      console.error("Deposit failed", e);
    } finally {
      setIsDepositing(false);
    }
  };

  const handleApproveAndDeposit = async () => {
    if (!isApproved) {
      const approved = await handleApprove();
      if (!approved) return;
    }

    await handleDeposit();
  };

  const handleWithdraw = async () => {
    if (!isConnected) await connect({ connector: farcasterFrame() });
    if (!address || !vaultBalanceRaw || vaultBalanceRaw === 0n) return;

    try {
      setIsWithdrawing(true);

      const tx = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: erc4626Abi,
        functionName: "redeem",
        args: [vaultBalanceRaw, address, address],
        chainId: base.id,
      });

      // ✅ wait for confirmation
      await client.waitForTransactionReceipt({ hash: tx });

      // 🔔 Notify the homepage to update wallet + earn pills immediately.
      window.dispatchEvent(
        new CustomEvent("tab:balance-updated", {
          detail: {
            deltaUsdc: vaultBalance,
            earnDeltaUsd: -vaultBalance,
          },
        })
      );

      setTxHash(tx);
      setSuccess(true);

      // refresh vault position
      await refetchVaultBalance();

      toast.success("Withdrawal successful", {
        description: `USDC is back in your wallet`,
      });
    } catch (e) {
      console.error("Withdraw failed", e);
      toast.error("Withdrawal failed", {
        description: "Please try again",
      });
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="top-[110px] md:top-1/2 p-4 md:w-full md:max-w-md max-h-[calc(100dvh-110px)] md:max-h-[85vh] overflow-hidden">
        <div className="bg-background rounded-t-3xl md:rounded-2xl flex flex-col h-full max-h-[calc(100dvh-110px)] md:max-h-[85vh] pb-3">
          <ResponsiveDialogTitle className="text-lg text-center font-medium shrink-0">
            <div className="flex flex-col items-center">
              <div className="hidden mt-4 text-2xl mb-6 relative w-10 h-10 rounded-full flex items-center justify-center">
                <img
                  src="/vmoney.png"
                  alt="points"
                  className="w-12 h-12 rounded-md"
                />
              </div>
            </div>
            <p className="px-4 mt-6">
              Earn up to{" "}
              <span className="text-green-400">
                {netApy === null ? "6.5%" : `${(netApy * 100).toFixed(2)}%`}
              </span>{" "}
              on your USDC
            </p>
          </ResponsiveDialogTitle>

          <div className="overflow-y-auto flex-1 min-h-0 mt-4 space-y-2 pr-1 px-0">
            <div className="flex flex-col text-center">
              <div className="flex justify-center gap-2 mb-4">
                {[50, 100, 500].map((val) => (
                  <button
                    key={val}
                    onClick={() => {
                      setAmount(val.toString());
                      setIsCustomInput(false);
                    }}
                    className={`p-4 text-[#a9a0ed]/70 text-base rounded-md bg-[#a9a0ed]/10 border-2 transition ${
                      amount === val.toString() && !isCustomInput
                        ? "border-[#a9a0ed]"
                        : "border-white/10"
                    }`}
                  >
                    ${val}
                  </button>
                ))}

                <div className="relative w-[82px]">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a9a0ed]/50 text-base">
                    $
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    value={isCustomInput ? amount : ""}
                    className={`pl-5 w-full h-full px-3 py-2 text-white/70 text-base rounded-md bg-[#a9a0ed]/10 text-left outline-none placeholder-white/30 border-2 transition ${
                      isCustomInput && amount !== ""
                        ? "border-white"
                        : "border-white/10"
                    }`}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setIsCustomInput(true);
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              </div>

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
                placeholder="$0"
                className="hidden leading-none text-5xl bg-transparent text-center font-medium outline-none w-full placeholder-white/20"
              />
            </div>

            <Button
              onClick={handleApproveAndDeposit}
              disabled={isDisabled || sending}
              className="w-full bg-primary mt-4 flex items-center justify-center gap-2"
            >
              {sending ? (
                <>
                  <LoaderCircle className="animate-spin w-4 h-4" />
                  Approving...
                </>
              ) : isDepositing ? (
                <>
                  <LoaderCircle className="animate-spin w-4 h-4" />
                  Depositing...
                </>
              ) : !isApproved ? (
                <>Deposit ${amount}</>
              ) : (
                <>Deposit ${amount}</>
              )}
            </Button>

            {usdcBalance !== null && (
              <p className="text-white/30 text-center text-sm mb-6 pb-2">
                ${usdcBalance.toFixed(2)} Available
                {parsedAmount > usdcBalance && (
                  <span className="text-red-400 ml-1">
                    Insufficient balance
                  </span>
                )}
              </p>
            )}

            <div className="text-sm border-2 border-white/5 mt-2 rounded-lg py-1">
              <div className="text-white/30 w-full flex items-center justify-between px-4 py-1">
                <div>My Position</div>
                <p
                  className={clsx(
                    "text-sm",
                    isBalanceLoading
                      ? "text-white/50"
                      : vaultBalance > 0
                        ? "text-green-400 font-medium"
                        : "text-white/50"
                  )}
                >
                  {isBalanceLoading
                    ? "Loading..."
                    : `$${vaultBalance.toFixed(2)}`}
                </p>
              </div>

              {typeof monthlyEarn === "number" && monthlyEarn > 0 && (
                <div className="text-white/30 w-full flex items-center justify-between px-4 py-1">
                  <div>Current Earnings</div>
                  <p className="text-green-400">
                    +${formatMonthlyEarnings(monthlyEarn * 12)}/yr
                  </p>
                </div>
              )}
            </div>

            {vaultBalance > 0 && (
              <>
                <Button
                  variant="outline"
                  onClick={handleWithdraw}
                  disabled={isWithdrawing}
                  className="w-full border-2 border-white/5"
                >
                  {isWithdrawing ? (
                    <>
                      <LoaderCircle className="animate-spin w-4 h-4" />
                      Withdrawing...
                    </>
                  ) : (
                    <>Withdraw & Claim</>
                  )}
                </Button>

                <div className="flex flex-col text-center">
                  <p className="hidden text-white/50 text-sm">
                    Your Deposits: {""}
                    {isBalanceLoading
                      ? "Loading..."
                      : `$${vaultBalance.toFixed(2)}`}
                  </p>
                </div>
              </>
            )}

            <p className="text-white/30 text-[13px] text-center">
              Powered by Morpho.
            </p>

            <SuccessShareDrawer
              isOpen={showSuccessDrawer}
              setIsOpen={setShowSuccessDrawer}
              txHash={txHash ?? undefined}
              amount={parsedAmount}
              token="USDC"
              shareText="Just deposited into tab to earn yield I can spend in mini apps. Powered by Morpho 🦋"
              extraNote={rewardMessage ?? undefined}
            />
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
