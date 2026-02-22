"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import {
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
  format,
  parseISO,
  isToday,
} from "date-fns";
import { shortAddress } from "@/lib/shortAddress";

import { useRouter } from "next/navigation";
import { BadgePlus, UserPlus, ReceiptText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type ActivityType =
  | "created"
  | "joined"
  | "paid"
  | "received" // ✅ add this
  | "bill_paid"
  | "bill_received"
  | "bill_joined"
  | "room_created"
  | "room_joined"
  | "room_paid"
  | "room_received";
interface ActivityItem {
  type: ActivityType;
  counterparty?: string;
  counterpartyAddress?: string | null;
  amount?: number;
  txHash?: string;
  description: string;
  splitId?: string;
  roomId?: string;
  timestamp: string;
  token?: string;
  recipient?: string;
  recipientUsername?: string;
  recipientResolutionSource?: "address" | "ens" | "tab" | "farcaster" | null;
  executionMode?: "user_session" | "service_agent" | null;
}

type NotificationTag = "all" | "payments" | "joins" | "splits" | "tables" | "agent";

const TAG_OPTIONS: Array<{ key: NotificationTag; label: string }> = [
  { key: "all", label: "All" },
  { key: "payments", label: "Payments" },
  { key: "joins", label: "Joins" },
  { key: "splits", label: "Splits" },
  { key: "tables", label: "Tables" },
  { key: "agent", label: "Agent" },
];

export default function ActivityPage() {
  const { address, isConnected } = useAccount();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTag, setSelectedTag] = useState<NotificationTag>("all");
  const router = useRouter();

  const getRecipientSourceText = (item: ActivityItem) => {
    if (item.executionMode !== "service_agent") return "";
    if (item.recipientResolutionSource === "tab") return " on Tab";
    if (item.recipientResolutionSource === "farcaster") return " via Farcaster";
    return "";
  };

  useEffect(() => {
    const fetchActivity = async () => {
      if (!address) return;
      setLoading(true);
      const res = await fetch(`/api/activity?address=${address}`);
      const data = await res.json();
      setActivity(data.activity || []);
      setLoading(false);
    };

    if (isConnected) fetchActivity();
  }, [isConnected, address]);

  //   const grouped = activity.reduce(
  //     (acc, item) => {
  //       const date = parseISO(item.timestamp);
  //       const dateStr = isToday(date) ? "Today" : format(date, "MMMM d, yyyy");

  //       if (!acc[dateStr]) acc[dateStr] = [];
  //       acc[dateStr].push(item);
  //       return acc;
  //     },
  //     {} as Record<string, ActivityItem[]>
  //   );

  const filteredActivity = useMemo(() => {
    const base = activity.filter((item) =>
      [
        "paid",
        "received",
        "bill_paid",
        "bill_received",
        "room_paid",
        "room_received",
        "room_joined",
        "joined",
        "bill_joined",
      ].includes(item.type)
    );

    return base.filter((item) => {
      if (selectedTag === "all") return true;
      if (selectedTag === "agent") return item.executionMode === "service_agent";
      if (selectedTag === "payments") {
        return [
          "paid",
          "received",
          "bill_paid",
          "bill_received",
          "room_paid",
          "room_received",
        ].includes(item.type);
      }
      if (selectedTag === "joins") {
        return ["joined", "bill_joined", "room_joined"].includes(item.type);
      }
      if (selectedTag === "splits") {
        return ["joined", "bill_joined", "bill_paid", "bill_received"].includes(item.type);
      }
      if (selectedTag === "tables") {
        return ["room_joined", "room_paid", "room_received"].includes(item.type);
      }
      return true;
    });
  }, [activity, selectedTag]);

  const grouped = filteredActivity.reduce(
    (acc, item) => {
      const date = parseISO(item.timestamp);
      const dateStr = isToday(date) ? "Today" : format(date, "MMMM d, yyyy");

      if (!acc[dateStr]) acc[dateStr] = [];
      acc[dateStr].push(item);
      return acc;
    },
    {} as Record<string, ActivityItem[]>
  );

  const renderLoadingSkeleton = () => (
    <div className="mt-4">
      <ul className="space-y-3">
        {Array.from({ length: 7 }).map((_, idx) => (
          <li
            key={idx}
            className="p-4 border-2 rounded-lg border-white/10 flex items-start justify-between"
          >
            <div className="flex-1">
              <Skeleton className="h-4 w-56 mb-2" />
              <Skeleton className="h-3 w-36" />
            </div>
            <div className="ml-4 flex flex-col items-end">
              <Skeleton className="h-3 w-14 mb-2" />
              <Skeleton className="h-3 w-10" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-16 pb-32 overflow-y-auto scrollbar-hide">
      <div className="mt-4 w-full max-w-md">
        <h1 className="text-xl font-bold mb-4 text-center hidden">Activity</h1>
        <div className="mb-4">
          <div className="text-2xl font-semibold mb-3 ml-1">Notifications</div>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide py-1">
            {TAG_OPTIONS.map((tag) => {
              const active = selectedTag === tag.key;
              return (
                <button
                  key={tag.key}
                  type="button"
                  onClick={() => setSelectedTag(tag.key)}
                  className={`px-4 py-2 rounded-xl whitespace-nowrap text-sm border transition ${
                    active
                      ? "bg-white text-black border-white"
                      : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10"
                  }`}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          renderLoadingSkeleton()
        ) : activity.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center min-h-[40vh]">
            <div className="bg-white/5 rounded-sm p-6 shadow-sm w-full px-16 mx-8 max-w-[240px] mb-2" />
            <div className="bg-white/5 rounded-sm p-6 shadow-sm w-full px-16 mx-8 max-w-[200px] mb-2" />

            <p className="text-white/30 text-center text-base mt-2">
              No activity yet. <br />
              You’ll see notifications when you receive or send payments,
              <br />
              or when others join your groups or split bills.
            </p>
          </div>
        ) : (
          <>
            <div>
              {filteredActivity.length === 0 ? (
                <div className="px-2 py-8 text-center text-white/40 text-base">
                  No notifications for this tag yet.
                </div>
              ) : null}
              {Object.entries(grouped)
                .sort(
                  ([a], [b]) => new Date(b).getTime() - new Date(a).getTime()
                ) // newest first
                .map(([date, items]) => (
                  <div key={date} className="mb-6">
                    <h2 className="text-white/40 text-lg d mb-3">{date}</h2>
                    <ul className="space-y-3">
                      {items.map((item, idx) => {
                        const isRoom = item.type.startsWith("room_");
                        const label = (() => {
                          switch (item.type) {
                            case "created":
                              return "You created a group bill";
                            case "joined":
                            case "bill_joined":
                              return "You joined a group bill";
                            case "paid":
                            case "bill_paid": {
                              const recipientLabel =
                                item.recipientUsername
                                  ? `@${item.recipientUsername}`
                                  : item.counterparty
                                    ? item.counterparty.startsWith("0x")
                                      ? shortAddress(item.counterparty)
                                      : `@${item.counterparty}`
                                    : item.recipient
                                      ? shortAddress(item.recipient)
                                      : "recipient";
                              return `You paid ${recipientLabel}${getRecipientSourceText(item)} ${item.amount} ${item.token ?? "ETH"}`;
                            }
                            case "room_created":
                              return "You created a table";
                            case "room_joined":
                              return "You joined a table";
                            case "room_paid":
                              return `You paid ${item.recipientUsername ? `@${item.recipientUsername}` : shortAddress(item.recipient)}${getRecipientSourceText(item)} ${parseFloat(item.amount?.toFixed(4) ?? "0")} ${item.token ?? "ETH"}`;
                            case "room_received":
                              return `${item.counterparty ? `@${item.counterparty}` : "Someone"} paid you ${parseFloat(item.amount?.toFixed(4) ?? "0")} ${item.token ?? "ETH"}`;
                            case "received":
                            case "bill_received":
                              return `${item.counterparty
                                ? item.counterparty.startsWith("0x")
                                  ? shortAddress(item.counterparty)
                                  : `@${item.counterparty}`
                                : item.counterpartyAddress
                                  ? shortAddress(item.counterpartyAddress)
                                  : "Someone"} paid you ${item.amount ?? ""} ${item.token ?? ""}`.trim();
                            default:
                              return "";
                          }
                        })();

                        return (
                          <li
                            key={idx}
                            className="p-4 border-2 rounded-lg hover:bg-white/5 cursor-pointer"
                            onClick={() => {
                              if (isRoom && item.roomId) {
                                router.push(`/game/${item.roomId}`);
                                return;
                              }
                              if (item.splitId) {
                                router.push(`/split/${item.splitId}`);
                              }
                            }}
                          >
                            <div className="flex justify-between items-start mb-1 w-full">
                              {/* Left: Label + Description + Tx */}
                              <div className="flex flex-col">
                                <p className="text-white font-medium">
                                  {label}
                                  {item.executionMode === "service_agent" && (
                                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-primary/40 text-primary/90 align-middle">
                                      Agent
                                    </span>
                                  )}
                                </p>

                                <p className="text-sm text-white/40">
                                  {item.description}
                                </p>

                                {/* {item.txHash && (
                                  <a
                                    href={`https://basescan.org/tx/${item.txHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-primary truncate mt-1"
                                  >
                                    tx: {item.txHash.slice(0, 8)}...
                                  </a>
                                )} */}
                              </div>

                              {/* Right: Timestamp + Action */}
                              <div className="flex flex-col items-end text-sm text-white/50 text-right ml-4">
                                <span className="flex items-center gap-1 mt-0.5">
                                  {(() => {
                                    switch (item.type) {
                                      case "created":
                                      case "room_created":
                                        return (
                                          <>
                                            <BadgePlus className="w-4 h-4 text-primary" />
                                            <span>Created</span>
                                          </>
                                        );
                                      case "joined":
                                      case "bill_joined":
                                      case "room_joined":
                                        return (
                                          <>
                                            <UserPlus className="w-4 h-4 text-blue-400" />
                                            <span>Joined</span>
                                          </>
                                        );
                                      case "paid":
                                      case "received":
                                      case "bill_paid":
                                      case "bill_received":
                                      case "room_received":
                                      case "room_paid":
                                        return (
                                          <>
                                            <ReceiptText className="w-4 h-4 text-active" />
                                            <span>Paid</span>
                                          </>
                                        );
                                      default:
                                        return null;
                                    }
                                  })()}
                                </span>
                                <span className="text-sm text-white/30">
                                  {(() => {
                                    const date = new Date(item.timestamp);
                                    const now = new Date();
                                    const minutes = differenceInMinutes(
                                      now,
                                      date
                                    );
                                    const hours = differenceInHours(now, date);
                                    const days = differenceInDays(now, date);

                                    if (minutes < 60) return `${minutes}m ago`;
                                    if (hours < 24) return `${hours}h ago`;
                                    return `${days}d ago`;
                                  })()}
                                </span>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
