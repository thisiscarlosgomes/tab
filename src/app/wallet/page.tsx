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
  ChevronLeft,
} from "lucide-react";
import { useFundWallet, useIdentityToken, useToken } from "@privy-io/react-auth";
import { NumericFormat } from "react-number-format";
import { base } from "viem/chains";
import { ReceiveDrawerController } from "@/components/app/ReceiveDrawerController";
import { MorphoDepositDrawer } from "@/components/app/LendingMorpho";
import { PaymentTokenPickerDialog } from "@/components/app/PaymentTokenPickerDialog";
import { useSendDrawer } from "@/providers/SendDrawerProvider";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useTabIdentity } from "@/lib/useTabIdentity";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/shortAddress";
import { tokenList } from "@/lib/tokens";

/* -------------------------------------- */
/* TYPES                                  */
/* -------------------------------------- */

type ProfileTab = "tokens" | "transactions";
type BuyStep = "amount" | "payment";
type BuyCurrency = "ETH" | "USDC" | "EURC";
const BUY_PRESET_AMOUNTS = ["100", "250", "500"] as const;
const BUY_MIN_AMOUNT = 25;

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
const EARN_APY_CACHE_TTL_MS = 5 * 60 * 1000;
const VAULT_ADDRESS = "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca";
const walletPortfolioCache = new Map<
  string,
  { wallet: WalletPortfolioResponse; ts: number }
>();
const walletTransactionsCache = new Map<
  string,
  { transactions: ActivityItem[]; ts: number }
>();
let earnApyCache: { value: number; ts: number } | null = null;

function getAgentAccessCacheKey(address: string) {
  return `tab:agent-access:${address.toLowerCase()}`;
}

function tokenRouteSlug(token: Pick<WalletToken, "symbol" | "name">) {
  const base = (token.symbol || token.name || "token").trim().toLowerCase();
  return base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "token";
}

export default function WalletPage() {
  const { address, isProfileLoading } = useTabIdentity();
  const { fundWallet } = useFundWallet();
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
  const [walletNetworkResolvedFor, setWalletNetworkResolvedFor] = useState<string | null>(null);
  const [agentAuthToken, setAgentAuthToken] = useState<string | null>(null);
  const [agentAuthResolved, setAgentAuthResolved] = useState(false);
  const [agentAccessLoading, setAgentAccessLoading] = useState(false);
  const [agentAccessLoaded, setAgentAccessLoaded] = useState(false);
  const [agentAccess, setAgentAccess] = useState<AgentAccessSummary | null>(null);
  const balanceRefreshTimeoutsRef = useRef<number[]>([]);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const balanceShakeTimeoutRef = useRef<number | null>(null);
  const [walletAddressCopied, setWalletAddressCopied] = useState(false);
  const [shakeBalance, setShakeBalance] = useState(false);
  const [earnNetApy, setEarnNetApy] = useState<number | null>(null);
  const [showMorphoDrawer, setShowMorphoDrawer] = useState(false);
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [buyTokenPickerOpen, setBuyTokenPickerOpen] = useState(false);
  const [buyStep, setBuyStep] = useState<BuyStep>("amount");
  const [buyAmount, setBuyAmount] = useState("");
  const [buyCurrency, setBuyCurrency] = useState<BuyCurrency>("USDC");
  const [buyBusy, setBuyBusy] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const walletSwipeTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const walletSwipeHandledRef = useRef(false);
  const selectedBuyToken =
    tokenList.find((token) => token.name === buyCurrency) ?? tokenList[0];
  const buyAmountNumber = Number.parseFloat(buyAmount || "0");
  const canContinueBuy = Number.isFinite(buyAmountNumber) && buyAmountNumber >= BUY_MIN_AMOUNT;

  const formatUsdNumber = (value: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const formatTokenAmount = (value: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: value >= 1 ? 2 : 0,
      maximumFractionDigits: value >= 1 ? 4 : 6,
    }).format(value);

  const getBuyPrefix = (currency: BuyCurrency) => {
    if (currency === "ETH") return "Ξ";
    if (currency === "EURC") return "€";
    return "$";
  };

  const fetchWallet = useCallback(async () => {
    if (!address) {
      setWallet({ totalBalanceUSD: 0, tokens: [] });
      setWalletLoaded(false);
      setWalletLoading(false);
      setWalletError(null);
      setWalletNetworkResolvedFor(null);
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
      setWalletNetworkResolvedFor(address.toLowerCase());
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

  useEffect(() => {
    return () => {
      if (balanceShakeTimeoutRef.current) {
        window.clearTimeout(balanceShakeTimeoutRef.current);
        balanceShakeTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const now = Date.now();
    if (earnApyCache && now - earnApyCache.ts < EARN_APY_CACHE_TTL_MS) {
      setEarnNetApy(earnApyCache.value);
    }

    const fetchEarnApy = async () => {
      try {
        const res = await fetch("https://blue-api.morpho.org/graphql", {
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
              address: VAULT_ADDRESS,
              chainId: 8453,
            },
          }),
        });

        const json = await res.json().catch(() => null);
        const apy = json?.data?.vaultByAddress?.state?.netApy;
        if (!cancelled && typeof apy === "number") {
          earnApyCache = { value: apy, ts: Date.now() };
          setEarnNetApy(apy);
        }
      } catch {
        // best effort
      }
    };

    if (!earnApyCache || now - earnApyCache.ts >= EARN_APY_CACHE_TTL_MS) {
      void fetchEarnApy();
    }
    return () => {
      cancelled = true;
    };
  }, []);

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
      } catch { }
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

  const handleWalletTabSwipe = useCallback(
    (direction: "left" | "right") => {
      const order: ProfileTab[] = ["tokens", "transactions"];
      const currentIdx = order.indexOf(activeTab);
      if (currentIdx === -1) return;
      const nextIdx =
        direction === "left"
          ? Math.min(order.length - 1, currentIdx + 1)
          : Math.max(0, currentIdx - 1);
      if (nextIdx === currentIdx) return;
      const nextTab = order[nextIdx];
      setActiveTab(nextTab);
      if (nextTab === "tokens") void fetchWallet();
      if (nextTab === "transactions") void fetchTransactions();
    },
    [activeTab, fetchTransactions, fetchWallet]
  );

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
      setWalletNetworkResolvedFor(null);
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
  const hasWalletNetworkResolutionForCurrentAddress = Boolean(
    address && walletNetworkResolvedFor === address.toLowerCase()
  );
  const shouldDeferFundingStateDecision =
    walletLoaded &&
    !hasWalletNetworkResolutionForCurrentAddress &&
    Number.isFinite(wallet.totalBalanceUSD) &&
    wallet.totalBalanceUSD <= 0;
  const isAgentLive = Boolean(
    agentAccess?.enabled &&
    agentAccess?.delegated &&
    agentAccess?.status === "ACTIVE"
  );
  const isUnfundedWallet =
    walletLoaded &&
    !walletLoading &&
    !shouldDeferFundingStateDecision &&
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

  useEffect(() => {
    if (buyDialogOpen) return;
    setBuyStep("amount");
    setBuyError(null);
    setBuyBusy(false);
    setBuyTokenPickerOpen(false);
  }, [buyDialogOpen]);

  const openBuyDialog = () => {
    setBuyError(null);
    setBuyStep("amount");
    setBuyDialogOpen(true);
  };

  const handleMoonpayFunding = async () => {
    if (!address || buyBusy || !canContinueBuy) return;
    setBuyBusy(true);
    setBuyError(null);
    try {
      const selectedToken = tokenList.find((token) => token.name === buyCurrency);
      const baseFundingOptions = {
        chain: base,
        amount: buyAmount,
        defaultFundingMethod: "card" as const,
        card: { preferredProvider: "moonpay" as const },
      };
      const options =
        buyCurrency === "USDC"
          ? { ...baseFundingOptions, asset: "USDC" as const }
          : buyCurrency === "ETH"
            ? { ...baseFundingOptions, asset: "native-currency" as const }
            : selectedToken?.address
              ? {
                ...baseFundingOptions,
                asset: { erc20: selectedToken.address as `0x${string}` },
              }
              : { ...baseFundingOptions, asset: "native-currency" as const };

      const result = await fundWallet({ address, options });
      if (result?.status === "completed") {
        setBuyDialogOpen(false);
        void fetchWallet();
        const retryId = window.setTimeout(() => void fetchWallet(), 2200);
        balanceRefreshTimeoutsRef.current.push(retryId);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not start MoonPay checkout.";
      setBuyError(message);
    } finally {
      setBuyBusy(false);
    }
  };

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
        onClick: () => {
          if ((wallet.totalBalanceUSD ?? 0) <= 0) {
            setShakeBalance(false);
            if (balanceShakeTimeoutRef.current) {
              window.clearTimeout(balanceShakeTimeoutRef.current);
            }
            requestAnimationFrame(() => setShakeBalance(true));
            balanceShakeTimeoutRef.current = window.setTimeout(() => {
              setShakeBalance(false);
              balanceShakeTimeoutRef.current = null;
            }, 420);
            return;
          }
          openSendDrawer();
        },
        disabled: false,
        iconClassName: "",
        labelClassName: "",
      },
      {
        label: "Buy",
        icon: CreditCard,
        onClick: () => openBuyDialog(),
        disabled: !address,
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
          <span
            className={[
              "text-[46px] sm:text-[51px] leading-[0.95] font-semibold tracking-tight",
              shakeBalance ? "animate-balance-shake" : "",
            ].join(" ")}
          >
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
                const isUsdc = (token.symbol ?? "").toUpperCase() === "USDC";
                const rowContent = (
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {token.imgUrl ? (
                        <img
                          src={token.imgUrl}
                          alt={token.symbol}
                          loading="lazy"
                          decoding="async"
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-white/10 text-xs flex items-center justify-center text-white/70">
                          {token.symbol?.slice(0, 3) || "TOK"}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-lg font-medium truncate leading-tight">
                          {token.name || token.symbol}
                        </p>
                        <p className="text-md text-white/40 truncate">
                          {isUsdc ? (
                            typeof earnNetApy === "number" ? (
                              <span className="text-emerald-400">
                                {(earnNetApy * 100).toFixed(2)}% APY
                              </span>
                            ) : (
                              <span className="text-white/35">APY ...</span>
                            )
                          ) : (
                            <>
                              {formatTokenAmount(Math.max(0, Number(token.balance ?? 0)))}{" "}
                              {token.symbol}
                            </>
                          )}
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
                  </div>
                );

                return (
                  <li
                    key={`${token.networkName ?? "unknown"}-${token.tokenAddress}`}
                    className="px-1"
                  >
                    {isUsdc ? (
                      <button
                        type="button"
                        onClick={() => setShowMorphoDrawer(true)}
                        className="block w-full text-left py-2 rounded-xl active:scale-[0.99] transition"
                      >
                        {rowContent}
                      </button>
                    ) : (
                      <Link
                        href={`/wallet/tokens/${tokenRouteSlug(token)}`}
                        prefetch
                        className="block py-2 rounded-xl active:scale-[0.99] transition"
                      >
                        {rowContent}
                      </Link>
                    )}
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
          <p>No activity yet...</p>
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
        <>
          <div
            className="min-h-screen w-full flex flex-col items-center p-4 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(10rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide"
            onTouchStart={(e) => {
              const t = e.touches[0];
              if (!t) return;
              walletSwipeTouchStartRef.current = { x: t.clientX, y: t.clientY };
              walletSwipeHandledRef.current = false;
            }}
            onTouchMove={(e) => {
              const start = walletSwipeTouchStartRef.current;
              const t = e.touches[0];
              if (!start || !t || walletSwipeHandledRef.current) return;
              const dx = t.clientX - start.x;
              const dy = t.clientY - start.y;
              if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 48) return;
              handleWalletTabSwipe(dx < 0 ? "left" : "right");
              walletSwipeHandledRef.current = true;
            }}
            onTouchEnd={() => {
              walletSwipeTouchStartRef.current = null;
              walletSwipeHandledRef.current = false;
            }}
            onTouchCancel={() => {
              walletSwipeTouchStartRef.current = null;
              walletSwipeHandledRef.current = false;
            }}
          >
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

                    {!isUnfundedWallet && !shouldDeferFundingStateDecision && (
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
          <MorphoDepositDrawer
            isOpen={showMorphoDrawer}
            onOpenChange={setShowMorphoDrawer}
          />
          <ResponsiveDialog
            open={buyDialogOpen}
            onOpenChange={(open) => {
              if (buyBusy) return;
              setBuyDialogOpen(open);
            }}
            repositionInputs={false}
          >
            <ResponsiveDialogContent className="top-auto bottom-0 h-[calc(100dvh-80px)] min-h-[calc(100dvh-80px)] max-h-[calc(100dvh-80px)] rounded-t-3xl p-4 pb-6 md:top-1/2 md:bottom-auto md:h-auto md:min-h-0 md:max-h-[85vh] md:max-w-md md:rounded-2xl md:p-6">
              <ResponsiveDialogTitle className="sr-only">
                Buy crypto
              </ResponsiveDialogTitle>

              {buyStep === "amount" ? (
                <div className="flex h-full flex-col">
                  <h2 className="text-center text-lg font-semibold mt-2">Buy crypto</h2>
                  <div className="mt-4 flex flex-col items-center">
                    <NumericFormat
                      value={buyAmount}
                      inputMode="decimal"
                      pattern="[0-9]*"
                      onValueChange={(next) => setBuyAmount(next.value)}
                      thousandSeparator
                      allowNegative={false}
                      decimalScale={2}
                      prefix={getBuyPrefix(buyCurrency)}
                      placeholder={`${getBuyPrefix(buyCurrency)}0`}
                      className={`w-full bg-transparent text-center text-5xl font-semibold leading-none outline-none placeholder-white/20 ${buyAmount ? "text-white" : "text-white/20"
                        }`}
                    />
                    <p className="mt-2 text-white/40">Amount to buy</p>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                    {BUY_PRESET_AMOUNTS.map((preset) => {
                      const isActive = buyAmount === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setBuyAmount(preset);
                            setBuyError(null);
                          }}
                          className={[
                            "rounded-full px-4 py-2 text-md font-semibold transition",
                            isActive
                              ? "bg-white text-black"
                              : "bg-white/10 text-white hover:bg-white/15",
                          ].join(" ")}
                        >
                          ${Number(preset).toLocaleString("en-US")}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setBuyTokenPickerOpen(true)}
                    className="mb-4 mt-8 flex w-full items-center justify-between rounded-3xl bg-white/5 px-4 py-4"
                  >
                    <div className="flex items-center gap-2">
                      <img
                        src={selectedBuyToken?.icon}
                        alt={selectedBuyToken?.name ?? buyCurrency}
                        className="h-8 w-8 rounded-full"
                      />
                      <span className="text-md font-medium text-white">{buyCurrency}</span>
                    </div>
                    <span className="text-md text-primary">Change</span>
                  </button>

                  {buyError ? (
                    <p className="mt-4 text-sm text-red-300 text-center">{buyError}</p>
                  ) : null}

                  <Button
                    type="button"
                    onClick={() => {
                      setBuyError(null);
                      setBuyStep("payment");
                    }}
                    disabled={!canContinueBuy}
                    className="mt-4 md:mt-auto w-full bg-primary text-black font-semibold disabled:bg-white/20 disabled:text-white/50"
                  >
                    Continue
                  </Button>
                  <p className="mt-2 text-center text-sm text-white/50">
                    Minimum order is ${BUY_MIN_AMOUNT}
                  </p>
                </div>
              ) : (
                <div className="flex h-full flex-col">
                  <button
                    type="button"
                    onClick={() => {
                      if (buyBusy) return;
                      setBuyStep("amount");
                      setBuyError(null);
                    }}
                    className="mb-5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/80"
                    aria-label="Back to amount step"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>

                  <div className="mb-6 flex items-end justify-between">
                    <h2 className="text-lg font-semibold tracking-tight">Checkout</h2>
                    <div className="flex items-center gap-2 text-white/80">
                      <span className="text-lg font-medium">
                        {getBuyPrefix(buyCurrency)}
                        {formatUsdNumber(buyAmountNumber)}
                      </span>
                      <img
                        src={selectedBuyToken?.icon}
                        alt={selectedBuyToken?.name ?? buyCurrency}
                        className="h-7 w-7 rounded-full"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    className="w-full rounded-3xl border border-white/15 bg-white/[0.02] p-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white font-semibold">
                        M
                      </div>
                      <div>
                        <p className="text-lg leading-none">MoonPay</p>
                        <p className="mt-1 text-white/60">Debit Card, Apple Pay</p>
                      </div>
                    </div>
                  </button>

                  <p className="mt-auto mb-4 text-center text-white/50">
                    You&apos;ll continue to MoonPay to review fees and complete checkout.
                  </p>

                  {buyError ? (
                    <p className="mb-3 text-sm text-red-300 text-center">{buyError}</p>
                  ) : null}

                  <Button
                    type="button"
                    onClick={() => void handleMoonpayFunding()}
                    disabled={buyBusy || !canContinueBuy || !address}
                    className="w-full bg-primary text-black font-semibold disabled:bg-white/20 disabled:text-white/50"
                  >
                    {buyBusy ? "Opening MoonPay..." : "Continue with MoonPay"}
                  </Button>
                </div>
              )}
            </ResponsiveDialogContent>
          </ResponsiveDialog>
          <PaymentTokenPickerDialog
            open={buyTokenPickerOpen}
            onOpenChange={setBuyTokenPickerOpen}
            selectedToken={buyCurrency}
            onSelect={(tokenName) => {
              if (tokenName === "ETH" || tokenName === "USDC" || tokenName === "EURC") {
                setBuyCurrency(tokenName);
              }
            }}
            title="Choose currency"
          />
        </>
      )}
    </ReceiveDrawerController>
  );
}
