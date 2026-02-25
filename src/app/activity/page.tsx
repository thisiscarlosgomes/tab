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
import { useIdentityToken, useToken } from "@privy-io/react-auth";

import {
  ReceiptText,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Dice5,
  Gamepad2,
  Ticket,
  Sprout,
  Bell,
  X,
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

type WebPushState = {
  configured: boolean;
  vapidPublicKey: string | null;
  subscriptions: Array<{
    endpoint: string;
    platform: string | null;
    enabled?: boolean;
    updatedAt?: string;
    lastSeenAt?: string;
  }>;
};

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

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function detectPushPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    // @ts-expect-error safari legacy
    window.navigator.standalone === true;
  if (isIOS && standalone) return "ios_home_screen";
  if (isIOS) return "ios_safari";
  return "web";
}

export default function ActivityPage() {
  const { address } = useTabIdentity();
  const { identityToken } = useIdentityToken();
  const { getAccessToken } = useToken();
  const router = useRouter();

  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tag, setTag] = useState<"all" | "payments" | "agent" | "other">(
    "all"
  );
  const [pushState, setPushState] = useState<WebPushState | null>(null);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [hidePushPrompt, setHidePushPrompt] = useState(false);

  const getRecipientSourceText = (item: ActivityItem) => {
    if (item.executionMode !== "service_agent") return "";
    if (item.recipientResolutionSource === "tab") return " on Tab";
    if (item.recipientResolutionSource === "farcaster") return " via Farcaster";
    return "";
  };

  const getAuthToken = async () => {
    return identityToken ?? (await getAccessToken().catch(() => null));
  };

  const fetchWebPushState = async () => {
    const token = await getAuthToken();
    if (!token) return;
    const res = await fetch("/api/webpush/subscriptions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => null);
    if (res.ok) setPushState(data);
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

  useEffect(() => {
    if (!address) return;
    try {
      setHidePushPrompt(
        localStorage.getItem(`tab:activity:push-prompt-hidden:${address.toLowerCase()}`) === "1"
      );
    } catch {
      setHidePushPrompt(false);
    }
  }, [address]);

  useEffect(() => {
    void fetchWebPushState();
  }, [identityToken, getAccessToken]);

  const enableWebPush = async () => {
    setPushStatus(null);
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushStatus("This browser does not support web push notifications.");
      return;
    }

    const token = await getAuthToken();
    if (!token) {
      setPushStatus("Sign in required.");
      return;
    }

    setPushLoading(true);
    try {
      const statusRes = await fetch("/api/webpush/subscriptions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const statusJson = (await statusRes.json().catch(() => null)) as WebPushState | null;
      if (!statusRes.ok) throw new Error("Failed to load push settings");
      setPushState(statusJson);

      if (!statusJson?.configured || !statusJson.vapidPublicKey) {
        throw new Error("Web push is not configured on the server yet.");
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission was not granted.");
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(statusJson.vapidPublicKey),
        }));

      const saveRes = await fetch("/api/webpush/subscriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          platform: detectPushPlatform(),
        }),
      });
      const saveJson = await saveRes.json().catch(() => null);
      if (!saveRes.ok) throw new Error(saveJson?.error ?? "Failed to save push subscription");

      setPushStatus("Web notifications enabled.");
      if (address) {
        try {
          localStorage.setItem(
            `tab:activity:push-prompt-hidden:${address.toLowerCase()}`,
            "1"
          );
        } catch {}
      }
      setHidePushPrompt(true);
      await fetchWebPushState();
    } catch (error) {
      setPushStatus(error instanceof Error ? error.message : "Failed to enable notifications");
    } finally {
      setPushLoading(false);
    }
  };

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

  const showPushPromptCard = Boolean(
    !hidePushPrompt &&
      pushState &&
      pushState.configured &&
      (pushState.subscriptions?.length ?? 0) === 0
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

        {showPushPromptCard && (
          <div className="mb-4 rounded-2xl bg-white/5 border border-white/10 p-4">
            <div className="relative">
              <button
                type="button"
                aria-label="Dismiss notification prompt"
                className="absolute right-0 top-0 text-white/40 hover:text-white/70"
                onClick={() => {
                  setHidePushPrompt(true);
                  if (!address) return;
                  try {
                    localStorage.setItem(
                      `tab:activity:push-prompt-hidden:${address.toLowerCase()}`,
                      "1"
                    );
                  } catch {}
                }}
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex flex-col items-center text-center pt-1">
               
                <p className="text-white text-md font-semibold">Never miss a payment</p>
                <p className="mt-1 text-white/50 text-xs max-w-[22rem]">
                  Allow notifications for updates and reminders.
                </p>
                <button
                  type="button"
                  disabled={pushLoading}
                  onClick={() => void enableWebPush()}
                  className="mt-4 w-full rounded-md bg-primary py-3 font-semibold text-black disabled:opacity-60"
                >
                  {pushLoading ? "Turning on..." : "Turn on"}
                </button>
                {pushStatus ? (
                  <p className="mt-2 text-xs text-white/50">{pushStatus}</p>
                ) : null}
              </div>
            </div>
          </div>
        )}

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
