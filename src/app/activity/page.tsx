"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useMemo } from "react";
import {
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
  format,
  isToday,
} from "date-fns";
import { shortAddress } from "@/lib/shortAddress";
import { useRouter } from "next/navigation";
import { useTabIdentity } from "@/lib/useTabIdentity";

import {
  ReceiptText,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Dice5,
  Gamepad2,
  Ticket,
  Sprout,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/user-avatar";

interface ActivityItem {
  type: string;
  amount?: number;
  token?: string;
  txHash?: string;
  description?: string;
  note?: string | null;
  splitId?: string;
  roomId?: string;
  dropId?: string;
  counterparty?: string;
  recipient?: string;
  recipientUsername?: string;
  recipientResolutionSource?: "address" | "ens" | "tab" | "farcaster" | null;
  pfp?: string;
  ticketCount?: number;
  rewarded?: boolean;
  rewardAmount?: number;
  executionMode?: "user_session" | "service_agent" | null;
  agentId?: string | null;
  timestamp: string | Date;
}

const ACTIVITY_CACHE_TTL_MS = 30_000;
const activityCache = new Map<
  string,
  { ts: number; activity: ActivityItem[] }
>();

const ACTIVITY_VISUALS: Record<string, { icon: React.ReactNode; bg: string }> =
  {
    /* Bills */
    bill_created: {
      icon: <ReceiptText className="w-4 h-4" />,
      bg: "bg-blue-500/20 text-blue-300",
    },
    bill_joined: {
      icon: <Plus className="w-4 h-4" />,
      bg: "bg-blue-500/20 text-blue-300",
    },
    bill_invited: {
      icon: <Plus className="w-4 h-4" />,
      bg: "bg-cyan-500/20 text-cyan-300",
    },
    bill_paid: {
      icon: <ArrowUpRight className="w-4 h-4" />,
      bg: "bg-green-500/20 text-green-300",
    },
    bill_received: {
      icon: <ArrowDownLeft className="w-4 h-4" />,
      bg: "bg-emerald-500/20 text-emerald-300",
    },

    /* Rooms */
    room_created: {
      icon: <Dice5 className="w-4 h-4" />,
      bg: "bg-purple-500/20 text-purple-300",
    },
    room_joined: {
      icon: <Gamepad2 className="w-4 h-4" />,
      bg: "bg-purple-500/20 text-purple-300",
    },
    room_invited: {
      icon: <Gamepad2 className="w-4 h-4" />,
      bg: "bg-fuchsia-500/20 text-fuchsia-300",
    },
    room_paid: {
      icon: <ArrowUpRight className="w-4 h-4" />,
      bg: "bg-indigo-500/20 text-indigo-300",
    },
    room_received: {
      icon: <ArrowDownLeft className="w-4 h-4" />,
      bg: "bg-indigo-500/20 text-indigo-300",
    },

    /* Jackpot */
    jackpot_deposit: {
      icon: <Ticket className="w-4 h-4" />,
      bg: "bg-yellow-500/20 text-yellow-300",
    },

    /* Earn */
    earn_deposit: {
      icon: <Sprout className="w-4 h-4" />,
      bg: "bg-green-600/20 text-green-400",
    },
  };

export default function ActivityPage() {
  const { address } = useTabIdentity();
  const router = useRouter();

  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tag, setTag] = useState<"all" | "payments" | "agent" | "other">(
    "all"
  );

  const getRecipientSourceText = (item: ActivityItem) => {
    if (item.executionMode !== "service_agent") return "";
    if (item.recipientResolutionSource === "tab") return " on Tab";
    if (item.recipientResolutionSource === "farcaster") return " via Farcaster";
    return "";
  };

  /* ---------- ACTIVITY FETCH ---------- */
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const fetchActivity = async () => {
      if (!address) {
        setActivity([]);
        setLoading(false);
        return;
      }

      const cached = activityCache.get(address.toLowerCase());
      if (cached && Date.now() - cached.ts < ACTIVITY_CACHE_TTL_MS) {
        setActivity(cached.activity);
        setLoading(false);
      }

      if (!cached) {
        setLoading(true);
      } else if (!(cached && Date.now() - cached.ts < ACTIVITY_CACHE_TTL_MS)) {
        // Show stale cached activity while refreshing in the background.
        setActivity(cached.activity);
        setLoading(false);
      }
      const timeoutId = window.setTimeout(() => controller.abort(), 15000);

      try {
        const qs = new URLSearchParams({
          address,
          limit: "50",
        });

        const res = await fetch(`/api/activity?${qs.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) {
            if (!cached) setActivity([]);
            setLoading(false);
          }
          return;
        }
        const data = await res.json();

        if (!cancelled) {
          const nextActivity = data.activity ?? [];
          setActivity(nextActivity);
          activityCache.set(address.toLowerCase(), {
            ts: Date.now(),
            activity: nextActivity,
          });
        }
      } catch {
        if (!cancelled) {
          if (!cached) setActivity([]);
          setLoading(false);
        }
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchActivity();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [address]);

  /* ---------- FILTERING ---------- */
  const now = new Date();

  const tagFiltered = useMemo(() => {
    return activity.filter((item) => {
      if (tag === "all") return true;
      if (tag === "agent") return item.executionMode === "service_agent";
      if (tag === "payments") {
        return [
          "bill_paid",
          "bill_received",
          "room_paid",
          "room_received",
        ].includes(item.type);
      }
      if (tag === "other") {
        return [
          "bill_created",
          "bill_invited",
          "bill_joined",
          "room_created",
          "room_invited",
          "room_joined",
          "jackpot_deposit",
          "earn_deposit",
        ].includes(item.type);
      }
      return true;
    });
  }, [activity, tag]);

  const groupedSections = useMemo(() => {
    const grouped = tagFiltered.reduce<Record<string, ActivityItem[]>>((acc, item) => {
      const date = new Date(item.timestamp);
      const label = isToday(date) ? "Today" : format(date, "MMMM d, yyyy");

      acc[label] ??= [];
      acc[label].push(item);
      return acc;
    }, {});

    return Object.entries(grouped).sort(([, aItems], [, bItems]) => {
      const aTs = Math.max(
        ...aItems.map((item) => new Date(item.timestamp).getTime()).filter(Number.isFinite)
      );
      const bTs = Math.max(
        ...bItems.map((item) => new Date(item.timestamp).getTime()).filter(Number.isFinite)
      );
      if (!Number.isFinite(aTs) && !Number.isFinite(bTs)) return 0;
      if (!Number.isFinite(aTs)) return 1;
      if (!Number.isFinite(bTs)) return -1;
      return bTs - aTs;
    });
  }, [tagFiltered]);

  const renderLoadingSkeleton = () => (
    <div className="mt-4">
      <ul className="space-y-3">
        {Array.from({ length: 6 }).map((_, idx) => (
          <li
            key={idx}
            className="p-3 border border-white/10 rounded-lg flex justify-between"
          >
            <div className="flex gap-3 items-start w-full">
              <Skeleton className="w-9 h-9 rounded-full shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-4 w-40 mb-2" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-3 w-8" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  /* ---------- RENDER ---------- */
  return (
    <div className="min-h-screen p-4 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(8rem+env(safe-area-inset-bottom))]">
      <div className="max-w-md mx-auto">
        {/* TAG FILTERS */}
        <div className="flex gap-2 mb-4 mt-6">
          {(
            [
              ["all", "All"],
              ["payments", "Payments"],
              ["agent", "Agent"],
              ["other", "Other"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTag(value)}
              className={`px-4 py-2 text-sm rounded-md border ${
                tag === value
                  ? "bg-white text-black border-white"
                  : "border-white/20 text-white/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          renderLoadingSkeleton()
        ) : groupedSections.length === 0 ? (
          <div className="text-center text-white/40 mt-20">
            No activity...
          </div>
        ) : (
          groupedSections.map(([date, items]) => (
              <div key={date} className="mb-6">
                <h2 className="text-white/40 mb-3">{date}</h2>
                <ul className="space-y-3">
                  {items.map((item) => {
                    const key = `${item.type}-${item.timestamp}-${item.splitId ?? item.roomId ?? ""}`;

                    const ts = new Date(item.timestamp);
                    const minutes = differenceInMinutes(now, ts);
                    const hours = differenceInHours(now, ts);
                    const days = differenceInDays(now, ts);

                    const timeLabel =
                      minutes < 60
                        ? `${minutes}m`
                        : hours < 24
                          ? `${hours}h`
                          : `${days}d`;

                    const label =
                      item.type === "bill_joined"
                        ? "You"
                        : item.counterparty
                          ? item.counterparty.startsWith("0x")
                            ? shortAddress(item.counterparty)
                            : `@${item.counterparty}`
                          : item.recipientUsername
                            ? `@${item.recipientUsername}`
                          : "You";
                    const recipientSourceText = getRecipientSourceText(item);

                    const visual = ACTIVITY_VISUALS[item.type] ?? {
                      icon: <span className="text-xs">•</span>,
                      bg: "bg-white/10 text-white/60",
                    };

                    const showAvatar =
                      (item.type === "bill_paid" ||
                        item.type === "bill_received") &&
                      !!item.pfp;

                    return (
                      <li
                        key={key}
                        className="p-3 border border-white/10 rounded-lg hover:bg-white/5 cursor-pointer flex justify-between"
                        onClick={() => {
                          const isTransferOnlyRow =
                            (item.type === "bill_paid" || item.type === "bill_received") &&
                            !item.splitId &&
                            !!item.txHash;
                          if (isTransferOnlyRow && item.txHash) {
                            router.push(`/activity/tx/${item.txHash}`);
                            return;
                          }

                          if (item.roomId) {
                            router.push(`/game/${item.roomId}`);
                            return;
                          }

                          if (item.splitId) {
                            router.push(`/split/${item.splitId}`);
                            return;
                          }

                          if (item.dropId) {
                            router.push(`/claim/${item.dropId}`);
                            return;
                          }

                          // ✅ fallback: homepage
                          router.push("/");
                        }}
                      >
                        <div className="flex gap-3 items-start">
                          {/* ICON */}
                          <div className="shrink-0">
                            {showAvatar ? (
                              <UserAvatar
                                src={item.pfp}
                                seed={item.counterparty ?? item.recipient ?? key}
                                width={36}
                                alt={item.counterparty ?? "User"}
                                className="w-9 h-9 rounded-full object-cover border border-white/10"
                              />
                            ) : (
                              <div
                                className={`w-9 h-9 rounded-full flex items-center justify-center ${visual.bg}`}
                              >
                                {visual.icon}
                              </div>
                            )}
                          </div>

                          {/* TEXT */}
                          <div>
                            <div className="text-white font-medium text-sm flex items-center gap-2">
                              {label}
                              {item.executionMode === "service_agent" && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded border border-primary/40 text-primary/90">
                                  Agent
                                </span>
                              )}
                            </div>

                            <div className="text-white/40 text-sm leading-snug">
                              {(item.description ?? item.type.replace("_", " ")) +
                                (item.type === "bill_paid" ? recipientSourceText : "")}
                            </div>
                            {typeof item.note === "string" && item.note.trim() && (
                              <div className="mt-1">
                                <div className="inline-block max-w-[240px] rounded-md bg-white/5 px-3 py-1 text-white/40 text-xs leading-snug line-clamp-2">
                                  {item.note.trim()}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="text-white/30 text-sm">{timeLabel}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
