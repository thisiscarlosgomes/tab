"use client";

import { useEffect, useState, useMemo } from "react";
import {
  useAccount,
  useConnect,
  useWriteContract,
  useReadContract,
} from "wagmi";
import { base } from "viem/chains";
import { formatUnits, parseAbi } from "viem";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  Check,
  Eraser,
  Info,
  Loader,
  LoaderCircle,
  Minus,
  MoreVertical,
  Plus,
  Shuffle,
} from "lucide-react";
import { SuccessShareDrawer } from "@/components/app/SuccessShareDrawer";
import { createPublicClient, http, erc20Abi } from "viem";
import { Drawer } from "vaul";
import {
  APP_SOURCE_BYTES32,
  CONTRACT_ADDRESS,
  ERC20_TOKEN_ADDRESS,
  JACKPOT_TICKET_NFT_ADDRESS,
  JACKPOT_AUTO_SUBSCRIPTION_ADDRESS,
  REFERRAL_SPLIT_PRECISE_UNIT,
  REFERRER_ADDRESS,
  USDC_DECIMALS,
} from "@/lib/constants";
import { getPreferredConnector } from "@/lib/wallet";
import { usePrivy } from "@privy-io/react-auth";
import {
  useJackpotAmount,
  useTimeRemaining,
  useTicketPrice,
  useTicketPriceInWei,
  useTicketCountForRound,
} from "@/lib/BaseJackpotQueries";
import NumberFlow from "@number-flow/react";
import { Countdown } from "@/components/app/Countdown";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import { parseISO, format } from "date-fns";
import { BUILDER_CODE_DATA_SUFFIX } from "@/lib/builderCode";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
} from "@/components/ui/responsive-dialog";

const ALCHEMY_URL = process.env.NEXT_PUBLIC_ALCHEMY_URL!;

const client = createPublicClient({
  chain: base,
  transport: http(ALCHEMY_URL),
});

const jackpotBuyAbi = parseAbi([
  "function currentDrawingId() view returns (uint256)",
  "function getDrawingState(uint256 drawingId) view returns ((uint256 prizePool,uint256 ticketPrice,uint256 edgePerTicket,uint256 referralWinShare,uint256 referralFee,uint256 globalTicketsBought,uint256 lpEarnings,uint256 drawingTime,uint256 winningTicket,uint8 ballMax,uint8 bonusballMax,address payoutCalculator,bool jackpotLock))",
  "function buyTickets((uint8[] normals,uint8 bonusball)[] tickets,address recipient,address[] referrers,uint256[] referralSplit,bytes32 source) returns (uint256[])",
]);

const jackpotAutoSubscriptionAbi = parseAbi([
  "function createSubscription(address _recipient,uint64 _totalDays,uint64 _dynamicTicketCount,(uint8[] normals,uint8 bonusball)[] _userStaticTickets,address[] _referrers,uint256[] _referralSplit)",
  "function cancelSubscription()",
  "function getSubscriptionInfo(address _recipient) view returns (((uint64 remainingUSDC,uint64 lastExecutedDrawing,uint64 subscribedTicketPrice,uint64 dynamicTicketCount,address[] referrers,uint256[] referralSplit) subscription,(uint8[] normals,uint8 bonusball)[] staticTickets))",
  "function subscriptions(address) view returns (uint64 remainingUSDC,uint64 lastExecutedDrawing,uint64 subscribedTicketPrice,uint64 dynamicTicketCount)",
]);

const jackpotTicketNftAbi = parseAbi([
  "function getUserTickets(address _userAddress, uint256 _drawingId) view returns ((uint256 ticketId,(uint256 drawingId,uint256 packedTicket,bytes32 referralScheme) ticket,uint8[] normals,uint8 bonusball)[])",
]);

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

type TicketPurchase = {
  blockNumber?: string | number;
  ticketsPurchased?: number;
  ticketCount?: number;
  numberOfTickets?: number;
  timestamp?: string | number;
  purchasedAt?: string | number;
  createdAt?: string | number;
  transactionHashes?: string[];
};

type SelectedTicket = {
  normals: number[];
  bonusball: number;
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

function buildRandomTicket(
  ballMax: number,
  bonusballMax: number
): { normals: number[]; bonusball: number } {
  const pool = Array.from({ length: ballMax }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return {
    normals: pool.slice(0, 5).sort((a, b) => a - b),
    bonusball: Math.floor(Math.random() * bonusballMax) + 1,
  };
}

export default function JackpotPage() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { writeContractAsync } = useWriteContract();
  const { dismiss } = useFrameSplash();
  const { user } = usePrivy();

  const [balance, setBalance] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [isCancellingSubscription, setIsCancellingSubscription] = useState(false);
  const [buyStep, setBuyStep] = useState<"idle" | "approving" | "buying">(
    "idle"
  );
  const [justPurchased, setJustPurchased] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showSuccessDrawer, setShowSuccessDrawer] = useState(false);
  const [ticketQuantity, setTicketQuantity] = useState(2);
  const [selectedRecurringDays, setSelectedRecurringDays] = useState(0);
  const [isRecurringDialogOpen, setIsRecurringDialogOpen] = useState(false);
  const [draftRecurringDays, setDraftRecurringDays] = useState(3);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [editingTicketIndex, setEditingTicketIndex] = useState(0);
  const [selectedTickets, setSelectedTickets] = useState<SelectedTicket[]>([]);
  const [draftNormals, setDraftNormals] = useState<number[]>([]);
  const [draftBonusball, setDraftBonusball] = useState<number | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [isActiveTicketsExpanded, setIsActiveTicketsExpanded] = useState(false);

  const [isLoadingBalance, setIsLoadingBalance] = useState(true);

  const { data: ticketPrice, isLoading: loadingPrice } = useTicketPrice(); // USD per ticket
  const { data: ticketPriceInWei } = useTicketPriceInWei(); // raw wei for contract
  const ticketPriceWei = ticketPriceInWei ?? null;

  const [guaranteedPrizes, setGuaranteedPrizes] = useState<
    Record<string, GuaranteedPrizeEntry> | null
  >(null);

  const { data: jackpotAmount, isLoading: isLoadingAmount } =
    useJackpotAmount();
  const { data: timeRemaining, isLoading: isLoadingTime } = useTimeRemaining();
  const { data: ticketCount, isLoading: isLoadingTicketCount } =
    useTicketCountForRound(address);

  const effectiveTicketCount = ticketQuantity;
  const isRecurringEnabled = selectedRecurringDays > 0;
  const recurringDays = isRecurringEnabled ? selectedRecurringDays : 1;

  const cost = ticketPrice ? ticketPrice * effectiveTicketCount * recurringDays : null;

  const costInUsd = ticketPriceWei
    ? parseFloat(
      formatUnits(
        ticketPriceWei * BigInt(effectiveTicketCount) * BigInt(recurringDays),
        USDC_DECIMALS
      )
    )
    : 0;

  const parsedAmount = ticketPriceWei
    ? ticketPriceWei * BigInt(effectiveTicketCount) * BigInt(recurringDays)
    : 0n;

  const insufficientFunds = balance !== null && costInUsd > balance;

  const { data: currentDrawingId } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: jackpotBuyAbi,
    functionName: "currentDrawingId",
  });

  const { data: drawingState } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: jackpotBuyAbi,
    functionName: "getDrawingState",
    args: [currentDrawingId ?? 1n],
    query: { enabled: currentDrawingId !== undefined },
  });
  const { data: activeTicketsSnapshot } = useReadContract({
    address: JACKPOT_TICKET_NFT_ADDRESS,
    abi: jackpotTicketNftAbi,
    functionName: "getUserTickets",
    args: [address ?? "0x", currentDrawingId ?? 1n],
    query: { enabled: !!address && currentDrawingId !== undefined },
  });

  const ballMax = Number((drawingState as { ballMax?: number } | undefined)?.ballMax ?? 30);
  const bonusballMax = Number(
    (drawingState as { bonusballMax?: number } | undefined)?.bonusballMax ?? 12
  );
  const activeTickets = (
    (activeTicketsSnapshot as
      | Array<{ normals?: number[]; bonusball?: number; ticketId?: bigint }>
      | undefined) ?? []
  )
    .map((ticket) => ({
      ticketId: Number(ticket.ticketId ?? 0n),
      normals: (ticket.normals ?? []).map((n) => Number(n)).sort((a, b) => a - b),
      bonusball: Number(ticket.bonusball ?? 0),
    }))
    .filter(
      (ticket) =>
        ticket.normals.length === 5 &&
        Number.isInteger(ticket.bonusball) &&
        ticket.bonusball > 0
    )
    .sort((a, b) => a.ticketId - b.ticketId);
  const visibleActiveTickets = activeTickets.slice(0, 5);
  const hiddenActiveTicketCount = Math.max(0, activeTickets.length - visibleActiveTickets.length);

  useEffect(() => {
    setSelectedTickets((prev) => {
      let next = [...prev];
      if (next.length > ticketQuantity) {
        next = next.slice(0, ticketQuantity);
      }
      while (next.length < ticketQuantity) {
        next.push(buildRandomTicket(ballMax, bonusballMax));
      }
      return next;
    });
  }, [ballMax, bonusballMax, ticketQuantity]);

  const openPicker = (index: number) => {
    const fallback = buildRandomTicket(ballMax, bonusballMax);
    const ticket = selectedTickets[index] ?? fallback;
    setEditingTicketIndex(index);
    setDraftNormals([...ticket.normals]);
    setDraftBonusball(ticket.bonusball);
    setPickerError(null);
    setIsPickerOpen(true);
  };

  const closePicker = () => {
    setIsPickerOpen(false);
    setPickerError(null);
  };

  const openRecurringDialog = () => {
    setDraftRecurringDays(isRecurringEnabled ? selectedRecurringDays : 3);
    setIsRecurringDialogOpen(true);
  };

  const shufflePicker = () => {
    const ticket = buildRandomTicket(ballMax, bonusballMax);
    setDraftNormals(ticket.normals);
    setDraftBonusball(ticket.bonusball);
    setPickerError(null);
  };

  const clearPicker = () => {
    setDraftNormals([]);
    setDraftBonusball(null);
    setPickerError(null);
  };

  const savePicker = () => {
    if (draftNormals.length !== 5 || draftBonusball === null) {
      setPickerError("Select 5 numbers and 1 bonus ball.");
      return;
    }
    setSelectedTickets((prev) =>
      prev.map((ticket, idx) =>
        idx === editingTicketIndex
          ? {
            normals: [...draftNormals].sort((a, b) => a - b),
            bonusball: draftBonusball,
          }
          : ticket
      )
    );
    setIsPickerOpen(false);
    setJustPurchased(false);
    setPickerError(null);
  };

  const toggleDraftNormal = (n: number) => {
    setDraftNormals((prev) => {
      if (prev.includes(n)) return prev.filter((v) => v !== n);
      if (prev.length >= 5) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
    setPickerError(null);
  };

  const { data: staticAllowance, refetch: refetchStaticAllowance } = useReadContract({
    address: ERC20_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address ?? "0x", CONTRACT_ADDRESS],
    query: { enabled: !!address && ticketPriceWei !== null },
  });
  const { data: recurringAllowance, refetch: refetchRecurringAllowance } =
    useReadContract({
      address: ERC20_TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address ?? "0x", JACKPOT_AUTO_SUBSCRIPTION_ADDRESS],
      query: { enabled: !!address && ticketPriceWei !== null },
    });
  const { data: subscriptionInfoSnapshot, refetch: refetchSubscriptionSnapshot } =
    useReadContract({
      address: JACKPOT_AUTO_SUBSCRIPTION_ADDRESS,
      abi: jackpotAutoSubscriptionAbi,
      functionName: "getSubscriptionInfo",
      args: [address ?? "0x"],
      query: { enabled: !!address },
    });
  const { data: subscriptionSnapshotFallback } = useReadContract({
    address: JACKPOT_AUTO_SUBSCRIPTION_ADDRESS,
    abi: jackpotAutoSubscriptionAbi,
    functionName: "subscriptions",
    args: [address ?? "0x"],
    query: { enabled: !!address },
  });

  const subscriptionInfo = subscriptionInfoSnapshot as
    | {
      subscription?: {
        remainingUSDC?: bigint;
        subscribedTicketPrice?: bigint;
        dynamicTicketCount?: bigint;
      };
      staticTickets?: Array<{ normals: number[]; bonusball: number }>;
    }
    | undefined;
  const subscriptionStateFallback = subscriptionSnapshotFallback as
    | { remainingUSDC?: bigint; subscribedTicketPrice?: bigint; dynamicTicketCount?: bigint }
    | undefined;

  const subscriptionRemainingUsdcWei =
    subscriptionInfo?.subscription?.remainingUSDC ??
    subscriptionStateFallback?.remainingUSDC ??
    0n;
  const subscriptionTicketPriceWei =
    subscriptionInfo?.subscription?.subscribedTicketPrice ??
    subscriptionStateFallback?.subscribedTicketPrice ??
    0n;
  const subscriptionDynamicTicketCount =
    subscriptionInfo?.subscription?.dynamicTicketCount ??
    subscriptionStateFallback?.dynamicTicketCount ??
    0n;
  const subscriptionStaticTicketCount = BigInt(
    subscriptionInfo?.staticTickets?.length ?? 0
  );
  const hasActiveSubscription =
    subscriptionRemainingUsdcWei > 0n &&
    (subscriptionTicketPriceWei > 0n ||
      subscriptionDynamicTicketCount > 0n ||
      subscriptionStaticTicketCount > 0n);

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

        const purchases: TicketPurchase[] =
          history.ticketPurchases ?? history.contractData ?? [];
        const grouped: Record<string, number> = {};
        const blockNumberKeys = Array.from(
          new Set(
            purchases
              .map((entry: { blockNumber?: string | number }) =>
                entry?.blockNumber?.toString?.()
              )
              .filter(Boolean)
          )
        ) as string[];
        const blockTimeByNumber = new Map<string, number>();
        const txTimeByHash = new Map<string, number>();
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
        const transactionHashes = Array.from(
          new Set(
            purchases
              .flatMap((entry) => entry?.transactionHashes ?? [])
              .filter(Boolean)
          )
        );
        await Promise.all(
          transactionHashes.map(async (hash) => {
            try {
              const receipt = await client.getTransactionReceipt({
                hash: hash as `0x${string}`,
              });
              const block = await client.getBlock({
                blockNumber: receipt.blockNumber,
              });
              txTimeByHash.set(hash, Number(block.timestamp) * 1000);
            } catch (err) {
              console.error("Failed to resolve tx timestamp", hash, err);
            }
          })
        );

        for (const entry of purchases) {
          const ticketsPurchased =
            Number(entry?.ticketsPurchased) ||
            Number(entry?.ticketCount) ||
            Number(entry?.numberOfTickets) ||
            0;
          if (!ticketsPurchased) continue;

          const directTimestamp =
            typeof entry?.timestamp === "number"
              ? entry.timestamp
              : typeof entry?.timestamp === "string"
                ? Date.parse(entry.timestamp)
                : typeof entry?.purchasedAt === "number"
                  ? entry.purchasedAt
                  : typeof entry?.purchasedAt === "string"
                    ? Date.parse(entry.purchasedAt)
                    : typeof entry?.createdAt === "number"
                      ? entry.createdAt
                      : typeof entry?.createdAt === "string"
                        ? Date.parse(entry.createdAt)
                        : undefined;

          const blockNumberKey = entry?.blockNumber?.toString?.();
          const blockTimestamp = blockNumberKey
            ? blockTimeByNumber.get(blockNumberKey)
            : undefined;
          const hashTimestamp =
            entry?.transactionHashes && entry.transactionHashes.length > 0
              ? txTimeByHash.get(entry.transactionHashes[0])
              : undefined;
          const timestamp = directTimestamp ?? blockTimestamp ?? hashTimestamp;
          if (!timestamp || Number.isNaN(timestamp)) continue;

          const dateObj = new Date(timestamp);
          const key = dateObj.toISOString().split("T")[0];
          grouped[key] = (grouped[key] || 0) + ticketsPurchased;
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
      setPickerError(null);

      setSending(true);
      setBuyStep("approving");

      const spender = isRecurringEnabled
        ? JACKPOT_AUTO_SUBSCRIPTION_ADDRESS
        : CONTRACT_ADDRESS;
      const currentAllowance = isRecurringEnabled
        ? recurringAllowance ?? 0n
        : staticAllowance ?? 0n;
      if (currentAllowance < parsedAmount) {
        const approvalTx = await writeContractAsync({
          address: ERC20_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, parsedAmount],
          chainId: base.id,
          dataSuffix: BUILDER_CODE_DATA_SUFFIX,
        });
        await client.waitForTransactionReceipt({ hash: approvalTx });
        if (isRecurringEnabled) {
          await refetchRecurringAllowance?.();
        } else {
          await refetchStaticAllowance?.();
        }
      }

      setBuyStep("buying");
      if (
        selectedTickets.length !== effectiveTicketCount ||
        selectedTickets.some(
          (ticket) =>
            ticket.normals.length !== 5 ||
            !Number.isInteger(ticket.bonusball) ||
            ticket.bonusball < 1
        )
      ) {
        setPickerError("Each ticket needs 5 numbers and 1 bonus ball.");
        throw new Error("Each ticket needs 5 numbers and 1 bonus ball.");
      }
      const tickets = selectedTickets.slice(0, effectiveTicketCount).map((ticket) => ({
        normals: [...ticket.normals],
        bonusball: ticket.bonusball,
      }));
      const tx = isRecurringEnabled
        ? await writeContractAsync({
          address: JACKPOT_AUTO_SUBSCRIPTION_ADDRESS,
          abi: jackpotAutoSubscriptionAbi,
          functionName: "createSubscription",
          args: [
            address,
            BigInt(selectedRecurringDays),
            0n,
            tickets,
            [REFERRER_ADDRESS],
            [REFERRAL_SPLIT_PRECISE_UNIT],
          ],
          chainId: base.id,
          dataSuffix: BUILDER_CODE_DATA_SUFFIX,
        })
        : await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: jackpotBuyAbi,
          functionName: "buyTickets",
          args: [
            tickets,
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
      setJustPurchased(true);

      // ✅ WAIT FOR CONFIRMATION
      await client.waitForTransactionReceipt({ hash: tx });

      // ✅ EMIT GLOBAL BALANCE + JACKPOT TICKET UPDATE
      window.dispatchEvent(
        new CustomEvent("tab:balance-updated", {
          detail: { jackpotTicketDelta: effectiveTicketCount * recurringDays },
        })
      );

      // Log jackpot entry
      const linkedFid = user?.farcaster?.fid ?? null;

      if (linkedFid) {
        await fetch("/api/jackpot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address,
            amount: costInUsd,
            ticketCount: effectiveTicketCount * recurringDays,
            fid: linkedFid,
            txHash: tx,
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

  const handleCancelSubscription = async () => {
    try {
      if (!isConnected) {
        const preferred = getPreferredConnector(connectors);
        if (!preferred) return;
        await connect({ connector: preferred });
        return;
      }
      if (!address || !hasActiveSubscription) return;

      setIsCancellingSubscription(true);

      const tx = await writeContractAsync({
        address: JACKPOT_AUTO_SUBSCRIPTION_ADDRESS,
        abi: jackpotAutoSubscriptionAbi,
        functionName: "cancelSubscription",
        args: [],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_DATA_SUFFIX,
      });

      await client.waitForTransactionReceipt({ hash: tx });
      await refetchSubscriptionSnapshot?.();
      setSelectedRecurringDays(0);
      window.dispatchEvent(new Event("tab:balance-updated"));
    } catch (error) {
      console.error("Cancel subscription failed", error);
    } finally {
      setIsCancellingSubscription(false);
    }
  };

  const displayTickets = selectedTickets.slice(0, effectiveTicketCount);
  const visibleTickets = displayTickets.slice(0, 5);
  const hiddenTicketCount = Math.max(0, displayTickets.length - 5);

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
      <div className="max-w-sm w-full mx-auto space-y-3">
        <div className="hidden text-center text-md font-medium mb-4 pb-2">
          Buy a lottery ticket for a chance to win big.
        </div>

        <div className="text-center mt-4">
          <p className="opacity-30">Prize Pool (USDC)</p>
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
              className="font-ppangram leading-none text-5xl font-medium text-primary"
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

        <div className="mt-4">
          <div className="hidden flex items-center justify-center mb-2">
            <div className="flex gap-1">
              {[2, 5, 10, 50].map((val) => (
                <button
                  key={val}
                  onClick={() => {
                    setTicketQuantity(val);
                    setJustPurchased(false);
                  }}
                  className={`px-3 py-1.5 text-xs rounded-sm border transition ${ticketQuantity === val
                    ? "border-[#a9a0ed] text-[#d3ceff] bg-[#a9a0ed]/10"
                    : "border-white/15 text-white/65"
                    }`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-lg border-2 border-white/10 px-2 py-2 flex items-center">
            <button
              onClick={() => {
                setTicketQuantity((prev) => Math.max(1, prev - 1));
                setJustPurchased(false);
              }}
              className="w-14 h-10 rounded-sm bg-white/5 flex items-center justify-center"
              aria-label="Decrease ticket quantity"
            >
              <Minus className="h-5 w-5" />
            </button>
            <input
              type="number"
              min={1}
              max={1000}
              value={ticketQuantity}
              onChange={(e) => {
                const raw = Number(e.target.value);
                if (!Number.isFinite(raw)) return;
                const next = Math.max(1, Math.min(1000, Math.floor(raw)));
                setTicketQuantity(next);
                setJustPurchased(false);
              }}
              className="w-full text-center bg-transparent outline-none text-2xl font-semibold"
            />
            <button
              onClick={() => {
                setTicketQuantity((prev) => Math.min(1000, prev + 1));
                setJustPurchased(false);
              }}
              className="w-14 h-10 rounded-sm bg-white/5 flex items-center justify-center"
              aria-label="Increase ticket quantity"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </div>

        <p className="text-center mt-2 text-white/60 hidden">
          Total Tickets:{" "}
          {loadingPrice || cost === null ? "..." : `${cost.toFixed(0)}`}
        </p>

        {pickerError && (
          <p className="text-sm text-red-400 text-center mt-2">{pickerError}</p>
        )}

        <div className="mt-6">
          <Button
            onClick={handleBuy}
            disabled={
              sending ||
              justPurchased ||
              insufficientFunds ||
              effectiveTicketCount <= 0 ||
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
                {isRecurringEnabled ? "Subscribe" : "Buy"} {effectiveTicketCount} Ticket
                {effectiveTicketCount > 1 ? "s" : ""}
                {isRecurringEnabled ? ` for ${selectedRecurringDays} days` : ""}
              </>
            )}
          </Button>
        </div>

        <Button
          type="button"
          variant="ghost"
          onClick={openRecurringDialog}
          className="w-full justify-between text-white/90 border border-white/10 bg-white/[0.02] hover:bg-white/10"
        >
          <span className="inline-flex items-center gap-2">
            <CalendarDays className="w-4 h-4" />
            Recurring days
          </span>
          <span className="text-white/70">
            {isRecurringEnabled ? `${selectedRecurringDays} days` : "Off"}
          </span>
        </Button>
        {hasActiveSubscription ? (
          <div className="space-y-2">

            <Button
              type="button"
              variant="ghost"
              onClick={handleCancelSubscription}
              disabled={isCancellingSubscription || sending}
              className="w-full border border-red-400/30 text-red-300 hover:bg-red-500/10 hover:text-red-200"
            >
              {isCancellingSubscription ? (
                <>
                  <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                  Cancelling...
                </>
              ) : (
                <>Cancel recurring subscription</>
              )}
            </Button>
            <p className="text-xs text-white/55 text-center">
              Active recurring subscription • $
              {Number(formatUnits(subscriptionRemainingUsdcWei, USDC_DECIMALS)).toFixed(2)} remaining
            </p>
          </div>
        ) : null}

        {isConnected &&
        !isLoadingTicketCount &&
        typeof ticketCount === "number" &&
        ticketCount > 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 space-y-3">
            <button
              type="button"
              onClick={() => setIsActiveTicketsExpanded((prev) => !prev)}
              aria-expanded={isActiveTicketsExpanded}
              className="w-full flex items-center justify-between gap-3"
            >
              <p className="text-xs text-primary">Active tickets this draw</p>
              <p className="text-sm font-medium">{Math.max(0, Math.round(ticketCount))}</p>
            </button>
            {isActiveTicketsExpanded ? (
              <div className="space-y-1">
                {visibleActiveTickets.map((ticket, idx) => (
                  <div
                    key={`active-ticket-${ticket.ticketId}-${idx}`}
                    className="border border-white/10 rounded-sm px-3 py-2 bg-white/[0.02]"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {ticket.normals.map((n, nIdx) => (
                        <div
                          key={`active-${ticket.ticketId}-${n}-${nIdx}`}
                          className="w-7 h-7 rounded-full bg-white/10 text-white/60 flex items-center justify-center text-[11px] font-semibold"
                        >
                          {n}
                        </div>
                      ))}
                      <div className="w-7 h-7 rounded-md bg-blue-500/20 text-blue-300 flex items-center justify-center text-[11px] font-semibold">
                        {ticket.bonusball}
                      </div>
                    </div>
                  </div>
                ))}
                {hiddenActiveTicketCount > 0 && (
                  <p className="text-[11px] text-white/45">
                    +{hiddenActiveTicketCount} more active ticket
                    {hiddenActiveTicketCount > 1 ? "s" : ""}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 space-y-2">
          {visibleTickets.map((ticket, idx) => (
            <div
              key={`selected-ticket-${idx}`}
              className="border border-white/10 rounded-2xl px-3 py-3 bg-white/[0.02]"
            >
              <div className="flex items-center gap-1.5">
                {ticket.normals.map((n, nIdx) => (
                  <div
                    key={`${idx}-${n}-${nIdx}`}
                    className="w-8 h-8 rounded-full bg-[#ececf0] text-[#111827] flex items-center justify-center text-xs font-semibold"
                  >
                    {n}
                  </div>
                ))}
                <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-xs font-semibold">
                  {ticket.bonusball}
                </div>
                <button
                  type="button"
                  onClick={() => openPicker(idx)}
                  className="ml-auto p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition"
                  aria-label={`Open number picker for ticket ${idx + 1}`}
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
              <p className="hidden text-[10px] text-white/45 mt-2">Ticket {idx + 1}</p>
            </div>
          ))}
          {hiddenTicketCount > 0 && (
            <p className="text-[11px] text-white/50 px-1">
              +{hiddenTicketCount} more ticket
              {hiddenTicketCount > 1 ? "s" : ""} selected
            </p>
          )}
          <p className="hidden text-[11px] text-white/45">
            Selected numbers are shown per ticket.
          </p>
        </div>

        {/* 💵 Available balance (Morpho-style) */}
        {balance !== null && (
          <p className="hidden text-white/30 text-center text-sm mt-3 mb-1">
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
                const text = `🎁 I won ${prizeAmount} USDC from lottery on @usetab! Claimed on ${claimedDate}.`;
                const url = "https://usetab.app/jackpot";

                try {
                  if (navigator.share) {
                    await navigator.share({
                      title: "Tab Jackpot",
                      text,
                      url,
                    });
                    return;
                  }

                  await navigator.clipboard.writeText(`${text} ${url}`);
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
                    className="hidden mt-2 rounded-[8px] bg-white text-black"
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

        {recentUsers.length > 0 && (
          <div className="hidden flex flex-col items-center w-full mt-6 mb-2">
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
            <div className="hidden flex justify-center mt-1">
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
                <p className="font-ppangram text-4xl font-semibold">
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
          useResponsiveDialog
          triggerConfetti
          showShareButton={false}
        />
      </div>

      <ResponsiveDialog
        open={isRecurringDialogOpen}
        onOpenChange={(open) => setIsRecurringDialogOpen(open)}
      >
        <ResponsiveDialogContent className="top-[80px] bottom-0 p-4 rounded-t-3xl flex flex-col md:top-1/2 md:bottom-auto md:w-full md:max-w-md md:max-h-[85vh] md:overflow-hidden">
          <div className="w-full max-h-[calc(100dvh-120px)] md:max-h-[80vh] overflow-y-auto rounded-2xl bg-background text-white p-4 sm:p-4 space-y-4">
            <div className="text-center space-y-2">
              <p className="text-xl font-semibold leading-tight">Daily Play, Made Easy</p>
              <p className="text-sm text-white/60">
                Automatically play the same tickets each day with a single upfront payment. Cancel whenever you like.
              </p>
            </div>

            <div className="space-y-2">
              {[3, 5, 15].map((days) => {
                const totalTickets = effectiveTicketCount * days;
                const totalCost = ticketPrice ? ticketPrice * totalTickets : null;
                const selected = draftRecurringDays === days;
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setDraftRecurringDays(days)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${selected
                        ? "border-primary bg-primary/10"
                        : "border-white/10 bg-white/[0.02] hover:bg-white/10"
                      }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold">{days} days <span className="text-xs text-primary font-medium">({totalCost === null ? "..." : `$${totalCost.toFixed(2)}`}{" "})</span></p>
                        <p className="hidden text-sm text-white/60">
                          {totalCost === null ? "..." : `$${totalCost.toFixed(2)}`}{" "}
                          <span className="hidden text-[#d1b36a] font-medium">{totalTickets} tickets</span>
                        </p>
                      </div>
                      <div
                        className={`h-5 w-5 rounded-full border-2 ${selected
                            ? "border-primary bg-primary flex items-center justify-center"
                            : "border-white/30"
                          }`}
                      >
                        {selected ? <Check className="h-4 w-4 text-black" /> : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <Button
              type="button"
              onClick={() => {
                setSelectedRecurringDays(draftRecurringDays);
                setIsRecurringDialogOpen(false);
                setJustPurchased(false);
              }}
              className="w-full"
            >
              Confirm
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSelectedRecurringDays(0);
                setIsRecurringDialogOpen(false);
                setJustPurchased(false);
              }}
              className="hidden w-full text-white/70 hover:text-white hover:bg-white/10"
            >
              No thanks, only play once
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={isPickerOpen}
        onOpenChange={(open) => {
          if (!open) closePicker();
          else setIsPickerOpen(true);
        }}
      >
        <ResponsiveDialogContent className="top-[80px] bottom-0 p-4 rounded-t-3xl flex flex-col md:top-1/2 md:bottom-auto md:w-full md:max-w-2xl md:max-h-[85vh] md:overflow-hidden">
          <div className="w-full max-h-[calc(100dvh-120px)] md:max-h-[80vh] overflow-y-auto rounded-2xl bg-background text-white p-4 sm:p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-md font-semibold">


                Numbers{" "}
                <span className="text-white/40">{draftNormals.length} of 5</span>
              </h3>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-white/80 hover:bg-white/10"
                  onClick={shufflePicker}
                >
                  <Shuffle className="w-5 h-5" />
                  Random
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-white/80 hover:bg-white/10"
                  onClick={clearPicker}
                >
                  <Eraser className="w-5 h-5" />
                  Clear
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-6 sm:grid-cols-8 gap-1 sm:gap-2">
              {Array.from({ length: ballMax }, (_, i) => i + 1).map((n) => {
                const selected = draftNormals.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => toggleDraftNormal(n)}
                    className={`h-10 sm:h-10 rounded-full text-sm font-semibold border-2 transition ${selected
                        ? "border-primary text-primary bg-primary/10"
                        : "border-transparent bg-white/10 text-white/80"
                      }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 mb-3">
              <h3 className="text-md font-semibold">
                Bonus <span className="text-white/40">{draftBonusball ? 1 : 0} of 1</span>
              </h3>
            </div>
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 sm:gap-3">
              {Array.from({ length: bonusballMax }, (_, i) => i + 1).map((n) => {
                const selected = draftBonusball === n;
                return (
                  <button
                    key={`b-${n}`}
                    type="button"
                    onClick={() => {
                      setDraftBonusball(n);
                      setPickerError(null);
                    }}
                    className={`h-10 sm:h-10 rounded-full text-lg font-semibold border-2 transition ${selected
                        ? "border-primary text-primary bg-primary/10"
                        : "border-transparent bg-white/10 text-white/80"
                      }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>

            {pickerError && <p className="text-sm text-red-400 mt-3">{pickerError}</p>}

            <Button
              type="button"
              onClick={savePicker}
              className="w-full mt-6"
              disabled={draftNormals.length !== 5 || draftBonusball === null}
            >
              Save
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
