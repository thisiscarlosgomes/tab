"use client";

import { useEffect, useState } from "react";
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
import { BadgePlus, UserPlus, Loader, ReceiptText } from "lucide-react";

type ActivityType =
  | "created"
  | "joined"
  | "paid"
  | "received" // ✅ add this
  | "room_created"
  | "room_joined"
  | "room_paid"
  | "room_received";
interface ActivityItem {
  type: ActivityType;
  counterparty?: string;
  amount?: number;
  txHash?: string;
  description: string;
  splitId?: string;
  roomId?: string;
  timestamp: string;
  token: string;
  recipient: string;
  recipientUsername: string;
}

export default function ActivityPage() {
  const { address, isConnected } = useAccount();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

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

  const filteredActivity = activity.filter((item) =>
    [
      "paid",
      "received",
      "room_paid",
      "room_received",
      "room_joined",
      "joined",
    ].includes(item.type)
  );

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

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-16 pb-32 overflow-y-auto scrollbar-hide">
      <div className="mt-4 w-full max-w-md">
        <h1 className="text-xl font-bold mb-4 text-center hidden">Activity</h1>
        {loading ? (
          <div className="flex flex-1 items-center justify-center min-h-[60vh]">
            <Loader className="w-8 h-8 animate-spin text-white/30" />
          </div>
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
                              return "You joined a group bill";
                            case "paid":
                              return `You paid ${item.recipientUsername ? `@${item.recipientUsername}` : shortAddress(item.recipient)} ${item.amount} ${item.token ?? "ETH"}`;
                            case "room_created":
                              return "You created a table";
                            case "room_joined":
                              return "You joined a table";
                            case "room_paid":
                              return `You paid ${item.recipientUsername ? `@${item.recipientUsername}` : shortAddress(item.recipient)} ${parseFloat(item.amount?.toFixed(4) ?? "0")} ${item.token ?? "ETH"}`;
                            case "room_received":
                              return `${item.counterparty ? `@${item.counterparty}` : "Someone"} paid you ${parseFloat(item.amount?.toFixed(4) ?? "0")} ${item.token ?? "ETH"}`;
                            case "received":
                              return `${item.counterparty ? `@${item.counterparty}` : "Someone"} paid you ${item.amount} ${item.token ?? "ETH"}`;
                            default:
                              return "";
                          }
                        })();

                        return (
                          <li
                            key={idx}
                            className="p-4 border-2 rounded-lg hover:bg-white/5 cursor-pointer"
                            onClick={() =>
                              router.push(
                                isRoom
                                  ? `/game/${item.roomId}`
                                  : `/split/${item.splitId}`
                              )
                            }
                          >
                            <div className="flex justify-between items-start mb-1 w-full">
                              {/* Left: Label + Description + Tx */}
                              <div className="flex flex-col">
                                <p className="text-white font-medium">
                                  {label}
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
                                      case "room_joined":
                                        return (
                                          <>
                                            <UserPlus className="w-4 h-4 text-blue-400" />
                                            <span>Joined</span>
                                          </>
                                        );
                                      case "paid":
                                      case "received":
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
