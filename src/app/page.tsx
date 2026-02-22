"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import { useLinkAccount, useLoginWithEmail, usePrivy } from "@privy-io/react-auth";

import { useScanDrawer } from "@/providers/ScanDrawerProvider";
import { useSendDrawer } from "@/providers/SendDrawerProvider";

import { MorphoDepositDrawer } from "@/components/app/LendingMorpho";
import { ReceiveDrawerController } from "@/components/app/ReceiveDrawerController";
import {
  fetchMoralisPortfolio,
} from "@/lib/moralis-portfolio-client";

import Skeleton from "react-loading-skeleton";
import clsx from "clsx";

import { ArrowLeft, Bot, Clipboard, Dice5, Loader2 } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

import { useTicketCountForRound } from "@/lib/BaseJackpotQueries";
import { useTabIdentity } from "@/lib/useTabIdentity";
import { UserAvatar } from "@/components/ui/user-avatar";

const VAULT_ADDRESS = "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca";
const OTP_LENGTH = 6;

type FriendUser = {
  fid: number;
  username?: string;
  display_name?: string;
  pfp_url?: string;
  verified_addresses?: {
    primary?: {
      eth_address?: string | null;
    };
  };
};

type MultiBalances = {
  base?: number;
  totalPortfolio?: number;
};

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
    <main className="bg-background min-h-screen w-full flex flex-col items-center justify-center p-6 text-center">
      <img
        src="/app.png"
        alt="Tab"
        className="w-16 h-16 mb-4 animate-pulse"
      />
     
    </main>
  );
}

function AuthBrandLockup() {
  return (
    <div className="relative flex flex-col items-center">
      <div
        aria-hidden
        className="absolute left-1/2 top-12 h-40 w-40 -translate-x-1/2 rounded-full bg-indigo-400/10 blur-3xl"
      />
      <img
        src="/app.png"
        alt="Tab App Icon"
        className="relative z-10 w-20 h-20 mb-5 drop-shadow-[0_10px_35px_rgba(99,102,241,0.14)]"
      />
      <h1 className="relative z-10 text-2xl font-semibold tracking-tight leading-none text-white">
        meet tab
      </h1>
      <p className="relative z-10 mt-2 text-lg text-white/35">
        Split, send, and get paid in seconds.
      </p>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const { dismiss } = useFrameSplash();
  const { address, isConnected, username } = useTabIdentity();
  const { ready, authenticated, user } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { linkFarcaster } = useLinkAccount();
  const [isConnecting, setIsConnecting] = useState(false);
  const [authStep, setAuthStep] = useState<"welcome" | "email" | "code">("welcome");
  const [authEmail, setAuthEmail] = useState("");
  const [authOtp, setAuthOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [authBusy, setAuthBusy] = useState<"send" | "verify" | "resend" | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [lastAutoSubmittedCode, setLastAutoSubmittedCode] = useState<string | null>(null);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [farcasterLinkError, setFarcasterLinkError] = useState<string | null>(
    null
  );

  const { open: openScanDrawer } = useScanDrawer();
  const { open, setQuery, setSelectedUser, setSelectedToken, setTokenType } =
    useSendDrawer();

  const [showMorphoDrawer, setShowMorphoDrawer] = useState(false);
  const [showGiftDrawer, setShowGiftDrawer] = useState(false);

  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [multiBalances, setMultiBalances] = useState<MultiBalances | null>(null);

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
    useTicketCountForRound(address);

  const hasEarn = typeof earnBalance === "number" && earnBalance > 0;

  const hasJackpot = typeof jackpotTickets === "number" && jackpotTickets > 0;

  const showActiveCards = hasEarn || hasJackpot;

  const [netApy, setNetApy] = useState<number | null>(null);
  const balancesCacheKey = address ? `tab_balances_${address}` : "tab_balances";

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
      setAuthStep("welcome");
      setAuthOtp(Array(OTP_LENGTH).fill(""));
      setAuthError(null);
      setLastAutoSubmittedCode(null);
      setResendSecondsLeft(0);
      return;
    }
  }, [authenticated]);

  useEffect(() => {
    if (resendSecondsLeft <= 0) return;
    const id = window.setInterval(() => {
      setResendSecondsLeft((prev) => Math.max(prev - 1, 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendSecondsLeft]);

  useEffect(() => {
    if (!user?.id) {
      setFarcasterLinkError(null);
    }
  }, [user?.id]);

  useEffect(() => {
    if (authStep !== "email") return;
    const id = window.setTimeout(() => emailInputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [authStep]);

  useEffect(() => {
    if (typeof ticketCount === "number") {
      setJackpotTickets(ticketCount);
    }
  }, [ticketCount]);

  const hasLinkedFarcaster = Boolean(
    user?.farcaster ||
      user?.linkedAccounts?.some((account) => account.type === "farcaster")
  );
  const linkedFarcasterFid = user?.farcaster?.fid ?? null;
  const linkedFarcasterUsername = user?.farcaster?.username ?? null;

  const shouldShowFarcasterLinkStep = Boolean(
    ready && authenticated && user?.id && !hasLinkedFarcaster
  );

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
    const friendsCacheKey =
      (linkedFarcasterFid ? `fid:${linkedFarcasterFid}` : null) ??
      linkedFarcasterUsername ??
      username ??
      address;
    if (!friendsCacheKey) return;

    const cached = localStorage.getItem(`tab_friends_${friendsCacheKey}`);
    if (!cached) return;

    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setFriends(parsed);
      }
    } catch {}
  }, [linkedFarcasterFid, linkedFarcasterUsername, username, address]);

  /* LOAD FRIENDS */
  useEffect(() => {
    if (!linkedFarcasterFid && !linkedFarcasterUsername && !username && !address) return;
    let cancelled = false;

    const fetchFriends = async () => {
      try {
        const query = linkedFarcasterFid
          ? `fid=${encodeURIComponent(String(linkedFarcasterFid))}`
          : linkedFarcasterUsername
            ? `username=${encodeURIComponent(linkedFarcasterUsername)}`
            : username
              ? `username=${encodeURIComponent(username)}`
              : `address=${encodeURIComponent(address!)}`;
        const res = await fetch(`/api/neynar/user/following?${query}`);
        const data = await res.json();

        if (cancelled) return;

        if (Array.isArray(data) && data.length > 0) {
          const next = data
            .slice(0, 10)
            .map((entry) => entry?.user ?? entry)
            .filter(Boolean) as FriendUser[];
          setFriends(next);
          const cacheKey =
            (linkedFarcasterFid ? `fid:${linkedFarcasterFid}` : null) ??
            linkedFarcasterUsername ??
            username ??
            address;
          if (!cacheKey) return;
          localStorage.setItem(
            `tab_friends_${cacheKey}`,
            JSON.stringify(next)
          );
        }
      } catch {
        // ❌ do nothing — keep cached friends
      }
    };

    fetchFriends();

    return () => {
      cancelled = true;
    };
  }, [linkedFarcasterFid, linkedFarcasterUsername, username, address]);

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
      const data = await loadBalances(address, true);
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

  /* ------------------------------------------ */
  /* LANDING PAGE (WALLET CONNECT) */
  /* ------------------------------------------ */
  const hasFriends = friends.length > 0;
  const authCode = authOtp.join("");

  const startEmailLogin = async (opts?: { resend?: boolean }) => {
    const email = authEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthError("Enter a valid email.");
      return;
    }

    setAuthError(null);
    setAuthBusy(opts?.resend ? "resend" : "send");

    try {
      await sendCode({ email });
      setAuthStep("code");
      setAuthOtp(Array(OTP_LENGTH).fill(""));
      setResendSecondsLeft(60);
      setTimeout(() => otpInputRefs.current[0]?.focus(), 0);
    } catch (err) {
      console.error("Email code send failed", err);
      setAuthError("Could not send code. Please try again.");
    } finally {
      setAuthBusy(null);
    }
  };

  const confirmEmailCode = async () => {
    if (authCode.length !== OTP_LENGTH) {
      setAuthError("Enter the 6-digit code.");
      return;
    }

    setAuthError(null);
    setAuthBusy("verify");
    try {
      await loginWithCode({ code: authCode });
    } catch (err) {
      console.error("Email code verify failed", err);
      setAuthError("Invalid code. Please try again.");
    } finally {
      setAuthBusy(null);
    }
  };

  const setOtpDigit = (index: number, nextValue: string) => {
    const digit = nextValue.replace(/\D/g, "").slice(-1);
    setAuthOtp((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < OTP_LENGTH - 1) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const fillOtpFromDigits = (digits: string) => {
    const cleaned = digits.replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!cleaned) return;
    setAuthOtp((prev) => {
      const next = [...prev];
      for (let i = 0; i < OTP_LENGTH; i += 1) {
        next[i] = cleaned[i] ?? "";
      }
      return next;
    });
    setAuthError(null);
    const focusIndex = Math.min(cleaned.length, OTP_LENGTH - 1);
    setTimeout(() => otpInputRefs.current[focusIndex]?.focus(), 0);
  };

  const pasteOtpFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      fillOtpFromDigits(text);
    } catch (err) {
      console.error("Clipboard read failed", err);
      setAuthError("Paste failed. Try long-press paste.");
    }
  };

  const emailDomainSuggestions = ["@gmail.com", "@icloud.com", "@proton.me"];
  const emailValueTrimmed = authEmail.trim();
  const isAuthEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValueTrimmed);
  const emailLocalPart = emailValueTrimmed.split("@")[0] ?? "";
  const showInvalidEmailError = authError === "Enter a valid email.";
  const showEmailDomainSuggestions =
    authStep === "email" && emailLocalPart.length > 0;

  const applyEmailDomainSuggestion = (domain: string) => {
    const local = authEmail.trim().split("@")[0]?.replace(/\s/g, "") ?? "";
    if (!local) return;
    setAuthEmail(`${local}${domain}`);
    setAuthError(null);
    setTimeout(() => emailInputRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (authStep !== "code") return;
    if (authCode.length !== OTP_LENGTH) {
      if (lastAutoSubmittedCode) setLastAutoSubmittedCode(null);
      return;
    }
    if (authBusy !== null) return;
    if (lastAutoSubmittedCode === authCode) return;
    setLastAutoSubmittedCode(authCode);
    void confirmEmailCode();
  }, [authStep, authCode, authBusy, lastAutoSubmittedCode]);

  if (!ready) {
    return <AuthValidationSplash />;
  }

  if (!authenticated) {
    const showWelcomeStep = authStep === "welcome";
    const showCodeStep = authStep === "code";

    return (
      <main className="relative min-h-screen w-full overflow-hidden bg-black text-center text-white">
        <div className="absolute inset-0 bg-background" />

        <div className="relative z-10 min-h-screen px-6 mx-auto w-full max-w-md flex flex-col items-center justify-center">
          <AuthBrandLockup />
        </div>

        <div className="fixed bottom-0 inset-x-0 z-20 p-5 pb-8">
          <div className="mx-auto w-full max-w-md">
            {showWelcomeStep && (
              <Button
                className="w-full bg-white text-black shadow-[0_10px_40px_rgba(0,0,0,0.35)]"
                onClick={() => {
                  setAuthStep("email");
                  setAuthError(null);
                }}
              >
                Log in / Sign up
              </Button>
            )}
            <p className="text-xs text-white/20 mt-3 py-4">2025 © tab tech</p>
          </div>
        </div>

        <ResponsiveDialog
          open={!showWelcomeStep}
          onOpenChange={(open) => {
            if (open) return;
            setAuthStep("welcome");
            setAuthError(null);
            setLastAutoSubmittedCode(null);
          }}
        >
          <ResponsiveDialogContent className="p-4 md:w-full md:max-w-md max-h-[calc(100dvh-110px)] md:max-h-[85vh] overflow-hidden [&>svg]:hidden">
            <div className="rounded-t-3xl md:rounded-2xl bg-background p-4 md:p-5 flex flex-col gap-5 max-h-[calc(100dvh-140px)] md:max-h-[calc(85vh-2rem)] overflow-y-auto">
              <ResponsiveDialogTitle className="sr-only">
                {showCodeStep ? "Verify email" : "Log in / Sign up"}
              </ResponsiveDialogTitle>

              {showCodeStep ? (
                <>
                  <div className="space-y-4">
                    <div className="h-1 w-full bg-white/15 rounded-full overflow-hidden">
                      <div className="h-full w-1/2 bg-primary" />
                    </div>

                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setAuthStep("email");
                          setAuthOtp(Array(OTP_LENGTH).fill(""));
                          setAuthError(null);
                          setLastAutoSubmittedCode(null);
                        }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/90 active:scale-95 transition"
                        aria-label="Back to email"
                      >
                        <ArrowLeft className="h-6 w-6" />
                      </button>
                      <div className="text-right">
                        <p className="text-sm text-white/60">Verify your email</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-white/80 text-sm">Enter the code we emailed to</p>
                        <p className="mt-1 text-white font-semibold text-lg break-all">
                          {authEmail.trim()}
                        </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-6 gap-2 sm:gap-3">
                    {authOtp.map((digit, index) => (
                      <input
                        key={index}
                        ref={(node) => {
                          otpInputRefs.current[index] = node;
                        }}
                        type="text"
                        inputMode="numeric"
                        autoComplete={index === 0 ? "one-time-code" : "off"}
                        pattern="[0-9]*"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => setOtpDigit(index, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Backspace" && !authOtp[index] && index > 0) {
                            otpInputRefs.current[index - 1]?.focus();
                          }
                          if (e.key === "ArrowLeft" && index > 0) {
                            otpInputRefs.current[index - 1]?.focus();
                          }
                          if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) {
                            otpInputRefs.current[index + 1]?.focus();
                          }
                          if (e.key === "Enter" && authCode.length === OTP_LENGTH) {
                            void confirmEmailCode();
                          }
                        }}
                        onPaste={(e) => {
                          const pasted = e.clipboardData.getData("text");
                          if (!pasted) return;
                          e.preventDefault();
                          fillOtpFromDigits(pasted);
                        }}
                        className="h-14 w-full rounded-2xl border border-white/20 bg-transparent text-center text-2xl font-semibold text-white outline-none focus:border-white"
                      />
                    ))}
                  </div>

                  <div className="flex items-center justify-center gap-2 sm:gap-3">
                    <button
                      type="button"
                      onClick={() => void pasteOtpFromClipboard()}
                      className="inline-flex h-11 items-center gap-2 rounded-full border border-white/20 px-4 text-white font-medium active:scale-95 transition"
                    >
                      <Clipboard className="h-4 w-4" />
                      Paste
                    </button>
                    <button
                      type="button"
                      disabled={resendSecondsLeft > 0 || authBusy !== null}
                      onClick={() => void startEmailLogin({ resend: true })}
                      className="inline-flex h-11 items-center rounded-full border border-white/20 px-4 text-white/90 font-medium disabled:text-white/35 disabled:border-white/10 disabled:cursor-not-allowed active:scale-95 transition"
                    >
                      {resendSecondsLeft > 0
                        ? `Resend (${resendSecondsLeft}s)`
                        : authBusy === "resend"
                          ? "Resending..."
                          : "Resend"}
                    </button>
                  </div>

                  <div className="min-h-6 text-center">
                    {authBusy === "verify" ? (
                      <Loader2 className="h-6 w-6 animate-spin text-white/80 mx-auto" />
                    ) : authError ? (
                      <p className="text-sm text-red-300/90">{authError}</p>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-white/50 text-sm text-left">
                    Enter your email to continue.
                  </p>

                  <div className="w-full space-y-3">
                    <input
                      ref={emailInputRef}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={authEmail}
                      onChange={(e) => {
                        setAuthEmail(e.target.value);
                        if (authError) setAuthError(null);
                      }}
                      placeholder="example@email.com"
                      className={clsx(
                        "w-full rounded-2xl border px-5 py-4 text-white text-lg placeholder:text-white/25 outline-none bg-white/5",
                        showInvalidEmailError
                          ? "border-red-400/80 focus:border-red-300"
                          : "border-white/15 focus:border-white/40"
                      )}
                    />

                    {showInvalidEmailError && (
                      <p className="text-sm text-red-300/90 text-left">{authError}</p>
                    )}

                    <Button
                      className={clsx(
                        "w-full bg-white text-black border",
                        showInvalidEmailError
                          ? "border-red-400/80"
                          : "border-transparent"
                      )}
                      disabled={!ready || authBusy !== null || !isAuthEmailValid}
                      onClick={() => void startEmailLogin()}
                    >
                      {authBusy === "send" ? "Sending code..." : "Continue"}
                    </Button>

                    {showEmailDomainSuggestions && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {emailDomainSuggestions.map((domain) => (
                          <button
                            key={domain}
                            type="button"
                            onClick={() => applyEmailDomainSuggestion(domain)}
                            className="rounded-full border border-white/15 bg-white text-black px-3 py-1.5 text-xs font-medium active:scale-95 transition"
                          >
                            {domain}
                          </button>
                        ))}
                      </div>
                    )}

                    {authError && !showInvalidEmailError && (
                      <p className="text-sm text-red-300/90 text-left">{authError}</p>
                    )}
                  </div>
                </>
              )}

              <p className="text-xs text-white/20 text-center pt-1">2025 © tab tech</p>
            </div>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </main>
    );
  }

  if (shouldShowFarcasterLinkStep) {
    return (
      <main className="relative min-h-screen w-full overflow-hidden bg-black text-center text-white">
        <div className="absolute inset-0 bg-background" />

        <div className="relative z-10 min-h-screen px-6 mx-auto w-full max-w-md flex flex-col items-center justify-center">
          <AuthBrandLockup />
        </div>

        <ResponsiveDialog open onOpenChange={() => {}}>
          <ResponsiveDialogContent className="p-4 md:w-full md:max-w-md max-h-[calc(100dvh-110px)] md:max-h-[85vh] overflow-hidden [&>svg]:hidden">
            <div className="rounded-t-3xl md:rounded-2xl bg-background p-4 md:p-5 flex flex-col gap-5 max-h-[calc(100dvh-140px)] md:max-h-[calc(85vh-2rem)] overflow-y-auto">
              <ResponsiveDialogTitle className="sr-only">
                Link your Farcaster
              </ResponsiveDialogTitle>

              <div className="text-left">
                <h2 className="text-lg font-semibold leading-tight">
                  Link your Farcaster
                </h2>
                <p className="mt-2 text-white/50 text-sm">
                  Farcaster is required to use Tab. Link your account to continue.
                </p>
              </div>

              {farcasterLinkError && (
                <p className="text-red-300/90 text-sm text-left">
                  {farcasterLinkError}
                </p>
              )}

              <Button
                className="w-full bg-primary text-black font-semibold"
                onClick={async () => {
                  setFarcasterLinkError(null);
                  try {
                    await Promise.resolve(linkFarcaster());
                  } catch (err) {
                    console.error("Failed to initialize Farcaster linking", err);
                    setFarcasterLinkError(
                      "Farcaster linking is not enabled for this app yet. Enable Farcaster in Privy Dashboard and try again."
                    );
                  }
                }}
              >
                Link Farcaster
              </Button>

              <p className="text-xs text-white/20 text-center">2025 © tab tech</p>
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
        <main className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(10rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
          <div className="w-full max-w-md space-y-8">
        {/* BALANCE CARD */}
        <div
          onClick={() => router.push("/profile")}
          className="w-full bg-white/5 rounded-xl p-3 text-left mt-2 cursor-pointer transition-colors"
        >
          <h2 className="ml-2 text-white font-2xl font-medium mb-2 flex items-center gap-1 mt-1">
            Portfolio
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

          {/* CONNECT WALLET */}
          {/* <Button
            onClick={(e) => {
              e.stopPropagation();
              connect({ connector: injected() });
            }}
            disabled={isConnecting}
            className="w-full bg-primary text-black font-semibold"
          >
            {isConnecting ? "Connecting…" : "Connect wallet"}
          </Button> */}

          <div className="grid grid-cols-2 gap-2 mt-3">
            {/* SEND */}
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

            {/* REQUEST */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                openReceiveDrawer();
                triggerClickHaptics();
              }}
              className={`bg-white/5 text-white  py-3 rounded-lg text-base font-semibold ${tap}`}
            >
              Request
            </button>

            {/* SPLIT */}
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

          <div className="text-xs text-yellow-400 text-center mt-4 mb-1">
            This is an early version of Tab v2
          </div>
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
                        setShowMorphoDrawer(true);
                      }}
                      className="flex-1 bg-white/5 rounded-xl px-4 py-3 text-left active:scale-95 transition"
                    >
                      <p className="text-sm text-white/40">Earning</p>
                      <p className="text-md text-white font-medium">
                        ${earnBalance!.toFixed(2)}
                        {typeof monthlyEarn === "number" && monthlyEarn > 0 && (
                          <span className="text-green-400 ml-1 whitespace-nowrap">
                            +${monthlyEarn.toFixed(2)}/mo
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

          <div className="flex gap-1 overflow-x-auto scrollbar-hide py-1 ml-1">
            {!hasFriends
              ? Array.from({ length: 6 }).map((_, i) => (
                  <FriendSkeleton key={i} />
                ))
              : friends.slice(0, 16).map((f) => (
                  <button
                    key={f.fid}
                    onClick={() => {
                      const user = {
                        fid: f.fid,
                        username: f.username,
                        display_name: f.display_name,
                        pfp_url: f.pfp_url,
                        verified_addresses: f.verified_addresses,
                      };

                      setQuery("");
                      setSelectedUser(user);
                      setSelectedToken("USDC");
                      setTokenType("USDC");

                      setTimeout(() => open(), 0);
                    }}
                    className="flex flex-col items-center w-[22%] min-w-[64px]"
                  >
                    <UserAvatar
                      src={f.pfp_url}
                      seed={f.username ?? f.fid}
                      width={56}
                      className="w-14 h-14 rounded-full object-cover"
                    />
                    <span className="text-xs text-white/70 mt-1 truncate max-w-[60px]">
                      @{f.username ?? "user"}
                    </span>
                  </button>
                ))}
          </div>
        </div>

        {/* FEATURE CARDS */}
        <div className="mt-6 space-y-3">
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

          {/* TAB AGENT */}
          <button
            onClick={() => router.push("/faq")}
            className="w-full flex items-center gap-3 bg-white/5 rounded-xl p-4 text-left active:scale-[0.98] transition"
          >
            <div className="w-10 h-10 rounded-full bg-blue-500/15 flex items-center justify-center">
              <Bot className="w-5 h-5 text-blue-400" />
            </div>

            <div>
              <p className="text-base font-medium text-white">
                Tab Agent <span className="text-blue-400"></span>
              </p>
              <p className="text-md text-white/40 mt-0.5">
                Split, pay and airdrop on Base chat
              </p>
            </div>
          </button>
        </div>

        {/* MORE WAYS TO USE TAB */}
        <div className="mt-6">
          <div className="text-lg ml-2 font-medium mb-2">
            More ways to use Tab
          </div>

          <div className="grid grid-cols-2 gap-1.5 mb-4">
            <button
              onClick={() => router.push("/table")}
              className={`hidden bg-white/5 rounded-xl px-2 py-3 text-left ${tap}`}
            >
              <div className="flex items-center gap-1">
                <img src="/vpush.png" className="w-9 h-9 rounded-md" />
                <span className="text-white text-md font-medium">
                  Spin the tab
                </span>
              </div>
            </button>

            <button
              onClick={() => router.push("/jackpot")}
              className={`bg-white/5 rounded-xl px-2 py-3 text-left ${tap}`}
            >
              <div className="flex items-center gap-1">
                <img src="/vticket.png" className="w-9 h-9 rounded-md" />
                <span className="text-white text-md font-medium">
                  $1M Jackpot
                </span>
              </div>
            </button>

          

            <button
              onClick={() => setShowMorphoDrawer(true)}
              className={`bg-white/5 rounded-xl px-2 py-3 text-left ${tap}`}
            >
              <div className="flex items-center gap-1">
                <img src="/vcash.png" className="w-9 h-9 rounded-md" />
                <span className="text-white text-md font-medium">
                  Earn USDC
                </span>
              </div>
            </button>
          </div>
        </div>
          </div>

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
