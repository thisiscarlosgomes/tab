"use client";

import { useEffect, useState, useMemo } from "react";
import { useAccount } from "wagmi";
import {
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
  format,
  isToday,
} from "date-fns";
import { shortAddress } from "@/lib/shortAddress";
import sdk from "@farcaster/frame-sdk";
import { useRouter } from "next/navigation";

import {
  Loader,
  ReceiptText,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Dice5,
  Gamepad2,
  Ticket,
  Sprout,
} from "lucide-react";

interface ActivityItem {
  type: string;
  amount?: number;
  token?: string;
  description?: string;
  splitId?: string;
  roomId?: string;
  dropId?: string;
  counterparty?: string;
  recipient?: string;
  recipientUsername?: string;
  pfp?: string;
  ticketCount?: number;
  rewarded?: boolean;
  rewardAmount?: number;
  timestamp: string | Date;
}

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
  const { address, isConnected } = useAccount();
  const router = useRouter();

  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [friends, setFriends] = useState<Set<string>>(new Set());
  const [myUsername, setMyUsername] = useState<string | null>(null);
  const [range, setRange] = useState<"7d" | "30d" | "all">("7d");

  /* ---------- USER CONTEXT ---------- */
  useEffect(() => {
    sdk.context.then((ctx) => {
      setMyUsername(ctx.user?.username?.toLowerCase() ?? null);
    });
  }, []);

  useEffect(() => {
    const loadFriends = async () => {
      if (!address) return;

      const ctx = await sdk.context;
      if (!ctx.user?.username) return;

      const res = await fetch(
        `/api/neynar/user/following?username=${ctx.user.username}`
      );
      const data = await res.json();

      const set = new Set<string>();
      if (Array.isArray(data)) {
        data.forEach((e) => {
          if (e?.user?.username) set.add(e.user.username.toLowerCase());
        });
      }
      setFriends(set);
    };

    loadFriends();
  }, [address]);

  /* ---------- ACTIVITY FETCH ---------- */
  useEffect(() => {
    if (!isConnected || !address) return;

    const fetchActivity = async () => {
      setLoading(true);

      const qs = new URLSearchParams({
        address,
        limit: "50",
        ...(cursor ? { before: cursor } : {}),
      });

      const res = await fetch(`/api/activity?${qs.toString()}`);
      const data = await res.json();

      setActivity(data.activity ?? []);
      setCursor(data.nextCursor ?? null);
      setLoading(false);
    };

    fetchActivity();
  }, [isConnected, address]);

  /* ---------- FILTERING ---------- */
  const now = new Date();

  const timeFiltered = useMemo(() => {
    if (range === "all") return activity;

    const days = range === "7d" ? 7 : 30;

    return activity.filter((item) => {
      const ts = new Date(item.timestamp);
      return differenceInDays(now, ts) <= days;
    });
  }, [activity, range]);

  const grouped = useMemo(() => {
    return timeFiltered.reduce<Record<string, ActivityItem[]>>((acc, item) => {
      const date = new Date(item.timestamp);
      const label = isToday(date) ? "Today" : format(date, "MMMM d, yyyy");

      acc[label] ??= [];
      acc[label].push(item);
      return acc;
    }, {});
  }, [timeFiltered]);

  /* ---------- RENDER ---------- */
  return (
    <div className="min-h-screen p-4 pt-16 pb-32">
      <div className="max-w-md mx-auto">
        {/* RANGE */}
        <div className="flex gap-2 mb-4 mt-6">
          {(["7d", "30d", "all"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-4 py-2 text-sm rounded-md border ${
                range === r
                  ? "bg-white text-black border-white"
                  : "border-white/20 text-white/60"
              }`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center mt-20">
            <Loader className="animate-spin text-white/30" />
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="text-center text-white/40 mt-20">
            Once you start marking transactions, they will appear here.
          </div>
        ) : (
          Object.entries(grouped)
            .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
            .map(([date, items]) => (
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
                          ? `@${item.counterparty}`
                          : item.recipientUsername
                            ? `@${item.recipientUsername}`
                            : "You";

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
                              <img
                                src={item.pfp}
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
                            </div>

                            <div className="text-white/40 text-sm leading-snug">
                              {item.description ?? item.type.replace("_", " ")}
                            </div>
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
