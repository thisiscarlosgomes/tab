"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  QrCode,
  Send,
  CreditCard,
  Copy,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  ReceiptText,
} from "lucide-react";
import { useIdentityToken, useToken } from "@privy-io/react-auth";
import { ReceiveDrawerController } from "@/components/app/ReceiveDrawerController";
import { useSendDrawer } from "@/providers/SendDrawerProvider";
import { useTabIdentity } from "@/lib/useTabIdentity";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/shortAddress";

/* -------------------------------------- */
/* TYPES                                  */
/* -------------------------------------- */

type ProfileTab = "tokens" | "transactions";

interface WalletToken {
  tokenAddress: string;
  symbol: string;
  name: string;
  balance: number;
  balanceUSD: number;
  portfolioPercent?: number;
  price: number;
  imgUrl?: string | null;
  networkName?: string | null;
}

interface WalletPortfolioResponse {
  totalBalanceUSD: number;
  tokens: WalletToken[];
}

type AgentAccessSummary = {
  enabled?: boolean;
  delegated?: boolean;
  status?: "ACTIVE" | "PAUSED" | "REVOKED";
};

interface ActivityItem {
  type: string;
  amount?: number;
  token?: string;
  description?: string;
  counterparty?: string;
  counterpartyAddress?: string | null;
  recipient?: string;
  recipientUsername?: string;
  pfp?: string;
  executionMode?: "user_session" | "service_agent" | null;
  agentId?: string | null;
  timestamp: string | Date;
}

const TRANSACTION_TYPES = new Set([
  "bill_paid",
  "bill_received",
  "room_paid",
  "room_received",
  "jackpot_deposit",
  "earn_deposit",
]);
const WALLET_PORTFOLIO_CACHE_TTL_MS = 60 * 1000;
const WALLET_TRANSACTIONS_CACHE_TTL_MS = 30 * 1000;
const walletPortfolioCache = new Map<
  string,
  { wallet: WalletPortfolioResponse; ts: number }
>();
const walletTransactionsCache = new Map<
  string,
  { transactions: ActivityItem[]; ts: number }
>();

function getAgentAccessCacheKey(address: string) {
  return `tab:agent-access:${address.toLowerCase()}`;
}

export default function WalletPage() {
  const { address, isProfileLoading } = useTabIdentity();
  const { identityToken } = useIdentityToken();
  const { getAccessToken } = useToken();
  const pathname = usePathname();
  const { open: openSendDrawer } = useSendDrawer();
  const [activeTab, setActiveTab] = useState<ProfileTab>("tokens");

  const [transactions, setTransactions] = useState<ActivityItem[]>([]);
  const [transactionsLoaded, setTransactionsLoaded] = useState(false);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [wallet, setWallet] = useState<WalletPortfolioResponse>({
    totalBalanceUSD: 0,
    tokens: [],
  });
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [agentAuthToken, setAgentAuthToken] = useState<string | null>(null);
  const [agentAuthResolved, setAgentAuthResolved] = useState(false);
  const [agentAccessLoading, setAgentAccessLoading] = useState(false);
  const [agentAccessLoaded, setAgentAccessLoaded] = useState(false);
  const [agentAccess, setAgentAccess] = useState<AgentAccessSummary | null>(null);
  const balanceRefreshTimeoutsRef = useRef<number[]>([]);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const [walletAddressCopied, setWalletAddressCopied] = useState(false);

  const formatUsdNumber = (value: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const fetchWallet = useCallback(async () => {
    if (!address) {
      setWallet({ totalBalanceUSD: 0, tokens: [] });
      setWalletLoaded(false);
      setWalletLoading(false);
      setWalletError(null);
      return;
    }

    if (!walletLoaded) setWalletLoading(true);
    const cacheKey = address.toLowerCase();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(`/api/moralis/portfolio?address=${address}`, {
        cache: "no-store",
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorPayload = await res
          .json()
          .catch(() => ({ error: "Could not load wallet balances" }));
        if (!walletLoaded) {
          setWallet({ totalBalanceUSD: 0, tokens: [] });
        }
        setWalletError(
          typeof errorPayload?.error === "string"
            ? errorPayload.error
            : "Could not load wallet balances"
        );
        return;
      }

      const data = await res.json();
      const nextWallet = {
        totalBalanceUSD: Number(data?.totalBalanceUSD ?? 0),
        tokens: Array.isArray(data?.tokens) ? data.tokens : [],
      };
      setWallet(nextWallet);
      walletPortfolioCache.set(cacheKey, { wallet: nextWallet, ts: Date.now() });
      setWalletError(null);
    } catch {
      if (!walletLoaded) {
        setWallet({ totalBalanceUSD: 0, tokens: [] });
      }
      setWalletError("Could not load wallet balances");
    } finally {
      clearTimeout(timeoutId);
      setWalletLoading(false);
      setWalletLoaded(true);
    }
  }, [address, walletLoaded]);

  useEffect(() => {
    let cancelled = false;
    setAgentAuthResolved(false);
    const resolveAuthToken = async () => {
      if (identityToken) {
        if (!cancelled) {
          setAgentAuthToken(identityToken);
          setAgentAuthResolved(true);
        }
        return;
      }

      const accessToken = await getAccessToken().catch(() => null);
      if (!cancelled) {
        setAgentAuthToken(accessToken);
        setAgentAuthResolved(true);
      }
    };

    void resolveAuthToken();
    return () => {
      cancelled = true;
    };
  }, [identityToken, getAccessToken]);

  useEffect(() => {
    if (!address) return;
    try {
      const raw = localStorage.getItem(getAgentAccessCacheKey(address));
      if (!raw) return;
      const cached = JSON.parse(raw) as AgentAccessSummary;
      if (!cached || typeof cached !== "object") return;
      setAgentAccess({
        enabled: Boolean(cached.enabled),
        delegated: Boolean(cached.delegated),
        status: cached.status ?? "PAUSED",
      });
      setAgentAccessLoaded(true);
    } catch {
      // ignore bad cache payloads
    }
  }, [address]);

  const fetchAgentAccess = useCallback(async () => {
    if (!address) {
      setAgentAccess(null);
      setAgentAccessLoading(false);
      setAgentAccessLoaded(false);
      return;
    }

    if (!agentAuthResolved) {
      if (!agentAccessLoaded) setAgentAccessLoading(false);
      return;
    }

    if (!agentAuthToken) {
      if (!agentAccessLoaded) {
        setAgentAccess(null);
      }
      setAgentAccessLoading(false);
      setAgentAccessLoaded(true);
      return;
    }

    if (!agentAccessLoaded) setAgentAccessLoading(true);
    try {
      const res = await fetch("/api/agent-access/me", {
        headers: {
          Authorization: `Bearer ${agentAuthToken}`,
        },
      });
      if (!res.ok) {
        if (!agentAccessLoaded) {
          setAgentAccess(null);
        }
        setAgentAccessLoaded(true);
        return;
      }
      const data = (await res.json()) as AgentAccessSummary;
      const next: AgentAccessSummary = {
        enabled: Boolean(data?.enabled),
        delegated: Boolean(data?.delegated),
        status: data?.status ?? "PAUSED",
      };
      setAgentAccess(next);
      try {
        localStorage.setItem(getAgentAccessCacheKey(address), JSON.stringify(next));
      } catch {}
      setAgentAccessLoaded(true);
    } catch {
      if (!agentAccessLoaded) {
        setAgentAccess(null);
      }
      setAgentAccessLoaded(true);
    } finally {
      setAgentAccessLoading(false);
    }
  }, [address, agentAuthResolved, agentAuthToken, agentAccessLoaded]);

  const fetchTransactions = useCallback(async () => {
    if (!address) {
      setTransactions([]);
      setTransactionsLoading(false);
      setTransactionsLoaded(false);
      return;
    }

    if (!transactionsLoaded) setTransactionsLoading(true);
    const cacheKey = address.toLowerCase();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    try {
      const qs = new URLSearchParams({
        address,
        limit: "30",
      });
      const res = await fetch(`/api/activity?${qs.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) return;

      const data = await res.json();
      const next = Array.isArray(data?.activity)
        ? (data.activity as ActivityItem[]).filter((item) =>
            TRANSACTION_TYPES.has(String(item?.type ?? ""))
          )
        : [];
      setTransactions(next);
      walletTransactionsCache.set(cacheKey, { transactions: next, ts: Date.now() });
    } catch {
      // Keep last successful transactions list on transient failure.
    } finally {
      clearTimeout(timeoutId);
      setTransactionsLoading(false);
      setTransactionsLoaded(true);
    }
  }, [address, transactionsLoaded]);

  useEffect(() => {
    if (!address) return;

    const cacheKey = address.toLowerCase();
    const now = Date.now();
    const cachedWallet = walletPortfolioCache.get(cacheKey);
    const cachedTransactions = walletTransactionsCache.get(cacheKey);

    if (cachedWallet && now - cachedWallet.ts < WALLET_PORTFOLIO_CACHE_TTL_MS) {
      setWallet(cachedWallet.wallet);
      setWalletLoaded(true);
      setWalletLoading(false);
      setWalletError(null);
    }

    if (
      cachedTransactions &&
      now - cachedTransactions.ts < WALLET_TRANSACTIONS_CACHE_TTL_MS
    ) {
      setTransactions(cachedTransactions.transactions);
      setTransactionsLoaded(true);
      setTransactionsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (pathname !== "/wallet") return;

    if (!address) {
      if (isProfileLoading) return;
      setWallet({ totalBalanceUSD: 0, tokens: [] });
      setAgentAccess(null);
      setAgentAccessLoaded(false);
      setAgentAccessLoading(false);
      setWalletLoaded(false);
      setTransactions([]);
      setTransactionsLoaded(false);
      setTransactionsLoading(false);
      return;
    }

    let cancelled = false;

    const bootstrapProfileData = async () => {
      // 1) wallet first (cache hydration can mark this loaded before we get here)
      if (!walletLoaded && !walletLoading) {
        await fetchWallet();
        if (cancelled) return;
      }

      // 2) agent access second (always revalidate even if we hydrated from cache)
      if (!agentAccessLoading) {
        await fetchAgentAccess();
        if (cancelled) return;
      }

    };

    void bootstrapProfileData();

    return () => {
      cancelled = true;
    };
  }, [
    pathname,
    address,
    isProfileLoading,
    walletLoaded,
    walletLoading,
    agentAccessLoaded,
    agentAccessLoading,
    fetchWallet,
    fetchAgentAccess,
  ]);

  useEffect(() => {
    if (!address) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (activeTab === "tokens") void fetchWallet();
      if (activeTab === "transactions") void fetchTransactions();
      void fetchAgentAccess();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [
    address,
    activeTab,
    fetchWallet,
    fetchTransactions,
    fetchAgentAccess,
  ]);

  useEffect(() => {
    if (pathname !== "/wallet" || !address) return;
    if (!walletLoaded) return;
    if (activeTab === "tokens") void fetchWallet();
    if (activeTab === "transactions") void fetchTransactions();
  }, [
    pathname,
    address,
    walletLoaded,
    activeTab,
    fetchWallet,
    fetchTransactions,
  ]);

  useEffect(() => {
    if (!address) return;

    const onBalanceUpdate = () => {
      balanceRefreshTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      balanceRefreshTimeoutsRef.current = [];
      void fetchWallet();
      const retryId = window.setTimeout(() => void fetchWallet(), 2200);
      balanceRefreshTimeoutsRef.current.push(retryId);
    };

    window.addEventListener("tab:balance-updated", onBalanceUpdate);
    return () => {
      window.removeEventListener("tab:balance-updated", onBalanceUpdate);
      balanceRefreshTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      balanceRefreshTimeoutsRef.current = [];
    };
  }, [address, fetchWallet]);

  /* -------------------------------------- */
  /* RENDER                                 */
  /* -------------------------------------- */

  const hasFreshWalletCache = Boolean(
    address &&
      (() => {
        const cached = walletPortfolioCache.get(address.toLowerCase());
        return cached && Date.now() - cached.ts < WALLET_PORTFOLIO_CACHE_TTL_MS;
      })()
  );
  const isInitialProfileLoading =
    (isProfileLoading && !address) || (!!address && !walletLoaded && !hasFreshWalletCache);
  const isAgentLive = Boolean(
    agentAccess?.enabled &&
    agentAccess?.delegated &&
    agentAccess?.status === "ACTIVE"
  );
  const isUnfundedWallet =
    walletLoaded &&
    !walletLoading &&
    Number.isFinite(wallet.totalBalanceUSD) &&
    wallet.totalBalanceUSD <= 0;
  const isAgentPaused = Boolean(
    agentAccess?.status === "PAUSED" && agentAccess?.delegated
  );

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const renderProfileSkeleton = () => (
    <div className="min-h-screen w-full flex flex-col items-center p-4 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(10rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
      <div className="w-full max-w-md animate-pulse">
        <div className="mt-2 mb-4">
          <div className="h-16 w-52 mx-auto rounded-xl bg-white/10" />
          <div className="h-4 w-32 mx-auto mt-3 rounded-md bg-white/10" />
          <div className="grid grid-cols-3 gap-4 mt-7">
            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 rounded-full bg-white/10" />
              <div className="h-4 w-16 rounded-md bg-white/10" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 rounded-full bg-white/10" />
              <div className="h-4 w-16 rounded-md bg-white/10" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 rounded-full bg-white/10" />
              <div className="h-4 w-16 rounded-md bg-white/10" />
            </div>
          </div>
        </div>

        <div className="mb-6 mt-4 h-10 rounded-lg bg-white/10" />

        <div className="space-y-4">
          <div className="h-16 rounded-xl bg-white/10" />
          <div className="h-16 rounded-xl bg-white/10" />
          <div className="h-16 rounded-xl bg-white/10" />
          <div className="h-16 rounded-xl bg-white/10" />
          <div className="h-16 rounded-xl bg-white/10" />
        </div>
      </div>
    </div>
  );

  if (isInitialProfileLoading) {
    return renderProfileSkeleton();
  }

  const renderWalletHeaderSkeleton = () => (
    <div className="pt-1 pb-4">
      <div className="flex flex-col items-center mb-8 mt-4">
        <Skeleton className="h-5 w-14 mb-3 rounded-lg" />
        <Skeleton className="h-16 w-52 rounded-2xl" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="flex flex-col items-center gap-2">
            <Skeleton className="w-16 h-16 rounded-full" />
            <Skeleton className="h-4 w-14 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );

  const renderSimpleListSkeleton = (rows = 5) => (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, idx) => (
        <div
          key={idx}
          className="p-3 rounded-xl border border-white/10 bg-white/[0.02]"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Skeleton className="w-10 h-10 rounded-full shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40 max-w-full rounded-md" />
                <Skeleton className="h-3 w-28 rounded-md" />
              </div>
            </div>
            <div className="space-y-2 text-right shrink-0">
              <Skeleton className="h-4 w-16 rounded-md" />
              <Skeleton className="h-3 w-10 rounded-md" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderWalletHeader = (openReceiveDrawer: () => void) => {
    if (!address) {
      return (
        <div className="text-center text-white/40 py-10">
          Connect an account to view wallet balances.
        </div>
      );
    }

    if (walletLoading && !walletLoaded) {
      return renderWalletHeaderSkeleton();
    }

    const copyWalletAddress = async () => {
      if (!address) return;
      try {
        await navigator.clipboard.writeText(address);
        setWalletAddressCopied(true);
        if (copyResetTimeoutRef.current) {
          window.clearTimeout(copyResetTimeoutRef.current);
        }
        copyResetTimeoutRef.current = window.setTimeout(() => {
          setWalletAddressCopied(false);
          copyResetTimeoutRef.current = null;
        }, 1600);
      } catch {
        // no-op
      }
    };

    const walletActions = [
      {
        label: "Deposit",
        icon: QrCode,
        onClick: () => openReceiveDrawer(),
        disabled: false,
        iconClassName: "",
        labelClassName: "",
      },
      {
        label: "Send",
        icon: Send,
        onClick: () => openSendDrawer(),
        disabled: false,
        iconClassName: "",
        labelClassName: "",
      },
      {
        label: "Buy",
        icon: CreditCard,
        onClick: () => {},
        disabled: true,
        iconClassName: "",
        labelClassName: "",
      },
      {
        label: "Copy",
        icon: walletAddressCopied ? Check : Copy,
        onClick: () => void copyWalletAddress(),
        disabled: false,
        iconClassName: walletAddressCopied ? "text-green-400" : "",
        labelClassName: walletAddressCopied ? "text-green-400" : "",
      },
    ] as const;

    return (
      <div className="pt-1 pb-4">
        <div className="flex items-start justify-center text-center mb-8 mt-4">
          <span className="hidden text-3xl leading-none mt-3 text-white/90">$</span>
          <span className="text-[46px] sm:text-[51px] leading-[0.95] font-semibold tracking-tight">
            ${formatUsdNumber(wallet.totalBalanceUSD)}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {walletActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                className="flex flex-col items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center transition bg-white/10 text-white/75 hover:bg-white/15 ${action.iconClassName ?? ""}`}
                >
                  <Icon className="w-6 h-6" />
                </div>
                <span
                  className={`text-md font-medium text-white/75 ${action.labelClassName ?? ""}`}
                >
                  {action.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTokensTab = () => {
    if (walletLoading && !walletLoaded) {
      return renderSimpleListSkeleton(6);
    }

    const visibleTokens = wallet.tokens.filter(
      (token) => Number(token.balanceUSD ?? 0) >= 0.005
    );

    return (
      <div className="space-y-4">
        <div className="overflow-hidden">
          <div className="px-1 py-2">
            <p className="hidden text-md text-white/60">
              Tokens ({visibleTokens.length})
            </p>
          </div>
          {visibleTokens.length === 0 ? (
            <div className="px-4 py-8 text-center text-white/40 text-md">
              No token balances found for this wallet.
            </div>
          ) : (
            <ul className="space-y-1">
              {visibleTokens.map((token) => {
                const safeBalanceUsd = Math.max(
                  0,
                  Number(token.balanceUSD ?? 0)
                );
                const safePortfolioPercent = Math.max(
                  0,
                  Number(token.portfolioPercent ?? 0)
                );
                return (
                  <li
                    key={`${token.networkName ?? "unknown"}-${token.tokenAddress}`}
                    className="px-1 py-2 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {token.imgUrl ? (
                        <img
                          src={token.imgUrl}
                          alt={token.symbol}
                          loading="lazy"
                          decoding="async"
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-white/10 text-xs flex items-center justify-center text-white/70">
                          {token.symbol?.slice(0, 3) || "TOK"}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-lg font-medium truncate leading-tight">
                          {token.name || token.symbol}
                        </p>
                        <p className="text-md text-white/40 truncate">
                          {token.symbol}
                          {token.networkName ? ` • ${token.networkName}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-lg font-medium leading-tight">
                        ${formatUsdNumber(safeBalanceUsd)}
                      </p>
                      <p className="text-md text-white/40">
                        {safePortfolioPercent.toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 1,
                        })}
                        %
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  };

  const renderTransactionsTab = () => {
    if (transactionsLoading && !transactionsLoaded) {
      return renderSimpleListSkeleton(6);
    }

    if (transactions.length === 0) {
      return (
        <div className="flex flex-col items-center text-center text-white/30 py-10">
          <ReceiptText className="w-10 h-10 mb-2 text-white/30" />
          <p>No recent transactions yet.</p>
        </div>
      );
    }

    return (
      <ul className="space-y-2">
        {transactions.map((tx, idx) => {
          const isIncoming = tx.type === "bill_received" || tx.type === "room_received";
          const isOutgoing = tx.type === "bill_paid" || tx.type === "room_paid";
          const counterpartyLabel =
            tx.counterparty ||
            tx.recipientUsername ||
            (tx.counterpartyAddress
              ? shortAddress(tx.counterpartyAddress as `0x${string}`)
              : tx.recipient && tx.recipient.startsWith("0x")
                ? shortAddress(tx.recipient as `0x${string}`)
                : tx.recipient || null);

          return (
            <li
              key={`${tx.type}:${String(tx.timestamp)}:${idx}`}
              className="p-3 rounded-xl border border-white/10 bg-white/[0.02]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={[
                      "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                      isIncoming
                        ? "bg-emerald-500/15 text-emerald-300"
                        : isOutgoing
                          ? "bg-orange-500/15 text-orange-300"
                          : "bg-white/10 text-white/70",
                    ].join(" ")}
                  >
                    {isIncoming ? (
                      <ArrowDownLeft className="w-4 h-4" />
                    ) : isOutgoing ? (
                      <ArrowUpRight className="w-4 h-4" />
                    ) : (
                      <ReceiptText className="w-4 h-4" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm text-white/90 truncate">
                      {tx.description || "Transaction"}
                    </p>
                    <p className="text-xs text-white/40 truncate">
                      {counterpartyLabel ? `${counterpartyLabel} • ` : ""}
                      {new Date(tx.timestamp).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  {typeof tx.amount === "number" && Number.isFinite(tx.amount) ? (
                    <p
                      className={[
                        "text-sm font-medium",
                        isIncoming
                          ? "text-emerald-300"
                          : isOutgoing
                            ? "text-white/90"
                            : "text-white/80",
                      ].join(" ")}
                    >
                      {isIncoming ? "+" : isOutgoing ? "-" : ""}
                      {tx.amount} {tx.token ?? ""}
                    </p>
                  ) : null}
                  {tx.executionMode === "service_agent" && (
                    <p className="text-[10px] text-blue-300/80 mt-0.5">
                      Agent
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <ReceiveDrawerController>
      {({ openReceiveDrawer }) => (
        <div className="min-h-screen w-full flex flex-col items-center p-4 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(10rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
          <div className="w-full max-w-md">
            {(() => {
              return (
                <>
            <div className="mb-2 mt-2">{renderWalletHeader(openReceiveDrawer)}</div>

            <Link
              href="/profile/agent-access"
              className="block mb-6 py-3 px-4 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition"
            >
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  {isAgentLive && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-80" />
                  )}
                  <span
                    className={[
                      "relative inline-flex h-2.5 w-2.5 rounded-full",
                      isAgentLive ? "bg-emerald-400" : "bg-white/40",
                    ].join(" ")}
                  />
                </span>
                <p className="text-sm text-white/70">Agent Access</p>
              </div>
              <p className="text-xs text-white/40 mt-1">
                {isAgentLive
                  ? "Agent is live under your guardrails."
                  : isAgentPaused
                    ? "Agent Paused."
                    : agentAccessLoading && !agentAccessLoaded
                      ? "Checking status..."
                    : "Configure delegated wallet guardrails."}
              </p>
            </Link>

            {isUnfundedWallet && (
              <Button
                type="button"
                onClick={() => openReceiveDrawer()}
                className="w-full mb-6 bg-primary text-black font-semibold"
              >
                Deposit
              </Button>
            )}

            {!isUnfundedWallet && (
              <>
            <div className="mb-4 mt-3 grid grid-cols-2 border-b border-white/10">
              <button
                onClick={() => {
                  setActiveTab("tokens");
                  void fetchWallet();
                }}
                className={`pb-3 text-sm sm:text-base font-medium transition relative ${activeTab === "tokens" ? "text-white" : "text-white/50"
                  }`}
              >
                Tokens
                {activeTab === "tokens" && (
                  <span className="absolute left-0 right-0 -bottom-[1px] h-1 bg-primary rounded-full" />
                )}
              </button>
              <button
                onClick={() => {
                  setActiveTab("transactions");
                  void fetchTransactions();
                }}
                className={`pb-3 text-sm sm:text-base font-medium transition relative ${activeTab === "transactions" ? "text-white" : "text-white/50"
                  }`}
              >
                Transactions
                {activeTab === "transactions" && (
                  <span className="absolute left-0 right-0 -bottom-[1px] h-1 bg-primary rounded-full" />
                )}
              </button>
            </div>

            {activeTab === "tokens" && renderTokensTab()}
            {activeTab === "transactions" && renderTransactionsTab()}
              </>
            )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </ReceiveDrawerController>
  );
}
