"use client";

import { useEffect, useState, useMemo } from "react";
import {
  useAccount,
  useConnect,
  useWriteContract,
  useReadContract,
} from "wagmi";
import { base } from "viem/chains";
import { formatUnits } from "viem";
import { BaseJackpotAbi } from "@/lib/BaseJackpotAbi";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { Button } from "@/components/ui/button";
import { LoaderCircle, Loader } from "lucide-react";
import { SuccessShareDrawer } from "@/components/app/SuccessShareDrawer";
import { createPublicClient, http, erc20Abi } from "viem";
import sdk from "@farcaster/frame-sdk";
import { REFERRER_ADDRESS, USDC_DECIMALS } from "@/lib/constants";
import {
  useJackpotAmount,
  useTimeRemaining,
  useTicketPrice,
  useTicketPriceInWei,
  useTicketCountForRound,
  useLastJackpotResults,
} from "@/lib/BaseJackpotQueries";
import NumberFlow from "@number-flow/react";
import { Countdown } from "@/components/app/Countdown";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import { parseISO, format } from "date-fns";

const CONTRACT_ADDRESS = "0xbEDd4F2beBE9E3E636161E644759f3cbe3d51B95"; // 🎯 Jackpot contract
const ERC20_TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // 💵 USDC on Base

const ALCHEMY_URL = process.env.NEXT_PUBLIC_ALCHEMY_URL!;

const client = createPublicClient({
  chain: base,
  transport: http(ALCHEMY_URL),
});

interface RecentJackpotUser {
  address: string;
  timestamp: string;
  username: string | null;
  pfp_url: string | null;
}

export default function JackpotPage() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { writeContractAsync } = useWriteContract();
  const { dismiss } = useFrameSplash();

  const [ticketPriceWei, setTicketPriceWei] = useState<bigint | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [isApproved, setIsApproved] = useState(false);
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showSuccessDrawer, setShowSuccessDrawer] = useState(false);

  const [amount, setAmount] = useState("1"); // USD amount
  const [isCustomInput, setIsCustomInput] = useState(false);
  const [isLoadingBalance, setIsLoadingBalance] = useState(true);

  const { data: ticketPrice, isLoading: loadingPrice } = useTicketPrice(); // USD per ticket
  const { data: ticketPriceInWei } = useTicketPriceInWei(); // raw wei for contract

  const [guaranteedPrizes, setGuaranteedPrizes] = useState<any>(null);

  const { data: jackpotAmount, isLoading: isLoadingAmount } =
    useJackpotAmount();
  const { data: timeRemaining, isLoading: isLoadingTime } = useTimeRemaining();
  const { data: lastRoundData, isLoading: isLoadingLastRound } =
    useLastJackpotResults(address);
  const { data: ticketCount, isLoading: isLoadingTicketCount } =
    useTicketCountForRound(address);

  const parsedAmountUsd = useMemo(() => parseFloat(amount || "0"), [amount]);
  const derivedTicketCount = useMemo(
    () => (ticketPrice ? Math.floor(parsedAmountUsd / ticketPrice) : 0),
    [parsedAmountUsd, ticketPrice]
  );

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
    args: [address ?? "0x", CONTRACT_ADDRESS],
    query: { enabled: !!address && ticketPriceWei !== null },
  });

  const [recentTickets, setRecentTickets] = useState<Record<string, number>>(
    {}
  );
  const [loadingRecentTickets, setLoadingRecentTickets] = useState(false);

  const [recentUsers, setRecentUsers] = useState<RecentJackpotUser[]>([]);

  useEffect(() => {
    fetch("/api/jackpot/recent-users")
      .then((r) => r.json())
      .then((d) => setRecentUsers(d.users || []))
      .catch(() => setRecentUsers([]));
  }, []);
  useEffect(() => {
    if (!address) return;

    const fetchRecentTickets = async () => {
      setLoadingRecentTickets(true);

      try {
        const res = await fetch(`/api/megapot/${address}`);
        const history = await res.json();

        const contractData = history.contractData ?? [];
        const grouped: Record<string, number> = {};

        for (const entry of contractData) {
          const block = await client.getBlock({
            blockNumber: BigInt(entry.blockNumber),
          });
          const timestamp = Number(block.timestamp) * 1000;
          const dateObj = new Date(timestamp);
          const key = dateObj.toISOString().split("T")[0];

          grouped[key] = (grouped[key] || 0) + entry.ticketsPurchased;
        }

        // Sort and limit
        const sorted = Object.entries(grouped)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .slice(0, 3);

        const recent: Record<string, number> = {};
        for (const [date, count] of sorted) {
          recent[date] = count;
        }

        setRecentTickets(recent);
        setGuaranteedPrizes(history.guaranteedPrizes);
      } catch (err) {
        console.error("Failed to fetch recent ticket history", err);
      } finally {
        setLoadingRecentTickets(false);
      }
    };

    fetchRecentTickets();
  }, [address]);

  useEffect(() => {
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    const fetchTicketPrice = async () => {
      try {
        const result = await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: BaseJackpotAbi,
          functionName: "ticketPrice",
        });
        setTicketPriceWei(result as bigint);
      } catch (err) {
        console.error("Failed to get ticket price", err);
      }
    };

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
      } finally {
        setIsLoadingBalance(false);
      }
    };

    if (address) {
      fetchTicketPrice();
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
        args: [CONTRACT_ADDRESS, parsedAmount],
        chainId: base.id,
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

      setSending(true);

      const tx = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: BaseJackpotAbi,
        functionName: "purchaseTickets",
        args: [REFERRER_ADDRESS, parsedAmount, address],
        chainId: base.id,
      });

      setTxHash(tx);
      setShowSuccessDrawer(true);

      // ✅ WAIT FOR CONFIRMATION
      await client.waitForTransactionReceipt({ hash: tx });

      // ✅ EMIT GLOBAL BALANCE UPDATE
      window.dispatchEvent(new Event("tab:balance-updated"));

      // Log jackpot entry
      const context = await sdk.context;
      const fid = context?.user?.fid;

      await fetch("/api/jackpot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          amount: parsedAmountUsd,
          ticketCount: derivedTicketCount,
          fid,
        }),
      });
    } catch (e) {
      console.error("Buy failed", e);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!address) return;

    const refetchBalance = async () => {
      try {
        const result = await client.readContract({
          address: ERC20_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });

        const formatted = parseFloat(
          formatUnits(result as bigint, USDC_DECIMALS)
        );
        setBalance(formatted);
      } catch (err) {
        console.error("Failed to refresh balance", err);
      }
    };

    const onBalanceUpdate = () => {
      refetchBalance();
    };

    window.addEventListener("tab:balance-updated", onBalanceUpdate);

    return () => {
      window.removeEventListener("tab:balance-updated", onBalanceUpdate);
    };
  }, [address]);

  const formatDrawDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="p-4 pb-32 pt-10 mt-12 relative">
      <div className="max-w-sm w-full mx-auto space-y-4">
        <div className="hidden text-center text-md font-medium mb-4 pb-2">
          Buy a lottery ticket for a chance to win big.
        </div>

        <div className="text-center mt-4">
          <p className="opacity-30">Today’s USDC Jackpot</p>
          {isLoadingAmount ? (
            <div className="justify-center py-4 flex text-center items-center opacity-30">
              <Loader className="w-10 h-10 animate-spin" />
            </div>
          ) : jackpotAmount ? (
            <NumberFlow
              value={jackpotAmount}
              format={{
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
                currencyDisplay: "narrowSymbol",
                currency: "USD",
              }}
              prefix={"$"}
              className="leading-none text-5xl font-medium text-primary"
            />
          ) : (
            <p className="text-2xl text-white/30">N/A</p>
          )}

          <p className="text-sm text-white/40">
            {isLoadingTime || timeRemaining === undefined ? null : (
              <span className="flex flex-row justify-center text-base gap-1">
                <span>Drawing in:</span>
                <Countdown seconds={timeRemaining} />
              </span>
            )}
          </p>
        </div>

        <div className="flex justify-center gap-2 mb-4 mt-4">
          {[2, 5, 10].map((val) => (
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

        <p className="text-center mt-2 text-white/60 hidden">
          Total Tickets:{" "}
          {loadingPrice || cost === null ? "..." : `${cost.toFixed(0)}`}
        </p>

        {/* {insufficientFunds && (
          <p className="text-sm text-red-400 text-center mt-2">
            Not enough USDC
          </p>
        )} */}

        <div className="mt-6">
          {!isApproved ? (
            <Button
              onClick={handleApprove}
              disabled={sending || isLoadingAmount || isLoadingBalance}
              className="w-full bg-primary"
            >
              {sending ? (
                <>
                  <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                  Approving...
                </>
              ) : (
                <>Approve ${parsedAmountUsd || 0}</>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleBuy}
              disabled={sending || insufficientFunds || derivedTicketCount <= 0}
              className="w-full bg-primary"
            >
              {sending ? (
                <>
                  <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                  Buying...
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

        {/* 💵 Available balance (Morpho-style) */}
        {balance !== null && (
          <p className="text-white/30 text-center text-sm mt-3 mb-1">
            ${balance.toFixed(2)} available
            {insufficientFunds && (
              <span className="text-red-400 ml-1">Insufficient funds</span>
            )}
          </p>
        )}

        <div className="hidden border-2 border-white/5 rounded-xl p-3 space-y-2">
          <h3 className="text-white text-center text-sm font-semibold">
            Guaranteed Daily Prizes
          </h3>

          {loadingRecentTickets ? (
            <div className="flex justify-center items-center py-3">
              <Loader className="w-7 h-7 animate-spin text-white/50" />
            </div>
          ) : guaranteedPrizes && Object.keys(guaranteedPrizes).length > 0 ? (
            Object.values(guaranteedPrizes).map((entry: any, idx: number) => {
              const prizeAmount = entry.prizeValueTotal;
              const claimedDate = format(
                parseISO(entry.claimedAt),
                "MMMM d, yyyy"
              );
              const txLinks = entry.claimTransactionHashes || [];

              const handleSharePrize = async () => {
                try {
                  await sdk.actions.composeCast({
                    text: `🎁 I won ${prizeAmount} USDC from lottery on @usetab! Claimed on ${claimedDate}.`,
                    embeds: ["https://usetab.app/jackpot"],
                  });
                } catch (err) {
                  console.warn("Share failed or cancelled", err);
                }
              };

              return (
                <div
                  key={idx}
                  className="bg-white/5 p-4 rounded-lg space-y-2 text-center flex flex-col items-center"
                >
                  <p className="text-white">
                    You won{" "}
                    <span className="font-bold">{prizeAmount} USDC 🎉</span>
                  </p>
                  <span className="text-white/50 text-sm mt-1">
                    Claimed on {claimedDate}
                  </span>

                  <Button
                    size="sm"
                    className="mt-2 rounded-[8px] bg-white text-black"
                    onClick={handleSharePrize}
                  >
                    Share to Feed
                  </Button>

                  {txLinks.map((tx: string, i: number) => (
                    <a
                      key={i}
                      href={`https://basescan.org/tx/${tx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white underline text-sm block break-all"
                    >
                      View tx
                    </a>
                  ))}
                </div>
              );
            })
          ) : (
            <div className="text-white/50 text-sm text-center px-2">
              Every ticket gives you a shot at $100 in daily bonus prizes. Win
              up to $25, even multiple times a day.
            </div>
          )}
        </div>

        <div className="text-sm border-2 border-white/5 mt-2 rounded-lg py-2">
          <div className="text-white/30 w-full flex items-center justify-between px-4 py-1">
            <div>Tickets in play</div>
            <p
              className={`text-sm ${
                isLoadingTicketCount
                  ? "text-white/50"
                  : ticketCount && ticketCount >= 1
                    ? "text-green-400"
                    : "text-white/50"
              }`}
            >
              {isLoadingTicketCount
                ? "Loading..."
                : ticketCount && ticketCount >= 1
                  ? `${Math.round(ticketCount)}`
                  : "No active tickets"}
            </p>
          </div>

          <div className="hidden text-white/30 w-full flex items-center justify-between px-4 py-1">
            <div>Draw Date</div>
            <p className="text-white/50 text-sm">
              {isLoadingTime || timeRemaining === undefined
                ? "Loading..."
                : formatDrawDate(Math.floor(Date.now() / 1000) + timeRemaining)}
            </p>
          </div>

          {loadingRecentTickets ? (
            <div className="text-white/30 text-sm px-4">
              Loading ticket history...
            </div>
          ) : Object.keys(recentTickets).length === 0 ? (
            <div className="text-white/30 text-sm px-4 py-2">
              Your ticket history will appear here.
            </div>
          ) : (
            Object.entries(recentTickets)
              .filter(([, count]) => count > 0) // ⬅️ FIX HERE
              .sort((a, b) => (a[0] < b[0] ? 1 : -1))
              .map(([date, count]) => {
                const formatted = format(parseISO(date), "MMMM d");
                return (
                  <div
                    key={date}
                    className="text-white/30 w-full flex items-center justify-between px-4 py-1"
                  >
                    <div>{formatted}</div>
                    <p className="text-white/50 text-sm">
                      {count} ticket{count !== 1 ? "s" : ""}
                    </p>
                  </div>
                );
              })
          )}
        </div>

        {recentUsers.length > 0 && (
          <div className="flex flex-col items-center w-full mt-6 mb-2">
            {/* Avatars */}
            <div className="flex -space-x-3 mb-1">
              {recentUsers.map((u, i) => (
                <img
                  key={i}
                  src={u.pfp_url || "/app.png"}
                  alt={u.username || ""}
                  className="w-8 h-8 rounded-full border-2 border-[#0d0d13] object-cover"
                />
              ))}
            </div>

            {/* Joined text */}
            <div className="text-white/40 text-sm font-medium">
              others joined
            </div>
          </div>
        )}

        {typeof ticketCount === "number" && ticketCount > 0 && (
          <>
            <div className="flex justify-center mt-1">
              <Button
                onClick={async () => {
                  try {
                    await sdk.actions.composeCast({
                      text: `🎰 I’m in the USDC jackpot on @usetab — ${ticketCount} active ticket${ticketCount > 1 ? "s" : ""}!`,
                      embeds: ["https://usetab.app/jackpot"],
                    });
                  } catch (err) {
                    console.warn("Share failed or cancelled", err);
                  }
                }}
                className="w-full bg-white text-black font-semibold py-4 rounded-lg"
              >
                Share to Feed
              </Button>
            </div>
          </>
        )}

        <p className="hidden text-white/30 text-sm text-center">
          Powered by Megapot
        </p>

        <SuccessShareDrawer
          isOpen={showSuccessDrawer}
          setIsOpen={setShowSuccessDrawer}
          txHash={txHash ?? undefined}
          amount={costInUsd}
          token="USDC"
          // ✅ Clean share copy without TAB reward mention
          shareText={`Joined the onchain USDC jackpot 🎰 on @usetab`}
          embeds={["https://usetab.app/jackpot"]}
        />
      </div>
    </div>
  );
}
