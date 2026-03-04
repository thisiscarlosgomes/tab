"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import {
  useIdentityToken,
  useLinkAccount,
  useLogin,
  usePrivy,
  useToken,
} from "@privy-io/react-auth";

import { useScanDrawer } from "@/providers/ScanDrawerProvider";
import { useSendDrawer } from "@/providers/SendDrawerProvider";

import { MorphoDepositDrawer } from "@/components/app/LendingMorpho";
import { ReceiveDrawerController } from "@/components/app/ReceiveDrawerController";
import {
  fetchMoralisPortfolio,
} from "@/lib/moralis-portfolio-client";

import Skeleton from "react-loading-skeleton";
import clsx from "clsx";

import {
  Bot,
  CircleDollarSign,
  ChevronRight,
  Dice5,
  Ticket,
  X,
  ChartBar,
  ChartNoAxesColumnIncreasing
} from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { getSocialUserKey, SocialUser } from "@/lib/social";
import { shortAddress } from "@/lib/shortAddress";

import { useTicketCountForRound } from "@/lib/BaseJackpotQueries";
import { useTabIdentity } from "@/lib/useTabIdentity";
import { UserAvatar } from "@/components/ui/user-avatar";

const VAULT_ADDRESS = "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca";

type MultiBalances = {
  base?: number;
  totalPortfolio?: number;
};

type WebPushState = {
  configured: boolean;
  vapidPublicKey: string | null;
  subscriptions: Array<{ endpoint: string }>;
};

type HomeActivityItem = {
  type: string;
  amount?: number;
  token?: string;
  txHash?: string;
  splitId?: string;
  roomId?: string;
  dropId?: string;
  counterparty?: string;
  recipientUsername?: string;
  recipient?: string;
  pfp?: string;
  description?: string;
  note?: string | null;
  timestamp: string | Date;
};

const PAYMENT_ACTIVITY_TYPES = new Set([
  "bill_paid",
  "bill_received",
  "room_paid",
  "room_received",
]);

const AUTH_WELCOME_STEPS = [
  {
    key: "intro",
    kind: "brand" as const,
  },
  {
    key: "social-wallet",
    kind: "guide" as const,
    iconSrc: "/link.png",
    title: "Your social wallet",
    desc: "Move money between people you follow and trust, instantly.",
  },
  {
    key: "core-feature",
    kind: "guide" as const,
    iconSrc: "/dollars.png",
    title: "Tooling",
    desc: "Split group bills, send payments, and get paid — in seconds",
  },
    {
    key: "earn-more",
    kind: "guide" as const,
    iconSrc: "/wallet.png",
    title: "Put your money to work",
    desc: "Earn up to 5% APY on your stables, play daily jackpot and more.",
  },
  {
    key: "agent-skill",
    kind: "guide" as const,
    iconSrc: "/stack.png",
    title: "Tab agent skill",
    desc: "Use Tab skill to trigger payments from chat apps you already use.",
  },
] as const;

async function loadBalances(address: `0x${string}`, force = false) {
  try {
    const portfolio = await fetchMoralisPortfolio(address, { force });
    const usdc =
      portfolio.tokens?.find(
        (token) => (token.symbol ?? "").trim().toUpperCase() === "USDC"
      )?.balance ?? 0;
    return {
      base: Number.parseFloat(String(usdc)),
      totalPortfolio: Number(portfolio?.totalBalanceUSD ?? 0),
    };
  } catch {
    return { base: undefined, totalPortfolio: undefined };
  }
}

function FriendSkeleton() {
  return (
    <div className="opacity-60 flex flex-col items-center w-[22%] min-w-[64px]">
      <Skeleton circle width={56} height={56} />
    </div>
  );
}

function ActiveCardSkeleton() {
  return (
    <div className="ml-1 flex-1">
      <Skeleton width={80} height={12} className="mb-2" />
      <Skeleton width={160} height={18} />
    </div>
  );
}

function AuthValidationSplash() {
  return (
    <main className="bg-background h-[100dvh] w-full flex flex-col items-center justify-center p-6 text-center overflow-hidden">
      <img
        src="/ping.svg"
        alt="Tab"
        className="w-16 h-16 mb-4 animate-pulse"
      />
     
    </main>
  );
}

function AnimatedPingLogo({ className }: { className?: string }) {
  return (
    <>
      <svg
        viewBox="0 0 512 512"
        xmlns="http://www.w3.org/2000/svg"
        className={clsx("ping-float", className)}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="pingOrbGradient" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#C4B5FD" />
            <stop offset="60%" stopColor="#A78BFA" />
            <stop offset="100%" stopColor="#7C3AED" />
          </radialGradient>
          <filter id="pingGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="25" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="pingShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="0"
              dy="20"
              stdDeviation="20"
              floodColor="#A78BFA"
              floodOpacity="0.4"
            />
          </filter>
        </defs>

        <circle
          className="ping-aura"
          cx="256"
          cy="256"
          r="180"
          fill="#A78BFA"
          opacity="0.25"
          filter="url(#pingGlow)"
        />
        <circle
          cx="256"
          cy="256"
          r="140"
          fill="url(#pingOrbGradient)"
          filter="url(#pingShadow)"
        />
        <ellipse cx="320" cy="200" rx="30" ry="18" fill="white" opacity="0.25" />

        <ellipse className="ping-eye" cx="220" cy="250" rx="12" ry="12" fill="#111111" />
        <ellipse
          className="ping-eye ping-eye-delay"
          cx="292"
          cy="250"
          rx="12"
          ry="12"
          fill="#111111"
        />

        <path
          className="ping-smile"
          d="M230 290 Q256 310 282 290"
          stroke="#111111"
          strokeWidth="5"
          fill="transparent"
          strokeLinecap="round"
        />
      </svg>

      <style jsx>{`
        .ping-float {
          animation: ping-float 4.8s ease-in-out infinite;
          will-change: transform;
        }

        .ping-aura {
          transform-origin: center;
          transform-box: fill-box;
          animation: ping-aura-pulse 6.5s ease-in-out infinite;
          will-change: transform, opacity;
        }

        .ping-eye {
          transform-origin: center;
          transform-box: fill-box;
          animation: ping-blink 5.5s ease-in-out infinite;
        }

        .ping-eye-delay {
          animation-delay: 0.02s;
        }

        .ping-smile {
          transform-origin: center;
          transform-box: fill-box;
          animation: ping-smile 7.2s ease-in-out infinite;
          will-change: transform;
        }

        @keyframes ping-float {
          0%,
          100% {
            transform: translateY(0px);
          }

          50% {
            transform: translateY(-8px);
          }
        }

        @keyframes ping-aura-pulse {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.2;
          }

          50% {
            transform: scale(1.06);
            opacity: 0.33;
          }
        }

        @keyframes ping-blink {
          0%,
          44%,
          100% {
            transform: scaleY(1);
          }

          46% {
            transform: scaleY(0.12);
          }

          48% {
            transform: scaleY(1);
          }
        }

        @keyframes ping-smile {
          0%,
          58%,
          100% {
            transform: translateY(0px) scaleX(1) scaleY(1);
          }

          62% {
            transform: translateY(-1px) scaleX(1.05) scaleY(1.12);
          }

          67% {
            transform: translateY(-0.5px) scaleX(1.03) scaleY(1.08);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ping-float,
          .ping-aura,
          .ping-eye,
          .ping-eye-delay,
          .ping-smile {
            animation: none;
          }
        }
      `}</style>
    </>
  );
}

function AuthBrandLockup() {
  return (
    <div className="relative flex flex-col items-center">
      <div
        aria-hidden
        className="absolute left-1/2 top-12 h-40 w-40 -translate-x-1/2 rounded-full bg-indigo-400/10 blur-3xl"
      />
      <AnimatedPingLogo className="relative z-10 w-[120px] h-[120px] mb-2 drop-shadow-[0_10px_35px_rgba(99,102,241,0.14)]" />
      <h1 className="relative z-10 text-3xl font-semibold tracking-tight leading-none text-white">
        meet tab
      </h1>
      <p className="hidden relative z-10 mt-2 text-lg text-white/35">
        Split, send, and get paid in seconds.
      </p>
    </div>
  );
}

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

export default function Home() {
  const router = useRouter();
  const { dismiss } = useFrameSplash();
  const { address, isConnected, username } = useTabIdentity();
  const { ready, authenticated, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { getAccessToken } = useToken();
  const { login } = useLogin();
  const { linkFarcaster, linkTwitter } = useLinkAccount();
  const [isConnecting, setIsConnecting] = useState(false);
  const [socialLinkError, setSocialLinkError] = useState<string | null>(
    null
  );
  const [showPostOtpNotificationDialog, setShowPostOtpNotificationDialog] =
    useState(false);
  const [postOtpNotificationBusy, setPostOtpNotificationBusy] = useState(false);
  const [postOtpNotificationError, setPostOtpNotificationError] = useState<string | null>(null);
  const notificationCheckUserIdRef = useRef<string | null>(null);

  const { open: openScanDrawer } = useScanDrawer();
  const { open, setQuery, setSelectedUser, setSelectedToken, setTokenType } =
    useSendDrawer();

  const [showMorphoDrawer, setShowMorphoDrawer] = useState(false);
  const [showEarnDetailsDialog, setShowEarnDetailsDialog] = useState(false);
  const [showGiftDrawer, setShowGiftDrawer] = useState(false);
  const [showTabAgentPromo, setShowTabAgentPromo] = useState(false);
  const [authWelcomeStep, setAuthWelcomeStep] = useState(0);
  const authWelcomeTouchStartXRef = useRef<number | null>(null);
  const authWelcomeSwipeHandledRef = useRef(false);

  const [friends, setFriends] = useState<SocialUser[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState<string | null>(null);
  const [isDraggingFriends, setIsDraggingFriends] = useState(false);
  const [recentPayments, setRecentPayments] = useState<HomeActivityItem[]>([]);
  const [recentPaymentsLoading, setRecentPaymentsLoading] = useState(false);
  const [multiBalances, setMultiBalances] = useState<MultiBalances | null>(null);
  const friendsScrollRef = useRef<HTMLDivElement | null>(null);
  const friendsDragStateRef = useRef<{
    startX: number;
    startScrollLeft: number;
    dragging: boolean;
    moved: boolean;
  }>({
    startX: 0,
    startScrollLeft: 0,
    dragging: false,
    moved: false,
  });
  const suppressFriendsClickRef = useRef(false);

  const [shake, setShake] = useState(false);
  const [shakeBalance, setShakeBalance] = useState(false);

  const shakeClass = shake ? "animate-shake" : "";

  const totalPortfolio =
    typeof multiBalances?.totalPortfolio === "number"
      ? multiBalances.totalPortfolio
      : 0;

  const tap = "active:scale-95 transition-transform duration-100";

  const [earnBalance, setEarnBalance] = useState<number | null>(null);
  const [monthlyEarn, setMonthlyEarn] = useState<number | null>(null);
  const [jackpotTickets, setJackpotTickets] = useState<number | null>(null);

  const { data: ticketCount, isLoading: loadingTickets } =
    useTicketCountForRound(
      address && address.startsWith("0x")
        ? (address as `0x${string}`)
        : undefined
    );

  const hasEarn = typeof earnBalance === "number" && earnBalance > 0;

  const hasJackpot = typeof jackpotTickets === "number" && jackpotTickets > 0;

  const showActiveCards = hasEarn || hasJackpot;

  const [netApy, setNetApy] = useState<number | null>(null);
  const balancesCacheKey = address ? `tab_balances_${address}` : "tab_balances";
  const tabAgentPromoKey =
    user?.id ? `tab:home:tab-agent-dismissed:${user.id}` : "tab:home:tab-agent-dismissed";

  const formatMonthlyEarnings = (value: number) => {
    if (value <= 0) return "0.00";
    if (value < 0.000001) return "<0.000001";
    if (value < 0.01) return value.toFixed(6);
    return value.toFixed(2);
  };

  const formattedEarnBalance =
    typeof earnBalance === "number" ? `$${earnBalance.toFixed(2)}` : "--";
  const formattedNetApy =
    typeof netApy === "number" ? `${(netApy * 100).toFixed(2)}%` : "--";

  const refetchEarnFromMorpho = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch("https://blue-api.morpho.org/graphql", {
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
            address,
            chainId: 8453,
          },
        }),
      });

      const json = await res.json();
      const positions = json?.data?.userByAddress?.vaultPositions ?? [];
      const vaultPosition = positions.find(
        (p: { vault?: { address?: string }; state?: { assetsUsd?: number } }) =>
          p.vault?.address?.toLowerCase() === VAULT_ADDRESS.toLowerCase()
      );

      setEarnBalance(Number(vaultPosition?.state?.assetsUsd ?? 0));
    } catch (e) {
      console.error("Failed to fetch Morpho earnings", e);
    }
  }, [address]);

  useEffect(() => {
    if (authenticated) {
      return;
    }
    notificationCheckUserIdRef.current = null;
    setShowPostOtpNotificationDialog(false);
    setPostOtpNotificationBusy(false);
    setPostOtpNotificationError(null);
  }, [authenticated]);

  useEffect(() => {
    if (!user?.id) {
      setSocialLinkError(null);
    }
  }, [user?.id]);

  useEffect(() => {
    if (typeof ticketCount === "number") {
      setJackpotTickets(ticketCount);
    }
  }, [ticketCount]);

  const hasLinkedFarcaster = Boolean(
    user?.farcaster ||
      user?.linkedAccounts?.some((account) => account.type === "farcaster")
  );
  const hasLinkedTwitter = Boolean(
    user?.twitter ||
      user?.linkedAccounts?.some((account) => account.type === "twitter_oauth")
  );
  const linkedFarcasterFid = user?.farcaster?.fid ?? null;
  const linkedFarcasterUsername = user?.farcaster?.username ?? null;
  const linkedTwitterSubject = user?.twitter?.subject ?? null;
  const linkedTwitterUsername = user?.twitter?.username ?? null;

  const hasLinkedSupportedSocial = hasLinkedFarcaster || hasLinkedTwitter;

  const shouldShowSocialLinkStep = Boolean(
    ready && authenticated && user?.id && !hasLinkedSupportedSocial
  );

  const getAuthToken = useCallback(async () => {
    return identityToken ?? (await getAccessToken().catch(() => null));
  }, [identityToken, getAccessToken]);

  useEffect(() => {
    if (!authenticated || !user?.id) return;
    if (notificationCheckUserIdRef.current === user.id) return;
    notificationCheckUserIdRef.current = user.id;

    let cancelled = false;

    const checkPushStatus = async () => {
      const promptSeenKey = `tab:post-otp-push-prompt-seen:${user.id}`;
      try {
        try {
          if (localStorage.getItem(promptSeenKey) === "1") {
            return;
          }
        } catch {
          // ignore
        }

        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          try {
            localStorage.setItem(promptSeenKey, "1");
          } catch {}
          return;
        }

        const token = await getAuthToken();
        if (!token || cancelled) return;

        const res = await fetch("/api/webpush/subscriptions", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => null)) as WebPushState | null;
        if (cancelled) return;

        const hasEnabledSub = Boolean(data?.subscriptions?.length);
        if (hasEnabledSub) {
          try {
            localStorage.setItem(promptSeenKey, "1");
          } catch {}
          return;
        }

        setPostOtpNotificationError(null);
        setShowPostOtpNotificationDialog(true);
      } catch {
        // If status check fails, don't block onboarding.
      }
    };

    void checkPushStatus();
    return () => {
      cancelled = true;
    };
  }, [authenticated, user?.id, getAuthToken]);

  useEffect(() => {
    const cached = localStorage.getItem("tab_actives");
    if (!cached) return;

    try {
      const parsed = JSON.parse(cached);
      if (typeof parsed.earnBalance === "number")
        setEarnBalance(parsed.earnBalance);
      if (typeof parsed.monthlyEarn === "number")
        setMonthlyEarn(parsed.monthlyEarn);
      if (typeof parsed.jackpotTickets === "number")
        setJackpotTickets(parsed.jackpotTickets);
      if (typeof parsed.netApy === "number") setNetApy(parsed.netApy);
    } catch {}
  }, []);

  useEffect(() => {
    if (
      earnBalance === null &&
      monthlyEarn === null &&
      jackpotTickets === null &&
      netApy === null
    )
      return;

    localStorage.setItem(
      "tab_actives",
      JSON.stringify({
        earnBalance,
        monthlyEarn,
        jackpotTickets,
        netApy,
      })
    );
  }, [earnBalance, monthlyEarn, jackpotTickets, netApy]);

  useEffect(() => {
    const prefetch = () => {
      router.prefetch("/table");
      router.prefetch("/faq");
      router.prefetch("/split/new");
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = (window as Window & { requestIdleCallback: (cb: IdleRequestCallback) => number }).requestIdleCallback(
        () => prefetch()
      );
      return () => {
        if ("cancelIdleCallback" in window) {
          (
            window as Window & { cancelIdleCallback: (id: number) => void }
          ).cancelIdleCallback(id);
        }
      };
    }

    prefetch();
  }, [router]);

  useEffect(() => {
    const fetchApy = async () => {
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

        const json = await res.json();
        const apy = json?.data?.vaultByAddress?.state?.netApy;

        if (typeof apy === "number") {
          setNetApy(apy);
        }
      } catch (err) {
        console.error("Failed to fetch Morpho APY", err);
      }
    };

    fetchApy();
  }, []);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    const fetchEarnFromMorpho = async () => {
      try {
        if (cancelled) return;
        await refetchEarnFromMorpho();
      } catch (e) {
        console.error("Failed to fetch Morpho earnings", e);
      }
    };

    fetchEarnFromMorpho();

    return () => {
      cancelled = true;
    };
  }, [address, refetchEarnFromMorpho]);

  useEffect(() => {
    if (
      typeof earnBalance !== "number" ||
      typeof netApy !== "number" ||
      earnBalance <= 0
    ) {
      return; // 👈 do NOTHING, don’t zero it
    }

    setMonthlyEarn((earnBalance * netApy) / 12);
  }, [earnBalance, netApy]);

  const isLoadingActives =
    earnBalance === null &&
    netApy === null &&
    monthlyEarn === null &&
    jackpotTickets === null;

  useEffect(() => {
    if (!hasLinkedFarcaster && !hasLinkedTwitter) {
      setFriends([]);
      setFriendsLoading(false);
      setFriendsError(null);
      return;
    }

    const friendsCacheKey =
      hasLinkedFarcaster
        ? (linkedFarcasterFid ? `farcaster:mutuals:fid:${linkedFarcasterFid}` : null) ??
          (linkedFarcasterUsername
            ? `farcaster:mutuals:username:${linkedFarcasterUsername.toLowerCase()}`
            : null) ??
          (address ? `farcaster:mutuals:address:${address.toLowerCase()}` : null)
        : (linkedTwitterSubject ? `twitter:followers:${linkedTwitterSubject}` : null) ??
          (linkedTwitterUsername
            ? `twitter:followers:${linkedTwitterUsername.toLowerCase()}`
            : null);
    if (!friendsCacheKey) return;

    const cached = localStorage.getItem(`tab_friends_${friendsCacheKey}`);
    if (!cached) return;

    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setFriends(parsed);
        setFriendsError(null);
      }
    } catch {}
  }, [
    linkedFarcasterFid,
    linkedFarcasterUsername,
    linkedTwitterSubject,
    linkedTwitterUsername,
    hasLinkedFarcaster,
    address,
  ]);

  /* LOAD FRIENDS */
  useEffect(() => {
    if (!hasLinkedFarcaster && !hasLinkedTwitter)
      return;
    let cancelled = false;

    const fetchFriends = async () => {
      if (!cancelled) {
        setFriendsLoading(true);
        setFriendsError(null);
      }
      try {
        if (!hasLinkedFarcaster && hasLinkedTwitter) {
          const token = await getAuthToken();
          if (!token) {
            if (!cancelled) {
              setFriends([]);
              setFriendsError("Sign in again to load Twitter follows.");
            }
            return;
          }

          const res = await fetch("/api/twitter/followers?limit=10", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json().catch(() => null);

          if (cancelled) return;

          if (Array.isArray(data)) {
            setFriends(data);
            setFriendsError(null);
            const cacheKey =
              (linkedTwitterSubject ? `twitter:followers:${linkedTwitterSubject}` : null) ??
              (linkedTwitterUsername
                ? `twitter:followers:${linkedTwitterUsername.toLowerCase()}`
                : null);
            if (cacheKey) {
              localStorage.setItem(
                `tab_friends_${cacheKey}`,
                JSON.stringify(data)
              );
            }
          } else {
            setFriends([]);
            const message =
              typeof data?.error === "string"
                ? data.error
                : "Unable to load Twitter follows.";
            setFriendsError(
              message.includes("CreditsDepleted")
                ? "Twitter API credits are depleted for follows right now."
                : message
            );
          }
          return;
        }

        const query = linkedFarcasterFid
          ? `fid=${encodeURIComponent(String(linkedFarcasterFid))}`
          : linkedFarcasterUsername
            ? `username=${encodeURIComponent(linkedFarcasterUsername)}`
            : `address=${encodeURIComponent(address!)}`;
        const res = await fetch(`/api/neynar/user/mutuals?${query}`);
        const data = await res.json();

        if (cancelled) return;

        if (Array.isArray(data) && data.length > 0) {
          const next = data
            .slice(0, 10)
            .map((entry) => entry?.user ?? entry)
            .filter(Boolean)
            .map((entry: SocialUser) => ({
              ...entry,
              id:
                typeof entry?.fid === "number"
                  ? `farcaster:${entry.fid}`
                  : `farcaster:${String(entry?.username ?? "").toLowerCase()}`,
              provider: "farcaster" as const,
            })) as SocialUser[];
          setFriends(next);
          setFriendsError(null);
          const cacheKey =
            (linkedFarcasterFid ? `farcaster:mutuals:fid:${linkedFarcasterFid}` : null) ??
            (linkedFarcasterUsername
              ? `farcaster:mutuals:username:${linkedFarcasterUsername.toLowerCase()}`
              : null) ??
            (address ? `farcaster:mutuals:address:${address.toLowerCase()}` : null);
          if (!cacheKey) return;
          localStorage.setItem(
            `tab_friends_${cacheKey}`,
            JSON.stringify(next)
          );
        } else {
          setFriends([]);
          setFriendsError(null);
        }
      } catch {
        if (!cancelled) {
          setFriends([]);
          setFriendsError("Unable to load friends right now.");
        }
      } finally {
        if (!cancelled) {
          setFriendsLoading(false);
        }
      }
    };

    fetchFriends();

    return () => {
      cancelled = true;
    };
  }, [
    linkedFarcasterFid,
    linkedFarcasterUsername,
    linkedTwitterSubject,
    linkedTwitterUsername,
    hasLinkedFarcaster,
    hasLinkedTwitter,
    address,
    identityToken,
    getAccessToken,
  ]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const fetchRecentPayments = async () => {
      if (!address) {
        setRecentPayments([]);
        setRecentPaymentsLoading(false);
        return;
      }

      setRecentPaymentsLoading(true);
      try {
        const qs = new URLSearchParams({
          address,
          limit: "12",
          skipExternal: "1",
        });
        const res = await fetch(`/api/activity?${qs.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!res.ok) {
          if (!cancelled) setRecentPayments([]);
          return;
        }

        const data = await res.json().catch(() => null);
        if (cancelled) return;

        const next = Array.isArray(data?.activity)
          ? (data.activity as HomeActivityItem[])
              .filter((item) => PAYMENT_ACTIVITY_TYPES.has(String(item?.type ?? "")))
              .slice(0, 4)
          : [];
        setRecentPayments(next);
      } catch {
        if (!cancelled) {
          setRecentPayments([]);
        }
      } finally {
        if (!cancelled) {
          setRecentPaymentsLoading(false);
        }
      }
    };

    void fetchRecentPayments();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [address]);

  useEffect(() => {
    if (!address) return;
    const pendingTimeouts = new Set<number>();

    const mergeAndCacheBalances = (
      prev: MultiBalances | null,
      data: { base?: number; totalPortfolio?: number }
    ) => {
      const merged: MultiBalances = { ...(prev ?? {}) };
      if (typeof data.base === "number") merged.base = data.base;
      if (typeof data.totalPortfolio === "number") {
        merged.totalPortfolio = data.totalPortfolio;
      }
      localStorage.setItem(balancesCacheKey, JSON.stringify(merged));
      return merged;
    };

    const refetchBalances = async () => {
      if (!address || !address.startsWith("0x")) return;
      const data = await loadBalances(address as `0x${string}`, true);
      setMultiBalances((prev) => mergeAndCacheBalances(prev, data));
    };

    const applyOptimisticUsdcDelta = (deltaUsdc: number) => {
      setMultiBalances((prev) => {
        const merged: MultiBalances = { ...(prev ?? {}) };
        const current = typeof merged.base === "number" ? merged.base : 0;
        merged.base = Math.max(0, current + deltaUsdc);
        const currentPortfolio =
          typeof merged.totalPortfolio === "number" ? merged.totalPortfolio : 0;
        merged.totalPortfolio = Math.max(0, currentPortfolio + deltaUsdc);
        localStorage.setItem(balancesCacheKey, JSON.stringify(merged));
        return merged;
      });
    };

    const applyOptimisticEarnDelta = (deltaUsd: number) => {
      setEarnBalance((prev) =>
        Math.max(0, (typeof prev === "number" ? prev : 0) + deltaUsd)
      );
    };

    const refetchEarn = () => {
      void refetchEarnFromMorpho();
    };

    const onBalanceUpdate = (event: Event) => {
      const detail = (
        event as CustomEvent<{ deltaUsdc?: number; earnDeltaUsd?: number } | undefined>
      ).detail;
      const hasEarnDelta = !!detail && typeof detail.earnDeltaUsd === "number";
      if (detail && typeof detail.deltaUsdc === "number") {
        applyOptimisticUsdcDelta(detail.deltaUsdc);
      }
      if (detail && typeof detail.earnDeltaUsd === "number") {
        applyOptimisticEarnDelta(detail.earnDeltaUsd);
      }

      pendingTimeouts.forEach((id) => window.clearTimeout(id));
      pendingTimeouts.clear();
      refetchBalances();
      // Morpho indexer/RPC can lag right after a deposit/withdrawal; avoid
      // clobbering optimistic earn state with a stale immediate fetch.
      if (!hasEarnDelta) {
        refetchEarn();
      }

      // Follow-up pulls for pending tx propagation on RPC/indexers.
      const first = window.setTimeout(refetchBalances, 1800);
      const second = window.setTimeout(refetchBalances, 4500);
      const earnFirst = window.setTimeout(refetchEarn, 1800);
      const earnSecond = window.setTimeout(refetchEarn, 4500);
      pendingTimeouts.add(first);
      pendingTimeouts.add(second);
      pendingTimeouts.add(earnFirst);
      pendingTimeouts.add(earnSecond);
    };

    window.addEventListener("tab:balance-updated", onBalanceUpdate);
    void refetchBalances();
    void refetchEarnFromMorpho();

    return () => {
      pendingTimeouts.forEach((id) => window.clearTimeout(id));
      pendingTimeouts.clear();
      window.removeEventListener("tab:balance-updated", onBalanceUpdate);
    };
  }, [address, balancesCacheKey, refetchEarnFromMorpho]);

  useEffect(() => {
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    try {
      setShowTabAgentPromo(localStorage.getItem(tabAgentPromoKey) !== "1");
    } catch {
      setShowTabAgentPromo(true);
    }
  }, [tabAgentPromoKey]);

  // Restore cached balances fast (prevents flicker to 0)
  useEffect(() => {
    if (!address) return;
    const cached =
      localStorage.getItem(balancesCacheKey) ??
      localStorage.getItem("tab_balances");
    if (cached) setMultiBalances(JSON.parse(cached));
  }, [address, balancesCacheKey]);

  /* SIMPLE HAPTICS */
  const triggerClickHaptics = () => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(15);
    }
  };

  const dismissTabAgentPromo = useCallback(() => {
    try {
      localStorage.setItem(tabAgentPromoKey, "1");
    } catch {}
    setShowTabAgentPromo(false);
  }, [tabAgentPromoKey]);

  const handleFriendsMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const container = friendsScrollRef.current;
      if (!container) return;
      suppressFriendsClickRef.current = false;
      friendsDragStateRef.current = {
        startX: event.clientX,
        startScrollLeft: container.scrollLeft,
        dragging: true,
        moved: false,
      };
      setIsDraggingFriends(false);
    },
    []
  );

  const handleFriendsClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!suppressFriendsClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      window.setTimeout(() => {
        suppressFriendsClickRef.current = false;
      }, 0);
    },
    []
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const container = friendsScrollRef.current;
      const drag = friendsDragStateRef.current;
      if (!container || !drag.dragging) return;

      const deltaX = event.clientX - drag.startX;
      if (Math.abs(deltaX) > 8) {
        drag.moved = true;
        setIsDraggingFriends(true);
      }
      if (drag.moved) {
        container.scrollLeft = drag.startScrollLeft - deltaX;
      }
    };

    const handleMouseUp = () => {
      const didMove = friendsDragStateRef.current.moved;
      suppressFriendsClickRef.current = didMove;
      friendsDragStateRef.current = {
        startX: 0,
        startScrollLeft: 0,
        dragging: false,
        moved: false,
      };
      setIsDraggingFriends(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  /* ------------------------------------------ */
  /* LANDING PAGE (WALLET CONNECT) */
  /* ------------------------------------------ */
  const hasFriends = friends.length > 0;
  const formatActivityTime = (timestamp: string | Date) => {
    const ts = new Date(timestamp);
    const diffMs = Date.now() - ts.getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return "";
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return `${Math.max(minutes, 1)}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  const getActivityCounterparty = (item: HomeActivityItem) => {
    if (item.counterparty) {
      return item.counterparty.startsWith("0x")
        ? shortAddress(item.counterparty)
        : `@${item.counterparty}`;
    }
    if (item.recipientUsername) return `@${item.recipientUsername}`;
    if (item.recipient && item.recipient.startsWith("0x")) {
      return shortAddress(item.recipient);
    }
    return "someone";
  };

  const getActivityDescription = (item: HomeActivityItem) => {
    if (typeof item.amount === "number") {
      const action =
        item.type === "bill_received" || item.type === "room_received"
          ? "Received"
          : "Paid";
      return `${action} ${item.amount.toFixed(2)}${item.token ? ` ${item.token}` : ""}`;
    }
    return item.description ?? "Payment";
  };

  const openActivityItem = (item: HomeActivityItem) => {
    if (item.txHash) {
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
    router.push("/activity");
  };

  const getActivityVisualClass = (item: HomeActivityItem) => {
    return item.type === "bill_received" || item.type === "room_received"
      ? "bg-emerald-500/20 text-emerald-300"
      : "bg-green-500/20 text-green-300";
  };

  const dismissPostOtpNotificationDialog = useCallback(() => {
    if (!user?.id) {
      setShowPostOtpNotificationDialog(false);
      return;
    }
    try {
      localStorage.setItem(`tab:post-otp-push-prompt-seen:${user.id}`, "1");
    } catch {}
    setShowPostOtpNotificationDialog(false);
    setPostOtpNotificationError(null);
  }, [user?.id]);

  const enablePostOtpNotifications = useCallback(async () => {
    setPostOtpNotificationError(null);
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPostOtpNotificationError("This browser does not support notifications.");
      return;
    }

    const token = await getAuthToken();
    if (!token) {
      setPostOtpNotificationError("Sign in required.");
      return;
    }

    setPostOtpNotificationBusy(true);
    try {
      const statusRes = await fetch("/api/webpush/subscriptions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const statusJson = (await statusRes.json().catch(() => null)) as WebPushState | null;
      if (!statusRes.ok) {
        throw new Error("Failed to load notification settings.");
      }
      if (!statusJson?.configured || !statusJson.vapidPublicKey) {
        throw new Error("Notifications are not configured on the server yet.");
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
      if (!saveRes.ok) {
        throw new Error(saveJson?.error ?? "Failed to save notification subscription.");
      }

      dismissPostOtpNotificationDialog();
    } catch (error) {
      setPostOtpNotificationError(
        error instanceof Error ? error.message : "Failed to enable notifications."
      );
    } finally {
      setPostOtpNotificationBusy(false);
    }
  }, [dismissPostOtpNotificationDialog, getAuthToken]);

  if (!ready) {
    return <AuthValidationSplash />;
  }

  if (!authenticated) {
    const activeWelcomeSlide = AUTH_WELCOME_STEPS[authWelcomeStep];

    return (
      <main className="relative h-[100dvh] w-full overflow-hidden bg-background text-center text-white overscroll-none">

        <div className="relative z-10 h-full px-6 mx-auto w-full max-w-md flex flex-col">
          <div className="bg-background flex-1 min-h-0 pt-[max(6rem,env(safe-area-inset-top))] pb-44 flex flex-col">
            <div
              onTouchStart={(e) => {
                authWelcomeTouchStartXRef.current = e.touches[0]?.clientX ?? null;
                authWelcomeSwipeHandledRef.current = false;
              }}
              onTouchMove={(e) => {
                e.preventDefault();
                if (authWelcomeSwipeHandledRef.current) return;
                const startX = authWelcomeTouchStartXRef.current;
                const currentX = e.touches[0]?.clientX ?? null;
                if (startX === null || currentX === null) return;

                const deltaX = currentX - startX;
                const threshold = 18;
                let nextIndex: number | null = null;

                if (deltaX <= -threshold) {
                  nextIndex = Math.min(AUTH_WELCOME_STEPS.length - 1, authWelcomeStep + 1);
                } else if (deltaX >= threshold) {
                  nextIndex = Math.max(0, authWelcomeStep - 1);
                }

                if (nextIndex === null || nextIndex === authWelcomeStep) return;
                authWelcomeSwipeHandledRef.current = true;
                setAuthWelcomeStep(nextIndex);
              }}
              onTouchEnd={(e) => {
                const startX = authWelcomeTouchStartXRef.current;
                const endX = e.changedTouches[0]?.clientX ?? null;
                const alreadyHandled = authWelcomeSwipeHandledRef.current;
                authWelcomeTouchStartXRef.current = null;
                authWelcomeSwipeHandledRef.current = false;
                if (alreadyHandled) return;

                if (startX === null || endX === null) return;
                const deltaX = endX - startX;
                const threshold = 18;
                if (deltaX <= -threshold) {
                  setAuthWelcomeStep((prev) =>
                    Math.min(AUTH_WELCOME_STEPS.length - 1, prev + 1)
                  );
                } else if (deltaX >= threshold) {
                  setAuthWelcomeStep((prev) => Math.max(0, prev - 1));
                }
              }}
              className="flex-1 min-h-0 w-full overflow-hidden overscroll-none touch-none select-none"
            >
              <section
                key={activeWelcomeSlide.key}
                className="h-full w-full flex flex-col items-center justify-center text-center px-2 min-h-full"
              >
                {activeWelcomeSlide.kind === "brand" ? (
                  <div className="w-full max-w-sm mx-auto flex items-center justify-center md:pt-24">
                    <AuthBrandLockup />
                  </div>
                ) : (
                  <div className="w-full max-w-sm mx-auto flex flex-col items-center justify-center md:pt-18">
                    <div
                      aria-hidden
                      className="relative grid place-items-center h-54 w-54 rounded-full"
                    >
                      <div className="grid place-items-center h-40 w-40 rounded-full">
                        <img
                          src={activeWelcomeSlide.iconSrc}
                          alt=""
                          aria-hidden="true"
                          className="w-[148px] h-[148px] object-contain object-center"
                        />
                      </div>
                    </div>

                    <h2 className="text-xl leading-[1.08] font-semibold tracking-tight text-white text-center">
                      {activeWelcomeSlide.title}
                    </h2>
                    <p className="mt-3 text-lg leading-tight text-white/45 max-w-[18rem] text-center">
                      {activeWelcomeSlide.desc}
                    </p>
                  </div>
                )}
              </section>
            </div>

            <div className="mt-3 flex items-center justify-center gap-2">
              {AUTH_WELCOME_STEPS.map((step, idx) => (
                <button
                  key={step.key}
                  type="button"
                  aria-label={`Go to step ${idx + 1}`}
                  aria-current={authWelcomeStep === idx}
                  onClick={() => {
                    setAuthWelcomeStep(idx);
                  }}
                  className={clsx(
                    "h-2.5 rounded-full transition-all",
                    authWelcomeStep === idx
                      ? "w-6 bg-primary"
                      : "w-2.5 bg-white/20"
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="fixed bottom-0 inset-x-0 z-20 p-5 pb-8">
          <div className="mx-auto w-full max-w-md">
            <Button
              className="w-full bg-white text-black shadow-[0_10px_40px_rgba(0,0,0,0.35)] mb-2"
              onClick={() => {
                const isLastWelcomeStep =
                  authWelcomeStep >= AUTH_WELCOME_STEPS.length - 1;
                if (!isLastWelcomeStep) {
                  setAuthWelcomeStep((prev) =>
                    Math.min(AUTH_WELCOME_STEPS.length - 1, prev + 1)
                  );
                  return;
                }
                login();
              }}
            >
              {authWelcomeStep >= AUTH_WELCOME_STEPS.length - 1
                ? "Sign up / Login"
                : "Continue"}
            </Button>
            {authWelcomeStep >= AUTH_WELCOME_STEPS.length - 1 ? (
              <p className="hidden text-center text-sm text-white/35">
                Sign in with Twitter, Farcaster, or email.
              </p>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  if (authenticated && user?.id && showPostOtpNotificationDialog) {
    return (
      <main className="relative h-[100dvh] w-full overflow-hidden bg-background text-center text-white overscroll-none">
        <div className="relative z-10 h-full px-6 mx-auto w-full max-w-md flex flex-col items-center justify-center">
          <AuthBrandLockup />
        </div>

        <ResponsiveDialog open onOpenChange={() => {}}>
          <ResponsiveDialogContent className="p-4 md:w-full md:max-w-md max-h-[calc(100dvh-110px)] md:max-h-[85vh] overflow-hidden [&>svg]:hidden">
            <div className="rounded-t-3xl md:rounded-2xl bg-background p-4 md:p-5 flex flex-col gap-5 max-h-[calc(100dvh-140px)] md:max-h-[calc(85vh-2rem)] overflow-y-auto">
              <ResponsiveDialogTitle className="sr-only">
                Allow notifications
              </ResponsiveDialogTitle>

              <div className="text-left">
                <h2 className="text-lg font-semibold leading-tight">
                  Allow notifications
                </h2>
                <p className="mt-2 text-white/50 text-sm">
                  Get payment alerts and reminders from Tab. You can change this later.
                </p>
              </div>

              {postOtpNotificationError ? (
                <p className="text-red-300/90 text-sm text-left">
                  {postOtpNotificationError}
                </p>
              ) : null}

              <div className="flex flex-col gap-3">
                <Button
                  className="w-full bg-primary text-black font-semibold"
                  disabled={postOtpNotificationBusy}
                  onClick={() => void enablePostOtpNotifications()}
                >
                  {postOtpNotificationBusy ? "Enabling..." : "Allow notifications"}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full bg-white/5 text-white hover:bg-white/10"
                  disabled={postOtpNotificationBusy}
                  onClick={dismissPostOtpNotificationDialog}
                >
                  Not now
                </Button>
              </div>
            </div>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </main>
    );
  }

  if (shouldShowSocialLinkStep) {
    return (
      <main className="relative h-[100dvh] w-full overflow-hidden bg-background text-center text-white overscroll-none">

        <div className="relative z-10 h-full px-6 mx-auto w-full max-w-md flex flex-col items-center justify-center">
          <AuthBrandLockup />
        </div>

        <ResponsiveDialog open onOpenChange={() => {}}>
          <ResponsiveDialogContent className="p-4 md:w-full md:max-w-md max-h-[calc(100dvh-110px)] md:max-h-[85vh] overflow-hidden [&>svg]:hidden">
            <div className="rounded-t-3xl md:rounded-2xl bg-background p-4 md:p-5 flex flex-col gap-5 max-h-[calc(100dvh-140px)] md:max-h-[calc(85vh-2rem)] overflow-y-auto">
              <ResponsiveDialogTitle className="sr-only">
                Link a social account
              </ResponsiveDialogTitle>

              <div className="text-left">
                <h2 className="text-lg font-semibold leading-tight">
                  Link a social account
                </h2>
                <p className="mt-2 text-white/50 text-sm">
                  Link Farcaster or Twitter to continue. Your Privy wallet stays on the
                  same Tab account as long as you link the second social onto this same
                  login.
                </p>
              </div>

              {socialLinkError && (
                <p className="text-red-300/90 text-sm text-left">
                  {socialLinkError}
                </p>
              )}

              <div className="flex flex-col gap-3">
                <Button
                  className="w-full bg-primary text-black font-semibold"
                  onClick={async () => {
                    setSocialLinkError(null);
                    try {
                      await Promise.resolve(linkFarcaster());
                    } catch (err) {
                      console.error("Failed to initialize Farcaster linking", err);
                      setSocialLinkError(
                        "Farcaster linking is not enabled for this app yet. Enable Farcaster in Privy Dashboard and try again."
                      );
                    }
                  }}
                >
                  Link Farcaster
                </Button>

                <Button
                  variant="secondary"
                  className="w-full font-semibold"
                  onClick={async () => {
                    setSocialLinkError(null);
                    try {
                      await Promise.resolve(linkTwitter());
                    } catch (err) {
                      console.error("Failed to initialize Twitter linking", err);
                      setSocialLinkError(
                        "Twitter linking is not enabled for this app yet. Enable Twitter in Privy Dashboard and try again."
                      );
                    }
                  }}
                >
                  Link Twitter
                </Button>
              </div>

              <p className="hidden text-xs text-white/20 text-center">2025 © tab tech</p>
            </div>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </main>
    );
  }

  /* ------------------------------- */
  /* MINI-APP EXPERIENCE (INSIDE FC) */
  /* ------------------------------- */
  return (
    <ReceiveDrawerController>
      {({ openReceiveDrawer }) => (
        <main className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
          <div className="w-full max-w-md space-y-8">
        <div className="w-full space-y-2">
          {/* BALANCE CARD */}
          <div
            onClick={() => router.push("/profile")}
            className="w-full bg-white/5 rounded-xl p-3 text-left mt-2 cursor-pointer transition-colors"
          >
            <h2 className="ml-2 text-white font-2xl font-medium mb-2 flex items-center gap-1 mt-1">
              Balance
              <img src="/base.png" className="w-4 h-4 opacity-90" />
            </h2>

            <p
              className={clsx(
                "ml-2 text-4xl text-white font-semibold mb-2",
                shakeBalance && "animate-balance-shake"
              )}
            >
              {!multiBalances ? "$0.00" : `$${totalPortfolio.toFixed(2)}`}
            </p>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();

                  if (totalPortfolio === 0) {
                    setShakeBalance(true);
                    setTimeout(() => setShakeBalance(false), 500);
                    triggerClickHaptics();
                    return;
                  }

                  open();
                  triggerClickHaptics();
                }}
                className="bg-white/5 text-white py-3 rounded-lg text-base font-semibold active:scale-95 transition duration-100"
              >
                Send
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openReceiveDrawer();
                  triggerClickHaptics();
                }}
                className={`bg-white/5 text-white  py-3 rounded-lg text-base font-semibold ${tap}`}
              >
                Deposit
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  router.push("/split/new");
                  triggerClickHaptics();
                }}
                className={`bg-white active:bg-white/90 transition-colors text-black py-3 rounded-lg text-base font-semibold col-span-2 ${tap}`}
              >
                Create a split
              </button>
            </div>
          </div>

          {showTabAgentPromo && (
            <div className="w-full">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    dismissTabAgentPromo();
                    router.push("/faq");
                  }}
                  className="w-full flex items-center gap-3 bg-white/5 rounded-xl p-4 text-left active:scale-[0.98] transition"
                >
                  <div className="w-10 h-10 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0">
                    <Bot className="w-5 h-5 text-blue-400" />
                  </div>

                  <div className="min-w-0">
                    <p className="text-base font-medium text-white">
                      Tab Agent
                    </p>
                    <p className="text-md text-white/40 mt-0.5 truncate">
                      Link your account to your openclaw agent
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  aria-label="Dismiss Tab Agent"
                  onClick={dismissTabAgentPromo}
                  className="absolute right-5 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full text-white/45 bg-white/5 hover:text-white/70"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {(showActiveCards || isLoadingActives) && (
          <div className="mt-4">
            <div className="text-lg ml-2 font-medium mb-2">Active</div>

            <div className="mt-3 flex gap-2">
              {isLoadingActives ? (
                <>
                  <ActiveCardSkeleton />
                  <ActiveCardSkeleton />
                </>
              ) : (
                <>
                  {hasEarn && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowEarnDetailsDialog(true);
                      }}
                      className="flex-1 bg-white/5 rounded-xl px-4 py-3 text-left active:scale-95 transition"
                    >
                      <p className="text-sm text-white/40">Earning</p>
                      <p className="text-sm text-white font-medium">
                        {/* ${earnBalance!.toFixed(2)} */}
                        {typeof monthlyEarn === "number" && monthlyEarn > 0 && (
                          <span className="text-green-400 ml-1 whitespace-nowrap text-xs">
                            +${formatMonthlyEarnings(monthlyEarn * 12)}/yr
                          </span>
                        )}
                      </p>
                    </button>
                  )}

                  {hasJackpot && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push("/jackpot");
                      }}
                      className="flex-1 bg-white/5 rounded-xl px-4 py-3 text-left active:scale-95 transition"
                    >
                      <p className="text-sm text-white/40">Jackpot</p>
                      <p className="text-md text-white font-medium">
                        {jackpotTickets} ticket{jackpotTickets! > 1 ? "s" : ""}
                      </p>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* FRIENDS */}
        <div className="w-full">
          <div className="text-lg ml-2 font-medium mb-2">
            Pay friends quickly
          </div>

          <div
            ref={friendsScrollRef}
            onMouseDown={handleFriendsMouseDown}
            onClickCapture={handleFriendsClickCapture}
            onDragStartCapture={(event) => event.preventDefault()}
            className={clsx(
              "flex gap-1 overflow-x-auto scrollbar-hide py-1 ml-1 select-none",
              isDraggingFriends ? "cursor-grabbing" : "cursor-grab"
            )}
          >
            {friendsLoading && !hasFriends
              ? Array.from({ length: 6 }).map((_, i) => (
                  <FriendSkeleton key={i} />
                ))
              : hasFriends
                ? friends.slice(0, 20).map((f) => (
                  <button
                    key={getSocialUserKey(f)}
                    onDragStart={(event) => event.preventDefault()}
                    onClick={() => {
                      setQuery("");
                      setSelectedUser(f);
                      setSelectedToken("USDC");
                      setTokenType("USDC");

                      setTimeout(() => open(), 0);
                    }}
                    className="flex flex-col items-center w-[33%] min-w-[64px]"
                  >
                    <UserAvatar
                      src={f.pfp_url}
                      seed={f.username ?? f.fid ?? f.id}
                      width={56}
                      className="w-14 h-14 rounded-full object-cover"
                    />
                    <span className="text-[13px] text-white/70 mt-1 truncate max-w-[60px]">
                      {f.username ?? "user"}
                    </span>
                  </button>
                ))
                : (
                  <div className="px-2 py-3 text-sm text-white/45">
                    {friendsError ?? "No friends available yet."}
                  </div>
                )}
          </div>
        </div>

        {/* FEATURE CARDS */}
        <div className="mt-6">
          <div className="text-lg ml-2 font-medium mb-3">
            More ways to use tab
          </div>
          <div className="space-y-2">
          <button
            onClick={() => setShowMorphoDrawer(true)}
            className="w-full flex items-center gap-3 bg-white/5 rounded-xl p-4 text-left active:scale-[0.98] transition"
          >
            <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <ChartNoAxesColumnIncreasing className="w-5 h-5 text-emerald-400" />
            </div>

            <div>
              <p className="text-base font-medium text-white">Earn Interest</p>
              <p className="text-md text-white/40 mt-0.5">
                Put your USDC at work with 6% APY
              </p>
            </div>
          </button>

          <button
            onClick={() => router.push("/jackpot")}
            className="w-full flex items-center gap-3 bg-white/5 rounded-xl p-4 text-left active:scale-[0.98] transition"
          >
            <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center">
              <Ticket className="w-5 h-5 text-amber-300" />
            </div>

            <div>
              <p className="text-base font-medium text-white">$1m Jackpot</p>
              <p className="text-md text-white/40 mt-0.5">
                Play daily onchain jackpot
              </p>
            </div>
          </button>

          {/* PAY ROULETTE */}
          <button
            onClick={() => router.push("/table")}
            className="w-full flex items-center gap-3 bg-white/5 rounded-xl p-4 text-left active:scale-[0.98] transition"
          >
            <div className="w-10 h-10 rounded-full bg-purple-500/15 flex items-center justify-center">
              <Dice5 className="w-5 h-5 text-purple-400" />
            </div>

            <div>
              <p className="text-base font-medium text-white">Spin the tab</p>
              <p className="text-md text-white/40 mt-0.5">
                Spin to randomly decide who pays
              </p>
            </div>
          </button>

          </div>
        </div>

        <div className="w-full mt-6">
          <button
            type="button"
            onClick={() => router.push("/activity")}
            className="mb-3 ml-2 flex items-center gap-1 text-lg font-medium"
          >
            Activity
            <ChevronRight className="h-4 w-4 text-white/50" />
          </button>

          {recentPaymentsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={`activity-skeleton-${i}`}
                  className="p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <Skeleton circle width={36} height={36} />
                      <div>
                        <Skeleton width={110} height={14} className="mb-2" />
                        <Skeleton width={150} height={14} />
                      </div>
                    </div>
                    <Skeleton width={18} height={14} />
                  </div>
                </div>
              ))}
            </div>
          ) : recentPayments.length > 0 ? (
            <ul className="space-y-2">
              {recentPayments.map((item, idx) => {
                const key = `${item.type}-${item.txHash ?? item.splitId ?? item.roomId ?? idx}`;
                const label = getActivityCounterparty(item);
                const showAvatar =
                  (item.type === "bill_paid" || item.type === "bill_received") &&
                  !!item.pfp;

                return (
                  <li
                    key={key}
                    className="pt-3 pb-2 px-4 rounded-lg bg-white/5 cursor-pointer flex justify-between"
                    onClick={() => openActivityItem(item)}
                  >
                    <div className="flex gap-3 items-start min-w-0">
                      <div className="shrink-0">
                        {showAvatar ? (
                          <UserAvatar
                            src={item.pfp}
                            seed={item.counterparty ?? item.recipient ?? key}
                            width={36}
                            alt={item.counterparty ?? "User"}
                            className="w-8 h-8 rounded-full object-cover border border-white/10"
                          />
                        ) : (
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center ${getActivityVisualClass(item)}`}
                          >
                            <CircleDollarSign className="w-4 h-4" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="truncate text-white font-medium text-sm">
                          {label}
                        </div>
                        <div className="text-white/40 text-sm leading-snug">
                          {getActivityDescription(item)}
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

                    <div className="ml-4 shrink-0 text-white/30 text-sm">
                      {formatActivityTime(item.timestamp)}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-lg border border-white/10 px-4 py-5 text-sm text-white/45">
              No recent payments yet.
            </div>
          )}
        </div>

          </div>

          <ResponsiveDialog
            open={showEarnDetailsDialog}
            onOpenChange={setShowEarnDetailsDialog}
          >
            <ResponsiveDialogContent className="p-4 md:w-full md:max-w-md max-h-[calc(100dvh-110px)] md:max-h-[85vh] overflow-hidden">
              <div className="rounded-t-3xl md:rounded-2xl bg-background p-4 flex flex-col gap-3 max-h-[calc(100dvh-140px)] md:max-h-[calc(85vh-2rem)] overflow-y-auto">
                <ResponsiveDialogTitle className="text-lg font-semibold text-white text-center">
                  You&apos;re earning
                </ResponsiveDialogTitle>

                <div className="pt-0 text-center">
                  <p className="mt-1 text-5xl sm:text-5xl font-semibold tracking-tight text-white">
                    {formattedNetApy}
                  </p>
                  <p className="mt-2 text-white/45 text-sm">
                    Annual Percentage Yield
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-white/45 text-sm">Deposited</p>
                  <p className="mt-1 text-2xl font-semibold text-white">
                    {formattedEarnBalance}
                  </p>
                  {typeof monthlyEarn === "number" && monthlyEarn > 0 && (
                    <p className="mt-1 text-sm text-green-400">
                      +${formatMonthlyEarnings(monthlyEarn * 12)}/yr at current rate
                    </p>
                  )}
                </div>

                <Button
                  className="w-full bg-primary text-black font-semibold"
                  onClick={() => {
                    setShowEarnDetailsDialog(false);
                    setShowMorphoDrawer(true);
                  }}
                >
                  View
                </Button>
              </div>
            </ResponsiveDialogContent>
          </ResponsiveDialog>

          {/* DRAWERS */}
          <MorphoDepositDrawer
            isOpen={showMorphoDrawer}
            onOpenChange={setShowMorphoDrawer}
          />
        </main>
      )}
    </ReceiveDrawerController>
  );
}
