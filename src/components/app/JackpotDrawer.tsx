"use client";

import { useEffect, useState } from "react";
import { Drawer } from "vaul";
import {
  useAccount,
  useConnect,
  useWriteContract,
  useReadContract,
} from "wagmi";
import { base } from "viem/chains";
import { maxUint256, formatUnits, parseAbi } from "viem";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { Button } from "../ui/button";
import { LoaderCircle } from "lucide-react";
import { SuccessShareDrawer } from "@/components/app/SuccessShareDrawer";
import { createPublicClient, http, erc20Abi } from "viem";
import sdk from "@farcaster/frame-sdk";
import {
  APP_SOURCE_BYTES32,
  ERC20_TOKEN_ADDRESS,
  RANDOM_TICKET_BUYER_ADDRESS,
  REFERRAL_SPLIT_PRECISE_UNIT,
  REFERRER_ADDRESS,
  USDC_DECIMALS,
} from "@/lib/constants";
import {
  useJackpotAmount,
  useTokenSymbol,
  useTimeRemaining,
  useTicketPrice,
  useTicketPriceInWei,
  useTicketCountForRound,
} from "@/lib/BaseJackpotQueries";
import NumberFlow from "@number-flow/react";
import { BUILDER_CODE_DATA_SUFFIX } from "@/lib/builderCode";

const client = createPublicClient({
  chain: base,
  transport: http(),
});

const randomTicketBuyerAbi = parseAbi([
  "function buyTickets(uint64 count,address recipient,address[] referrers,uint256[] referralSplitBps,bytes32 source) returns (uint256[])",
]);

function formatTimeLeft(seconds: number): string {
  const total = Math.floor(seconds); // 👈 Ensure it's an integer

  if (total <= 0) return "0s";

  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hrs > 0) {
    return `${hrs}h ${String(mins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
  } else {
    return `${mins}m ${String(secs).padStart(2, "0")}s`;
  }
}

export function JackpotDrawer({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { writeContractAsync } = useWriteContract();

  const [balance, setBalance] = useState<number | null>(null);
  const [isApproved, setIsApproved] = useState(false);
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showSuccessDrawer, setShowSuccessDrawer] = useState(false);
  //   const { data: ticketPrice, isLoading: loadingPrice } = useTicketPrice();

  const [amount, setAmount] = useState("50"); // USD amount
  const [isCustomInput, setIsCustomInput] = useState(false);

  const { data: ticketPrice, isLoading: loadingPrice } = useTicketPrice(); // USD per ticket
  const { data: ticketPriceInWei } = useTicketPriceInWei(); // raw wei for contract
  const ticketPriceWei = ticketPriceInWei ?? null;

  const { data: jackpotAmount, isLoading: isLoadingAmount } =
    useJackpotAmount();
  const { data: tokenSymbol } = useTokenSymbol();
  const { data: timeRemaining, isLoading: isLoadingTime } = useTimeRemaining();
  const { data: ticketCount, isLoading: isLoadingTicketCount } =
    useTicketCountForRound(address);

  const parsedAmountUsd = parseFloat(amount || "0");

  const derivedTicketCount = ticketPrice
    ? Math.floor(parsedAmountUsd / ticketPrice)
    : 0;

  const cost = ticketPrice ? ticketPrice * derivedTicketCount : null;

  const costInUsd = ticketPriceWei
    ? parseFloat(
        formatUnits(ticketPriceWei * BigInt(derivedTicketCount), USDC_DECIMALS)
      )
    : 0;

  const parsedAmount = ticketPriceWei
    ? ticketPriceWei * BigInt(derivedTicketCount)
    : 0n;

  const insufficientFunds = balance !== null && costInUsd > balance;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: ERC20_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address ?? "0x", RANDOM_TICKET_BUYER_ADDRESS],
    query: { enabled: !!address && ticketPriceWei !== null },
  });

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const result = await client.readContract({
          address: ERC20_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address ?? "0x"],
        });
        const formatted = parseFloat(
          formatUnits(result as bigint, USDC_DECIMALS)
        );
        setBalance(formatted);
      } catch (err) {
        console.error("Failed to get balance", err);
      }
    };

    if (address) {
      fetchBalance();
    }
  }, [address]);

  useEffect(() => {
    if (allowance !== undefined && ticketPriceWei !== null) {
      setIsApproved(allowance >= parsedAmount);
    }
  }, [allowance, parsedAmount, ticketPriceWei]);

  const handleApprove = async () => {
    try {
      if (!isConnected) await connect({ connector: farcasterFrame() });
      if (!address || !ticketPriceWei) return;

      setSending(true);

      await writeContractAsync({
        address: ERC20_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [RANDOM_TICKET_BUYER_ADDRESS, maxUint256],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_DATA_SUFFIX,
      });

      await refetchAllowance?.();
      setIsApproved(true);
    } catch (e) {
      console.error("Approve failed", e);
    } finally {
      setSending(false);
    }
  };

  const handleBuy = async () => {
    try {
      if (!isConnected) await connect({ connector: farcasterFrame() });
      if (!address || parsedAmount === 0n) return;
      const context = await sdk.context;
      const fid = context?.user?.fid;

      setSending(true);

      const tx = await writeContractAsync({
        address: RANDOM_TICKET_BUYER_ADDRESS,
        abi: randomTicketBuyerAbi,
        functionName: "buyTickets",
        args: [
          BigInt(derivedTicketCount),
          address,
          [REFERRER_ADDRESS],
          [REFERRAL_SPLIT_PRECISE_UNIT],
          APP_SOURCE_BYTES32,
        ],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_DATA_SUFFIX,
      });

      setTxHash(tx);
      setShowSuccessDrawer(true);

      try {
        const res = await fetch("/api/jackpot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fid,
            address,
            amount: costInUsd,
            ticketCount: derivedTicketCount,
          }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Unknown error");

        // Optional: show reward message
        if (json.rewarded) {
          console.log(`🎉 Rewarded with ${json.amount} TAB`);
        }
      } catch (err) {
        console.error("Jackpot deposit API failed:", err);
      }
    } catch (e) {
      console.error("Buy failed", e);
    } finally {
      setSending(false);
    }
  };

  return (
    <Drawer.Root open={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-20" />
        <Drawer.Content className="z-40 fixed inset-0 top-[110px] bg-background p-4 rounded-t-3xl flex flex-col max-h-[calc(100vh-110px)] pb-8">
          <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-4" />

          <Drawer.Title className="text-lg text-center font-medium shrink-0">
            <div className="flex flex-col items-center">
              <div className="text-2xl mb-6 relative w-16 h-16 rounded-full bg-pink-200 text-purple-800 flex items-center justify-center">
                🎟️
              </div>
            </div>
            <p className="px-6">
              Join the daily USDC jackpot. Each ticket gives you a shot at the
              prize.
            </p>
          </Drawer.Title>

          <div className="text-center mt-4 space-y-1">
            {isLoadingAmount ? (
              <div>loading</div>
            ) : jackpotAmount ? (
              <NumberFlow
                // value={parseFloat(totalAmountFormatted)}
                value={jackpotAmount}
                format={{
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                  currencyDisplay: "narrowSymbol",
                  currency: "USD", // fallback only
                }}
                prefix={"$"}
                className="text-4xl font-medium text-primary"
              />
            ) : (
              <p className="text-2xl text-white/30">N/A</p>
            )}

            <p className="text-sm text-white/40">
              {isLoadingTime || timeRemaining === undefined
                ? "Checking time..."
                : `Ends in: ${formatTimeLeft(timeRemaining)}`}
            </p>
          </div>

          <div className="flex justify-center gap-2 mb-4 mt-4">
            {[1, 5, 10].map((val) => (
              <button
                key={val}
                onClick={() => {
                  setAmount(val.toString());
                  setIsCustomInput(false);
                }}
                className={`px-4 py-2 text-[#a9a0ed]/70 text-base rounded-md bg-[#a9a0ed]/10 border-2 transition ${
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

          <p className="text-center mt-2 text-white/60">
            Total Tickets:{" "}
            {loadingPrice || cost === null ? "..." : `${cost.toFixed(0)}`}
          </p>

          {insufficientFunds && (
            <p className="text-sm text-red-400 text-center mt-2">
              Insufficient balance
            </p>
          )}

          <div className="mt-4">
            {!isApproved ? (
              <Button
                onClick={handleApprove}
                disabled={sending}
                className="w-full bg-primary"
              >
                {sending ? (
                  <>
                    <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                    Approving...
                  </>
                ) : (
                  <>Approve {derivedTicketCount} USDC</>
                )}
              </Button>
            ) : (
              <Button
                onClick={handleBuy}
                disabled={
                  sending || insufficientFunds || derivedTicketCount <= 0
                }
                className="w-full bg-green-600 hover:bg-green-700"
              >
                {sending ? (
                  <>
                    <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                    Purchasing...
                  </>
                ) : (
                  <>
                    Buy {derivedTicketCount} Ticket
                    {derivedTicketCount > 1 ? "s" : ""}
                  </>
                )}
              </Button>
            )}
          </div>
          <div className="flex flex-col text-center mt-4">
            <p className="text-white/30 text-sm">
              {isLoadingTicketCount
                ? "Loading your tickets..."
                : `Your Tickets: ${ticketCount ?? 0}`}
            </p>
          </div>

          <p className="text-white/30 text-sm text-center mt-1">
            Powered by Megapot
          </p>

          <SuccessShareDrawer
            isOpen={showSuccessDrawer}
            setIsOpen={setShowSuccessDrawer}
            txHash={txHash ?? undefined}
            amount={costInUsd}
            token="USDC"
            shareText={`Just entered the onchain jackpot via Tab 🎰`}
          />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
