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
import { Button } from "@/components/ui/button";
import { LoaderCircle, Loader } from "lucide-react";
import { SuccessShareDrawer } from "@/components/app/SuccessShareDrawer";
import { createPublicClient, http, erc20Abi } from "viem";
import { Drawer } from "vaul";
import sdk from "@farcaster/frame-sdk";
import { REFERRER_ADDRESS, USDC_DECIMALS } from "@/lib/constants";
import { getPreferredConnector } from "@/lib/wallet";
import { usePrivy } from "@privy-io/react-auth";
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

type GuaranteedPrizeEntry = {
  prizeValueTotal?: string | number;
  claimedAt?: string;
  claimTransactionHashes?: string[];
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getDicebearAvatar(seed: string) {
  return `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(
    seed
  )}`;
}

function getRecentUserAvatar(user: RecentJackpotUser) {
  const seed = user.username || user.address || "user";
  const pfp = (user.pfp_url || "").trim();
  if (!pfp) return getDicebearAvatar(seed);
  if (pfp.startsWith("http://") || pfp.startsWith("https://")) return pfp;
  return getDicebearAvatar(seed);
}

function formatJackpotAmount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function resolveCssColor(raw: string, fallback: string) {
  const value = raw.trim();
  if (!value) return fallback;
  if (value.startsWith("#")) return value;
  if (value.startsWith("rgb") || value.startsWith("hsl")) return value;
  // Handles tokenized values like "222 84% 5%" (used in some theme systems).
  if (/[\d.%\s]+/.test(value)) return `hsl(${value})`;
  return fallback;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export default function JackpotPage() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { writeContractAsync } = useWriteContract();
  const { dismiss } = useFrameSplash();
  const { user } = usePrivy();

  const [ticketPriceWei, setTicketPriceWei] = useState<bigint | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [buyStep, setBuyStep] = useState<"idle" | "approving" | "buying">(
    "idle"
  );
  const [justPurchased, setJustPurchased] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showSuccessDrawer, setShowSuccessDrawer] = useState(false);

  const [amount, setAmount] = useState("1"); // USD amount
  const [isCustomInput, setIsCustomInput] = useState(false);
  const [isLoadingBalance, setIsLoadingBalance] = useState(true);

  const { data: ticketPrice, isLoading: loadingPrice } = useTicketPrice(); // USD per ticket
  const { data: ticketPriceInWei } = useTicketPriceInWei(); // raw wei for contract

  const [guaranteedPrizes, setGuaranteedPrizes] = useState<
    Record<string, GuaranteedPrizeEntry> | null
  >(null);

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
  const [sharingCard, setSharingCard] = useState(false);
  const [showSharePreview, setShowSharePreview] = useState(false);

  const shareParticipants = useMemo(
    () =>
      recentUsers
        .map((u) => (u.username ? `@${u.username}` : "Guest"))
        .slice(0, 8),
    [recentUsers]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/jackpot/recent-users", { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setRecentUsers(d.users || []))
      .catch(() => setRecentUsers([]));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    const fetchRecentTickets = async () => {
      setLoadingRecentTickets(true);

      try {
        const res = await fetch(`/api/megapot/${address}`);
        const history = await res.json();

        const contractData = history.contractData ?? [];
        const grouped: Record<string, number> = {};
        const blockNumberKeys = Array.from(
          new Set(
            contractData
              .map((entry: { blockNumber?: string | number }) =>
                entry?.blockNumber?.toString?.()
              )
              .filter(Boolean)
          )
        ) as string[];
        const blockTimeByNumber = new Map<string, number>();
        await Promise.all(
          blockNumberKeys.map(async (blockNumberKey) => {
            const block = await client.getBlock({
              blockNumber: BigInt(blockNumberKey),
            });
            blockTimeByNumber.set(
              blockNumberKey,
              Number(block.timestamp) * 1000
            );
          })
        );

        for (const entry of contractData) {
          const blockNumberKey = entry?.blockNumber?.toString?.();
          if (!blockNumberKey) continue;
          const timestamp = blockTimeByNumber.get(blockNumberKey);
          if (!timestamp) continue;
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

        if (!cancelled) {
          setRecentTickets(recent);
          setGuaranteedPrizes(history.guaranteedPrizes);
        }
      } catch (err) {
        console.error("Failed to fetch recent ticket history", err);
      } finally {
        if (!cancelled) setLoadingRecentTickets(false);
      }
    };

    fetchRecentTickets();
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    if (!address) {
      setBalance(null);
      setIsLoadingBalance(false);
      return;
    }

    let cancelled = false;
    setIsLoadingBalance(true);

    const fetchTicketPrice = async () => {
      try {
        const result = await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: BaseJackpotAbi,
          functionName: "ticketPrice",
        });
        if (!cancelled) {
          setTicketPriceWei(result as bigint);
        }
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
        if (!cancelled) {
          setBalance(formatted);
        }
      } catch (err) {
        console.error("Failed to get balance", err);
      } finally {
        if (!cancelled) setIsLoadingBalance(false);
      }
    };

    fetchTicketPrice();
    fetchBalance();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const handleBuy = async () => {
    try {
      if (!isConnected) {
        const preferred = getPreferredConnector(connectors);
        if (!preferred) return;
        await connect({ connector: preferred });
        return;
      }
      if (!address || parsedAmount === 0n) return;

      setSending(true);
      setBuyStep("approving");

      const currentAllowance = allowance ?? 0n;
      if (currentAllowance < parsedAmount) {
        const approvalTx = await writeContractAsync({
          address: ERC20_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [CONTRACT_ADDRESS, parsedAmount],
          chainId: base.id,
        });
        await client.waitForTransactionReceipt({ hash: approvalTx });
        await refetchAllowance?.();
      }

      setBuyStep("buying");

      const tx = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: BaseJackpotAbi,
        functionName: "purchaseTickets",
        args: [REFERRER_ADDRESS, parsedAmount, address],
        chainId: base.id,
      });

      setTxHash(tx);
      setShowSuccessDrawer(true);
      setJustPurchased(true);

      // ✅ WAIT FOR CONFIRMATION
      await client.waitForTransactionReceipt({ hash: tx });

      // ✅ EMIT GLOBAL BALANCE UPDATE
      window.dispatchEvent(new Event("tab:balance-updated"));

      // Log jackpot entry
      const linkedFid = user?.farcaster?.fid ?? null;

      if (linkedFid) {
        await fetch("/api/jackpot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address,
            amount: parsedAmountUsd,
            ticketCount: derivedTicketCount,
            fid: linkedFid,
          }),
        });
      }
    } catch (e) {
      console.error("Buy failed", e);
    } finally {
      setSending(false);
      setBuyStep("idle");
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

  const buildShareCardBlob = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 680;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");

    const rootStyles = getComputedStyle(document.documentElement);
    const primaryVar = rootStyles.getPropertyValue("--primary").trim();
    const foregroundVar = rootStyles
      .getPropertyValue("--primary-foreground")
      .trim();
    const mutedVar = rootStyles.getPropertyValue("--muted-foreground").trim();

    const primaryColor = resolveCssColor(primaryVar, "#a9a0ed");
    const foregroundColor = resolveCssColor(foregroundVar, "#111111");
    const mutedColor = resolveCssColor(mutedVar, "rgba(17,17,17,0.72)");

    // Transparent background + rounded primary card
    roundRect(ctx, 18, 18, canvas.width - 36, canvas.height - 36, 38);
    ctx.fillStyle = primaryColor;
    ctx.fill();

    const jackpotValue = formatJackpotAmount(jackpotAmount);
    const myTickets =
      typeof ticketCount === "number" && Number.isFinite(ticketCount)
        ? Math.round(ticketCount)
        : 0;
    const avatarUsers = recentUsers.slice(0, 6);
    const hasParticipants = avatarUsers.length > 0;

    ctx.fillStyle = mutedColor;
    ctx.font = "600 42px Inter, system-ui, sans-serif";
    ctx.fillText("TAB JACKPOT", 60, 115);

    try {
      const logo = await loadImage("/newnewnewapp.png");
      const logoSize = 72;
      const logoX = canvas.width - 60 - logoSize;
      const logoY = 58;
      ctx.save();
      roundRect(ctx, logoX, logoY, logoSize, logoSize, 18);
      ctx.clip();
      ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
      ctx.restore();
    } catch {
      // Optional decoration; ignore if logo asset cannot be loaded.
    }

    ctx.fillStyle = foregroundColor;
    ctx.font = "700 116px Inter, system-ui, sans-serif";
    ctx.fillText(`$${jackpotValue}`, 60, 235);

    ctx.fillStyle = mutedColor;
    ctx.font = "500 44px Inter, system-ui, sans-serif";
    ctx.fillText(`My Tickets: ${myTickets}`, 60, 365);

    const avatarSize = 78;
    const avatarY = 420;
    const overlap = 16;
    let avatarX = 60;

    if (hasParticipants) {
      for (let i = 0; i < avatarUsers.length; i += 1) {
        const user = avatarUsers[i];
        const src = getRecentUserAvatar(user);

        try {
          const img = await loadImage(src);
          // Avatar circle clip
          ctx.save();
          ctx.beginPath();
          ctx.arc(
            avatarX + avatarSize / 2,
            avatarY + avatarSize / 2,
            avatarSize / 2,
            0,
            Math.PI * 2
          );
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
          ctx.restore();
        } catch {
          // Fallback to a deterministic DiceBear avatar if external image fails.
          try {
            const fallback = await loadImage(
              getDicebearAvatar(user.username || user.address || String(i))
            );
            ctx.save();
            ctx.beginPath();
            ctx.arc(
              avatarX + avatarSize / 2,
              avatarY + avatarSize / 2,
              avatarSize / 2,
              0,
              Math.PI * 2
            );
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(fallback, avatarX, avatarY, avatarSize, avatarSize);
            ctx.restore();
          } catch {
            ctx.fillStyle = "rgba(255,255,255,0.25)";
            ctx.beginPath();
            ctx.arc(
              avatarX + avatarSize / 2,
              avatarY + avatarSize / 2,
              avatarSize / 2,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
        }

        // White ring border
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(
          avatarX + avatarSize / 2,
          avatarY + avatarSize / 2,
          avatarSize / 2 - 2,
          0,
          Math.PI * 2
        );
        ctx.stroke();

        avatarX += avatarSize - overlap;
      }
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) throw new Error("Unable to build share image");
    return blob;
  };

  const shareJackpotCard = async () => {
    if (sharingCard) return;
    setSharingCard(true);

    try {
      const blob = await buildShareCardBlob();
      const file = new File([blob], "tab-jackpot-card.png", {
        type: "image/png",
      });
      const shareText = "I joined the Tab USDC jackpot.";

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "Tab Jackpot",
          text: shareText,
          files: [file],
        });
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "tab-jackpot-card.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Share card failed", err);
    } finally {
      setSharingCard(false);
    }
  };

  return (
    <div className="p-4 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-10 mt-[calc(3rem+env(safe-area-inset-top))] relative">
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
                setJustPurchased(false);
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
                setJustPurchased(false);
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
          <Button
            onClick={handleBuy}
            disabled={
              sending ||
              justPurchased ||
              insufficientFunds ||
              derivedTicketCount <= 0 ||
              isLoadingAmount ||
              isLoadingBalance
            }
            className="w-full bg-primary"
          >
            {sending ? (
              <>
                <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                {buyStep === "approving" ? "Approving..." : "Buying..."}
              </>
            ) : justPurchased ? (
              <>Ticket Purchased</>
            ) : (
              <>
                Buy {derivedTicketCount} Ticket
                {derivedTicketCount > 1 ? "s" : ""}
              </>
            )}
          </Button>
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
            Object.values(guaranteedPrizes).map((entry, idx: number) => {
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
                  src={getRecentUserAvatar(u)}
                  onError={(e) => {
                    e.currentTarget.src = getDicebearAvatar(
                      u.username || u.address || String(i)
                    );
                  }}
                  alt={u.username || shortAddress(u.address)}
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
                onClick={() => setShowSharePreview(true)}
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

        <Drawer.Root open={showSharePreview} onOpenChange={setShowSharePreview}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30" />
            <Drawer.Content className="fixed bottom-0 left-0 right-0 z-40 rounded-t-3xl bg-background p-4 pb-6">
              <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-4" />
              <Drawer.Title className="text-center text-lg font-medium mb-4">
                Share Jackpot Card
              </Drawer.Title>

              <div className="rounded-2xl bg-primary text-primary-foreground p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm opacity-80">TAB JACKPOT</p>
                  <img
                    src="/newnewnewapp.png"
                    alt="Tab logo"
                    className="w-9 h-9 rounded-lg object-cover shrink-0"
                  />
                </div>
                <p className="text-4xl font-semibold">
                  ${formatJackpotAmount(jackpotAmount)}
                </p>
                <p className="text-sm opacity-90">
                  My Tickets: {typeof ticketCount === "number" ? Math.round(ticketCount) : 0}
                </p>
                {recentUsers.length > 0 && (
                  <div className="pt-1">
                    <div className="flex -space-x-3 py-1">
                      {recentUsers.slice(0, 8).map((u, idx) => (
                        <img
                          key={`${u.address}-${idx}`}
                          src={getRecentUserAvatar(u)}
                          onError={(e) => {
                            e.currentTarget.src = getDicebearAvatar(
                              u.username || u.address || String(idx)
                            );
                          }}
                          alt={u.username || "User avatar"}
                          className="w-9 h-9 rounded-full border-2 border-white object-cover bg-white/20"
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <Button
                onClick={shareJackpotCard}
                disabled={sharingCard}
                className="w-full mt-4 bg-white text-black"
              >
                {sharingCard ? "Preparing card..." : "Share Card"}
              </Button>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

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
