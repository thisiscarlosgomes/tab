"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  ArrowUp,
  BarChart3,
  Coins,
  Loader2,
  SendHorizonal,
  TrendingDown,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FormEvent, type ComponentType, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useIdentityToken, usePrivy, useToken } from "@privy-io/react-auth";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";

type ToolPreviewPart = {
  type?: string;
  state?: string;
  output?: {
    [key: string]: unknown;
  };
  input?: Record<string, unknown>;
  errorText?: string;
};

type StarterPrompt = {
  key: string;
  eyebrow: string;
  title: string;
  prompt: string;
  icon: ComponentType<{ className?: string }>;
  iconTone: string;
};

const BASE_STARTER_PROMPTS: StarterPrompt[] = [
  {
    key: "portfolio",
    eyebrow: "Portfolio",
    title: "How much do I have right now?",
    prompt: "What is my total portfolio balance?",
    icon: Wallet,
    iconTone: "bg-[#edf0ff] text-[#3c4c9e]",
  },
  {
    key: "spending",
    eyebrow: "Spending",
    title: "Show spend this week.",
    prompt: "How much did I spend this week?",
    icon: TrendingDown,
    iconTone: "bg-[#f4ecd8] text-[#7a5d2d]",
  },
  {
    key: "splits",
    eyebrow: "Splits",
    title: "Show my latest and paid splits.",
    prompt: "Show my latest splits and which ones are paid.",
    icon: BarChart3,
    iconTone: "bg-[#e7f7e8] text-[#206a34]",
  },
  {
    key: "earn",
    eyebrow: "Earnings",
    title: "Show earnings details.",
    prompt: "Show my earnings breakdown in detail.",
    icon: Coins,
    iconTone: "bg-[#fbe8dc] text-[#a95c29]",
  },
];

function isToolPart(part: unknown): part is ToolPreviewPart {
  return Boolean(
    part &&
      typeof part === "object" &&
      typeof (part as { type?: unknown }).type === "string" &&
      String((part as { type?: string }).type).startsWith("tool-")
  );
}

function getTextParts(message: unknown) {
  if (!message || typeof message !== "object") return [];
  const parts = (message as { parts?: unknown[] }).parts;
  if (!Array.isArray(parts)) return [];
  return parts.filter(
    (part): part is { type: "text"; text: string } =>
      Boolean(
        part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string"
      )
  );
}

function getToolParts(message: unknown) {
  if (!message || typeof message !== "object") return [];
  const parts = (message as { parts?: unknown[] }).parts;
  if (!Array.isArray(parts)) return [];
  return parts.filter(isToolPart);
}

function prettifyToolName(type?: string) {
  return String(type ?? "tool").replace(/^tool-/, "").replace(/_/g, " ").trim();
}

function getToolOutput(part: ToolPreviewPart) {
  return (part.output && typeof part.output === "object" ? part.output : {}) as Record<
    string,
    unknown
  >;
}

function renderInlineMarkdown(text: string) {
  const nodes: Array<string | JSX.Element> = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(
      <span key={`b-${match.index}`} className="font-semibold text-white">
        {match[1]}
      </span>
    );
    last = regex.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));

  return nodes.length ? nodes : text;
}

function shortWallet(value: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeAddress(value: unknown) {
  const v = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(v) ? v : null;
}

export function AssistantChatPage() {
  const pathname = usePathname();
  const { user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { getAccessToken } = useToken();

  const [input, setInput] = useState("");
  const [quickStats, setQuickStats] = useState<{
    portfolioUsd: number | null;
    weekSentUsd: number | null;
    weekDeltaPct: number | null;
    weekTopRecipient: string | null;
    splitPaidCount: number | null;
    splitPendingCount: number | null;
    earnBalanceUsd: number | null;
    earnYearlyUsd: number | null;
  }>({
    portfolioUsd: null,
    weekSentUsd: null,
    weekDeltaPct: null,
    weekTopRecipient: null,
    splitPaidCount: null,
    splitPendingCount: null,
    earnBalanceUsd: null,
    earnYearlyUsd: null,
  });

  const context = useMemo(
    () => ({
      pathname: pathname ?? "/assistant",
    }),
    [pathname]
  );

  const greetingName = useMemo(() => {
    const farcaster = user?.farcaster;
    const displayName =
      farcaster && typeof farcaster === "object" && "displayName" in farcaster
        ? String((farcaster as { displayName?: unknown }).displayName ?? "")
        : "";
    const username = typeof farcaster?.username === "string" ? farcaster.username : null;
    const source = displayName.trim() || username || "there";
    const first = source.trim().split(/\s+/)[0] || "there";
    return first;
  }, [user]);

  const primaryAddress = useMemo(() => {
    const linked = user?.linkedAccounts ?? [];
    for (const account of linked) {
      if (account.type !== "wallet") continue;
      const walletClientType = String(account.walletClientType ?? "").toLowerCase();
      if (!walletClientType.includes("privy")) continue;
      const address = normalizeAddress(account.address);
      if (address) return address;
    }
    return null;
  }, [user?.linkedAccounts]);

  const starterPrompts = useMemo(() => {
    const items = BASE_STARTER_PROMPTS.map((item) => {
      if (item.key === "portfolio" && quickStats.portfolioUsd !== null) {
        return {
          ...item,
          title: `Portfolio: $${quickStats.portfolioUsd.toFixed(2)}. Want to see a breakdown?`,
          prompt: "Show my wallet breakdown by token.",
        };
      }
      if (item.key === "spending" && quickStats.weekSentUsd !== null) {
        const delta = quickStats.weekDeltaPct;
        const hasDelta = typeof delta === "number" && Number.isFinite(delta);
        const trendUp = hasDelta ? delta > 0 : false;
        const trendLabel = hasDelta
          ? trendUp
            ? "Spending's up"
            : "Spending's down"
          : "Weekly spending";
        const deltaText = hasDelta ? `${Math.abs(delta).toFixed(0)}% ${trendUp ? "more" : "less"}` : "this week";
        const recipientText = quickStats.weekTopRecipient
          ? ` Mostly to ${quickStats.weekTopRecipient}.`
          : "";
        return {
          ...item,
          eyebrow: trendLabel,
          title: `You sent $${quickStats.weekSentUsd.toFixed(2)} ${hasDelta ? `(${deltaText})` : "this week"}.${recipientText} See details?`,
        };
      }
      if (
        item.key === "splits" &&
        quickStats.splitPendingCount !== null &&
        quickStats.splitPaidCount !== null
      ) {
        const pending = quickStats.splitPendingCount;
        const paid = quickStats.splitPaidCount;
        const pendingCopy =
          pending > 0
            ? `${pending} split${pending === 1 ? "" : "s"} still pending.`
            : "No pending splits.";
        return {
          ...item,
          eyebrow: pending > 0 ? "Needs attention" : "Splits on track",
          title: `${pendingCopy} ${paid} paid. See latest?`,
          prompt: "Show my latest splits with paid and pending status.",
        };
      }
      if (item.key === "earn" && quickStats.earnBalanceUsd !== null) {
        const deposit = quickStats.earnBalanceUsd;
        const yearly = quickStats.earnYearlyUsd ?? 0;
        return {
          ...item,
          title: `You’re earning +$${yearly.toFixed(2)}/yr on $${deposit.toFixed(2)}. See breakdown?`,
          prompt: "Show my earnings breakdown with APY and deposit details.",
        };
      }
      return item;
    });
    return items.filter((item) => {
      if (item.key === "portfolio") return quickStats.portfolioUsd !== null;
      if (item.key === "spending") return quickStats.weekSentUsd !== null;
      if (item.key === "splits")
        return quickStats.splitPendingCount !== null && quickStats.splitPaidCount !== null;
      if (item.key === "earn") return quickStats.earnBalanceUsd !== null;
      return true;
    });
  }, [
    quickStats.portfolioUsd,
    quickStats.weekDeltaPct,
    quickStats.weekTopRecipient,
    quickStats.weekSentUsd,
    quickStats.splitPaidCount,
    quickStats.splitPendingCount,
    quickStats.earnBalanceUsd,
    quickStats.earnYearlyUsd,
  ]);

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  useEffect(() => {
    let cancelled = false;
    if (!primaryAddress) return;

    const weekStart = (() => {
      const now = new Date();
      const day = now.getUTCDay();
      const diff = (day + 6) % 7;
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      d.setUTCDate(d.getUTCDate() - diff);
      return d;
    })();
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);

    const isOutgoing = (type?: unknown) => {
      const t = String(type ?? "").toLowerCase();
      return t === "bill_paid" || t === "room_paid";
    };

    const usdAmountFromActivity = (activity: { amount?: unknown; token?: unknown }) => {
      const amount = Number(activity.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) return 0;
      const token = String(activity.token ?? "").trim().toUpperCase();
      return ["USDC", "USDC.E", "USDT", "DAI", "EURC", "USD"].includes(token) ? amount : 0;
    };

    const loadStats = async () => {
      try {
        const splitParams = new URLSearchParams({ address: primaryAddress, limit: "20" });
        const fid = Number(user?.farcaster?.fid ?? 0);
        if (Number.isFinite(fid) && fid > 0) splitParams.set("fid", String(fid));
        const [portfolioRes, activityRes, billsRes, vaultPositionRes, vaultApyRes] = await Promise.all([
          fetch(`/api/moralis/portfolio?address=${primaryAddress}`),
          fetch(`/api/activity?address=${primaryAddress}&limit=100`),
          fetch(`/api/user-bills?${splitParams.toString()}`),
          fetch("https://blue-api.morpho.org/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `
                query GetUserVaultPositions($address: String!, $chainId: Int!) {
                  userByAddress(address: $address, chainId: $chainId) {
                    vaultPositions {
                      state {
                        assetsUsd
                      }
                      vault {
                        address
                      }
                    }
                  }
                }
              `,
              variables: {
                address: primaryAddress,
                chainId: 8453,
              },
            }),
          }),
          fetch("https://blue-api.morpho.org/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `
                query VaultByAddress($address: String!, $chainId: Int) {
                  vaultByAddress(address: $address, chainId: $chainId) {
                    state {
                      netApy
                    }
                  }
                }
              `,
              variables: {
                address: "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca",
                chainId: 8453,
              },
            }),
          }),
        ]);

        const portfolioJson = (await portfolioRes.json().catch(() => null)) as
          | { totalBalanceUSD?: number }
          | null;
        const activityJson = (await activityRes.json().catch(() => null)) as
          | { activity?: Array<{ type?: string; timestamp?: string; amount?: number; token?: string }> }
          | null;
        const billsJson = (await billsRes.json().catch(() => null)) as
          | {
              bills?: Array<{ hasPaid?: boolean }>;
            }
          | null;
        const vaultPositionJson = (await vaultPositionRes.json().catch(() => null)) as
          | {
              data?: {
                userByAddress?: {
                  vaultPositions?: Array<{
                    state?: { assetsUsd?: number };
                    vault?: { address?: string };
                  }>;
                };
              };
            }
          | null;
        const vaultApyJson = (await vaultApyRes.json().catch(() => null)) as
          | {
              data?: {
                vaultByAddress?: {
                  state?: {
                    netApy?: number;
                  };
                };
              };
            }
          | null;

        const portfolioUsd = Number(portfolioJson?.totalBalanceUSD ?? 0);
        const activity = Array.isArray(activityJson?.activity) ? activityJson!.activity! : [];
        const weekSentUsd = activity
          .filter((a) => isOutgoing(a.type))
          .filter((a) => {
            const ts = new Date(String(a.timestamp ?? ""));
            return !Number.isNaN(ts.getTime()) && ts >= weekStart;
          })
          .reduce((sum, a) => sum + usdAmountFromActivity(a), 0);
        const weeklyOutgoing = activity.filter((a) => {
          if (!isOutgoing(a.type)) return false;
          const ts = new Date(String(a.timestamp ?? ""));
          return !Number.isNaN(ts.getTime()) && ts >= weekStart;
        });
        const recipientTotals = new Map<string, { usd: number; label: string; address: string | null }>();
        for (const a of weeklyOutgoing) {
          const labelRaw = (a as { recipientUsername?: string; counterparty?: string; recipient?: string; counterpartyAddress?: string });
          const addressRaw =
            (typeof labelRaw.recipient === "string" && normalizeAddress(labelRaw.recipient)) ||
            (typeof labelRaw.counterpartyAddress === "string" && normalizeAddress(labelRaw.counterpartyAddress)) ||
            null;
          const label =
            (typeof labelRaw.recipientUsername === "string" && labelRaw.recipientUsername.trim()) ||
            (typeof labelRaw.counterparty === "string" && labelRaw.counterparty.trim()) ||
            (typeof labelRaw.recipient === "string" && labelRaw.recipient.trim()) ||
            (typeof labelRaw.counterpartyAddress === "string" && labelRaw.counterpartyAddress.trim()) ||
            "";
          if (!label) continue;
          const usd = usdAmountFromActivity(a);
          if (usd <= 0) continue;
          const key = addressRaw || label.toLowerCase();
          const prev = recipientTotals.get(key) ?? { usd: 0, label, address: addressRaw };
          prev.usd += usd;
          if (!prev.address && addressRaw) prev.address = addressRaw;
          if (!prev.label && label) prev.label = label;
          recipientTotals.set(key, prev);
        }
        const topRecipientEntry =
          [...recipientTotals.values()].sort((a, b) => b.usd - a.usd)[0] ?? null;
        let weekTopRecipient = topRecipientEntry?.label ?? null;
        const topAddress = topRecipientEntry?.address ?? null;
        if (topAddress) {
          try {
            const [tabRes, farcasterRes] = await Promise.all([
              fetch(`/api/user/by-address/${topAddress}`),
              fetch(`/api/neynar/user/by-address/${topAddress}`),
            ]);
            const tabJson = (await tabRes.json().catch(() => null)) as
              | { profile?: { username?: string | null; displayName?: string | null } | null }
              | null;
            const farcasterJson = (await farcasterRes.json().catch(() => null)) as
              | { username?: string | null }
              | null;
            const resolvedUsername =
              (typeof tabJson?.profile?.username === "string" && tabJson.profile.username.trim()) ||
              (typeof farcasterJson?.username === "string" && farcasterJson.username.trim()) ||
              null;
            if (resolvedUsername) {
              weekTopRecipient = resolvedUsername.startsWith("@")
                ? resolvedUsername
                : `@${resolvedUsername}`;
            }
          } catch {
            // Keep label fallback if resolution fails.
          }
        }
        const lastWeekSentUsd = activity
          .filter((a) => isOutgoing(a.type))
          .filter((a) => {
            const ts = new Date(String(a.timestamp ?? ""));
            return !Number.isNaN(ts.getTime()) && ts >= lastWeekStart && ts < weekStart;
          })
          .reduce((sum, a) => sum + usdAmountFromActivity(a), 0);
        const weekDeltaPct =
          lastWeekSentUsd > 0
            ? ((weekSentUsd - lastWeekSentUsd) / lastWeekSentUsd) * 100
            : null;
        const bills = Array.isArray(billsJson?.bills) ? billsJson.bills : [];
        const splitPaidCount = bills.filter((b) => b?.hasPaid === true).length;
        const splitPendingCount = bills.filter((b) => b?.hasPaid === false).length;
        const vaultAddress = "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca";
        const positions = vaultPositionJson?.data?.userByAddress?.vaultPositions ?? [];
        const vaultPosition = positions.find(
          (p) => p?.vault?.address?.toLowerCase() === vaultAddress.toLowerCase()
        );
        const earnBalanceUsd = Number(vaultPosition?.state?.assetsUsd ?? 0);
        const netApy = Number(vaultApyJson?.data?.vaultByAddress?.state?.netApy ?? 0);
        const yearlyRaw = earnBalanceUsd * netApy;
        const formatMonthlyEarnings = (value: number) => {
          if (value <= 0) return "0.00";
          if (value < 0.000001) return "<0.000001";
          if (value < 0.01) return value.toFixed(6);
          return value.toFixed(2);
        };
        const earnYearlyUsd = Number(formatMonthlyEarnings(yearlyRaw).replace("<", ""));

        if (!cancelled) {
          setQuickStats({
            portfolioUsd: portfolioUsd,
            weekSentUsd: weekSentUsd,
            weekDeltaPct,
            weekTopRecipient,
            splitPaidCount,
            splitPendingCount,
            earnBalanceUsd,
            earnYearlyUsd,
          });
        }
      } catch {
        if (!cancelled) {
          setQuickStats((prev) => prev);
        }
      }
    };

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [primaryAddress, user?.farcaster?.fid]);

  const isStreaming = status === "submitted" || status === "streaming";
  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === "assistant");
  const hasToolLoading = useMemo(
    () =>
      messages.some((message) =>
        getToolParts(message).some(
          (part) => Boolean(part.state) && part.state !== "output-available"
        )
      ),
    [messages]
  );

  const shouldShowGlobalLoading = useMemo(() => {
    if (!isStreaming || hasToolLoading) return false;
    if (!lastAssistantMessage) return true;

    const hasAssistantText = getTextParts(lastAssistantMessage).some(
      (part) => part.text.trim().length > 0
    );
    const hasToolOutput = getToolParts(lastAssistantMessage).some((part) => {
      const hasOutputObject = Boolean(part.output && typeof part.output === "object");
      return part.state === "output-available" || hasOutputObject;
    });

    return !hasAssistantText && !hasToolOutput;
  }, [isStreaming, hasToolLoading, lastAssistantMessage]);
  const starterCardsLoading = Boolean(
    messages.length === 0 && primaryAddress && starterPrompts.length === 0
  );

  async function getBearer() {
    const accessToken = await getAccessToken().catch(() => null);
    if (accessToken) return accessToken;
    return identityToken ?? null;
  }

  async function submitMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const bearer = await getBearer();
    if (!bearer) return;

    await sendMessage(
      { text: trimmed },
      {
        headers: { Authorization: `Bearer ${bearer}` },
        body: { context },
      }
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    const next = input;
    setInput("");
    await submitMessage(next);
  }

  async function onQuickPrompt(text: string) {
    if (isStreaming) return;
    await submitMessage(text);
  }

  function onClearChat() {
    if (isStreaming) return;
    setMessages([]);
    setInput("");
  }

  function renderToolCard(part: ToolPreviewPart, idxKey: string) {
    const output = getToolOutput(part);
    const toolName = prettifyToolName(part.type);
    const isLoadingState = part.state ? part.state !== "output-available" : false;
    const isFailure = output.ok === false || typeof part.errorText === "string";

    if (isLoadingState) {
      if (String(part.type ?? "").includes("check_portfolio_balance")) {
        const requestedBreakdown = Boolean(
          part.input &&
            typeof part.input === "object" &&
            (part.input as { breakdown?: unknown }).breakdown === true
        );

        if (!requestedBreakdown) {
          return (
            <div key={idxKey} className="inline-flex items-center gap-2 text-sm text-white/65">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking portfolio
            </div>
          );
        }

        return (
          <div
            key={idxKey}
            className="rounded-[24px] border border-white/10 bg-white/5 p-4 shadow-sm"
          >
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-3 w-28 border-white/0 bg-white/10" />
              <Skeleton className="h-10 w-36 border-white/0 bg-white/10" />
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-6 w-full border-white/0 bg-white/10" />
                <Skeleton className="h-6 w-full border-white/0 bg-white/10" />
              </div>
            </div>
          </div>
        );
      }

      return (
        <div key={idxKey} className="inline-flex items-center gap-2 text-sm text-white/65">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading
        </div>
      );
    }

    if (isFailure) {
      return (
        <div
          key={idxKey}
          className="rounded-[20px] border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200"
        >
          <div className="text-xs uppercase tracking-wide text-red-300">{toolName}</div>
          <div className="mt-1 font-medium">
            {String(output.error ?? part.errorText ?? "Something went wrong")}
          </div>
          {typeof output.status === "number" ? (
            <div className="mt-1 text-xs text-red-700/70">Status {output.status}</div>
          ) : null}
        </div>
      );
    }

    if (String(part.type ?? "").includes("check_portfolio_balance")) {
      const showCards = output.showCards === true;
      if (!showCards) {
        const total = Number(output.totalUsd ?? output.totalBalanceUSD ?? 0);

        return (
          <div key={idxKey} className="mt-1">
            <div className="text-[15px] text-white/65">Total wallet balance</div>
            <div className="mt-1 text-[62px] leading-[0.95] font-semibold tracking-tight text-white">
              ${total.toFixed(2)}
            </div>
          </div>
        );
      }

      const tokens = Array.isArray(output.tokens)
        ? (output.tokens as Array<Record<string, unknown>>)
        : [];
      if (!tokens.length) return null;

      return (
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pr-6 md:pr-2 scrollbar-hide">
          {tokens.map((token, i) => {
            const symbol = String(token.symbol ?? "TOKEN");
            const balance = Number(token.balance ?? 0);
            const usd = Number(token.balanceUSD ?? 0);
            return (
              <div
                key={`${idxKey}-token-${i}`}
                className="min-w-[88%] max-w-[88%] snap-start rounded-[24px] border border-white/10 bg-white/5 p-4 md:min-w-[31%] md:max-w-[31%] shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-white/45">{symbol}</div>
                  <div className="mt-1 text-[46px] leading-[0.98] font-semibold tracking-tight text-white">
                    {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </div>
                  <div className="mt-4 flex items-center justify-between text-sm">
                    <span className="text-white/65">USD value</span>
                    <span className="font-medium text-white">${usd.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (String(part.type ?? "").includes("get_spending_overview")) {
      const total = Number(output.periodTotalUsd ?? 0);
      const period = String(output.period ?? "today");
      const top =
        output.topSentWallet && typeof output.topSentWallet === "object"
          ? (output.topSentWallet as { target?: unknown; targetLabel?: unknown })
          : null;
      const topDisplayLabel =
        typeof top?.targetLabel === "string" && top.targetLabel.trim()
          ? top.targetLabel.trim()
          : null;
      return (
        <div key={idxKey} className="mt-1">
          <div className="text-[15px] text-white/65">
            {period === "all" ? "Historical spending" : period === "week" ? "This week spending" : "Today spending"}
          </div>
          <div className="mt-1 text-[62px] leading-[0.95] font-semibold tracking-tight text-white">
            ${total.toFixed(2)}
          </div>
          {top?.target ? (
            <div className="mt-2 text-sm text-white/60">
              Top sent wallet: {topDisplayLabel ?? shortWallet(String(top.target))}
            </div>
          ) : null}
        </div>
      );
    }

    if (String(part.type ?? "").includes("get_earnings_overview")) {
      const total = Number(output.totalDepositedUsd ?? 0);
      const netApy = Number(output.netApy ?? Number.NaN);
      const yearly = Number(output.yearlyAtCurrentRateUsd ?? Number.NaN);
      const hasApy = Number.isFinite(netApy);
      const hasYearly = Number.isFinite(yearly);
      return (
        <div key={idxKey} className="mt-1">
          <div className="text-[15px] text-white/65">Total earnings deposits</div>
          <div className="mt-1 text-[62px] leading-[0.95] font-semibold tracking-tight text-white">
            ${total.toFixed(2)}
          </div>
          <div className="mt-2 text-sm text-white/55">
            At current rate:{" "}
            <span className="text-white/75">
              {hasApy ? `${(netApy * 100).toFixed(2)}% APY` : "--"}
            </span>
            {" • "}
            <span className="text-white/75">
              {hasYearly ? `+$${yearly.toFixed(2)}/yr` : "--"}
            </span>
          </div>
        </div>
      );
    }

    if (String(part.type ?? "").includes("get_split_overview")) {
      const totalSplits = Number(output.totalSplits ?? 0);
      const paid = Number(output.paidSplitCount ?? 0);
      const pending = Number(output.pendingSplitCount ?? 0);
      return (
        <div key={idxKey} className="rounded-[20px] border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-white/50">Split overview</div>
          <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-white/55">Total</div>
              <div className="mt-1 text-xl font-semibold text-white">{totalSplits}</div>
            </div>
            <div>
              <div className="text-white/55">Paid</div>
              <div className="mt-1 text-xl font-semibold text-white">{paid}</div>
            </div>
            <div>
              <div className="text-white/55">Pending</div>
              <div className="mt-1 text-xl font-semibold text-white">{pending}</div>
            </div>
          </div>
        </div>
      );
    }

    if (String(part.type ?? "").includes("get_jackpot_status")) return null;

    return (
      <div key={idxKey} className="rounded-[20px] border border-white/10 bg-white/5 p-3 text-xs text-white/70">
        <div className="font-medium text-white">{toolName}</div>
        <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-white/55">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-background text-white pb-48 md:pb-44">
      <div className="fixed inset-x-0 top-0 z-30 px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3 bg-background">
        <div className="mx-auto w-full max-w-3xl flex items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white shadow-sm"
            aria-label="Close assistant"
          >
            <X className="h-4 w-4" />
          </Link>
          <div className="hidden text-md font-medium text-white/80">Tab Assistant</div>
          <div className="h-10 w-10" aria-hidden />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClearChat}
              disabled={isStreaming || messages.length === 0}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white shadow-sm disabled:opacity-40"
              aria-label="Clear chat"
              title="Clear chat"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full px-3 max-w-3xl pt-[calc(env(safe-area-inset-top)+78px)] md:pt-24">
        <div className="px-1 pt-3 pb-24">
          {messages.length === 0 ? (
            <div className="pt-1">
              <div className="px-1 pb-4">
                <h2 className="text-[34px] leading-[0.98] tracking-tight font-medium text-white">
                  {`Hi ${greetingName}! A few ideas to start your day.`}
                </h2>
              </div>
              {starterCardsLoading ? (
                <div className="px-1 py-2">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-11 w-11 rounded-2xl border-white/0 bg-white/10" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-3 w-24 border-white/0 bg-white/10" />
                      <Skeleton className="h-5 w-[80%] border-white/0 bg-white/10" />
                    </div>
                    
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                {starterPrompts.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onQuickPrompt(item.prompt)}
                      disabled={isStreaming}
                      className="w-full rounded-[24px] border border-white/10 bg-white/5 px-4 py-3 text-left shadow-[0_1px_0_rgba(255,255,255,0.03)] disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "h-11 w-11 rounded-2xl inline-flex items-center justify-center shrink-0",
                            item.iconTone
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-white/45">{item.eyebrow}</div>
                          <div className="mt-0.5 text-[15px] font-medium leading-tight text-white">
                            {item.title}
                          </div>
                        </div>
                        <div className="h-8 w-8 rounded-full bg-white text-black inline-flex items-center justify-center shrink-0">
                          <ArrowUp className="h-4 w-4" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            ) : null}

            <div className={cn(messages.length ? "space-y-3 pt-2" : "mt-4")}>
            <AnimatePresence initial={false}>
              {messages.map((message) => {
                const textParts = getTextParts(message);
                const toolParts = getToolParts(message);
                const suppressTextForToolCards = toolParts.some((part) => {
                  const output = getToolOutput(part);
                  return output.preferToolCardOnly === true;
                });
                const isUser = message.role === "user";
                const fallbackText =
                  typeof (message as { content?: unknown }).content === "string"
                    ? ((message as { content?: string }).content ?? "")
                    : "";

                return (
                  <motion.div
                    key={message.id}
                    layout
                    initial={{ opacity: 0, x: isUser ? 18 : -18, y: 6, scale: 0.985 }}
                    animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                    exit={{ opacity: 0, x: isUser ? 12 : -12, y: -2, scale: 0.99 }}
                    transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.7 }}
                    className={cn("flex", isUser ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "px-3 py-2 text-sm",
                        isUser
                          ? "max-w-[90%] rounded-[20px] bg-white/10 text-white"
                          : "w-full rounded-none text-white"
                      )}
                    >
                      {!suppressTextForToolCards
                        ? (textParts.length ? textParts : []).map((part, index) => (
                            <p
                              key={`${message.id}-text-${index}`}
                              className={cn(
                                "whitespace-pre-wrap",
                                isUser ? "text-[16px]" : "text-[15px] leading-[1.35] text-white/90"
                              )}
                            >
                              {renderInlineMarkdown(part.text)}
                            </p>
                          ))
                        : null}

                      {!suppressTextForToolCards && !textParts.length && fallbackText ? (
                        <p className="whitespace-pre-wrap">{renderInlineMarkdown(fallbackText)}</p>
                      ) : null}

                      {toolParts.length ? (
                        <div className="mt-2 space-y-2">
                          {toolParts.map((part, index) => (
                            <motion.div
                              key={`${message.id}-tool-wrap-${index}`}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.16, delay: Math.min(index * 0.04, 0.16), ease: "easeOut" }}
                            >
                              {renderToolCard(part, `${message.id}-tool-${index}`)}
                            </motion.div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {shouldShowGlobalLoading ? (
            <div className="flex justify-start">
              <div className="rounded-[18px] px-3 py-2 text-sm bg-white/5 text-white inline-flex items-center shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin text-white/70" />
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="px-1 pb-2 text-xs text-red-300">{error.message || "Assistant request failed"}</div>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-3 bg-gradient-to-t from-background via-background/95 to-transparent">
        <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl">
          <div className="relative rounded-[28px] bg-white/5 px-4 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.28)] backdrop-blur-sm">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                if (isStreaming || !input.trim()) return;
                const next = input;
                setInput("");
                void submitMessage(next);
              }}
              placeholder="I want to..."
              rows={1}
              className="h-11 w-full resize-none bg-transparent pr-16 py-0 text-[17px] leading-[44px] text-white outline-none placeholder:text-white/35"
            />
            <button
              type="submit"
              disabled={isStreaming || !input.trim()}
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 shrink-0 rounded-full inline-flex items-center justify-center",
                "bg-white text-black transition disabled:bg-white/15 disabled:text-white/70"
              )}
            >
              {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-5 w-5" />}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
