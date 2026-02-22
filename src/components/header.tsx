"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAccount } from "wagmi";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  Flame,
  Info,
  ArrowLeft,
  Menu,
  LogOut,
} from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { DailySpinDrawer } from "@/components/app/DailySpinDrawer";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTabIdentity } from "@/lib/useTabIdentity";

import { ReceiveDrawer } from "@/components/app/ReceiveDrawer";
import { FooterNav } from "@/components/footer-nav";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

const PAGE_TITLES: Record<string, string> = {
  "/": "",
  "/activity": "",
  "/wallet": "Wallet",
  "/split/new": "",
};

const ABOUT_STEPS = [
  {
    icon: "👨‍👩‍👧",
    title: "Pay and Get paid",
    desc: "Split bills. Send money. Request payments, all in seconds.",
    accent: "from-lime-400 to-green-500",
  },
  {
    icon: "🔘",
    title: "Sping the tab",
    desc: "Spin the wheel. One friend pays the whole bill.",
    accent: "from-cyan-400 to-blue-500",
  },
  {
    icon: "💵",
    title: "More ways to use Tab",
    desc: "Earn yield, onchain jackpot, airdrop. Tools that turn your wallet into a supertool.",
    accent: "from-emerald-400 to-lime-500",
  },
] as const;

export function Header() {
  const router = useRouter();
  const { address } = useAccount();
  const { username } = useTabIdentity();
  const { logout, ready, authenticated } = usePrivy();
  const pathname = usePathname();
  const showBackButton = pathname !== "/";
  const [points, setPoints] = useState<number | null>(null);
  const [shake, setShake] = useState(false);
  const [spinOpen, setSpinOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [showReceiveDrawer, setShowReceiveDrawer] = useState(false);

  // NEW
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutStep, setAboutStep] = useState(0);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const desktopMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setShake(true);
      setTimeout(() => setShake(false), 400);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const fetchPoints = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/points/${address}`);
      const data = await res.json();
      setPoints(data.points ?? 0);
    } catch {
      setPoints(0);
    }
  }, [address]);

  useEffect(() => {
    void fetchPoints();
    const interval = setInterval(fetchPoints, 100000);
    return () => clearInterval(interval);
  }, [fetchPoints]);

  useEffect(() => {
    if (!desktopMenuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!desktopMenuRef.current) return;
      if (!desktopMenuRef.current.contains(event.target as Node)) {
        setDesktopMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDesktopMenuOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [desktopMenuOpen]);

  useEffect(() => {
    if (aboutOpen) setAboutStep(0);
  }, [aboutOpen]);

  const isProfile = pathname === "/";
  const pageTitle = isProfile ? (
    username ? <span>@{username}</span> : ""
  ) : (
    (PAGE_TITLES[pathname] ?? "")
  );

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      if (ready && authenticated) {
        await logout();
      }
      router.replace("/");
      router.refresh();
    } catch (error) {
      console.error("Header logout failed", error);
    } finally {
      setLoggingOut(false);
    }
  }, [authenticated, loggingOut, logout, ready, router]);

  const currentAboutStep = ABOUT_STEPS[aboutStep];

  return (
    <>
      <header
        className={clsx(
          "hidden md:block fixed top-0 inset-x-0 bg-background/95 backdrop-blur-xl border-b border-white/5 z-20",
          "pt-[env(safe-area-inset-top)]"
        )}
      >
        <div className="h-16 w-full px-6 flex items-center justify-between gap-4">
          <div className="relative z-10 min-w-0 flex items-center gap-3">
            <Link href="/" aria-label="Go to home">
              <img src="/app.png" alt="Tab" className="w-8 h-8 rounded-xl" />
            </Link>
            <div className="text-lg font-medium truncate">{pageTitle}</div>
          </div>

          <div className="absolute left-0 right-0 top-0 h-full flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto">
              <FooterNav
                variant="desktop-inline"
                onDesktopScanAction={() => setShowReceiveDrawer(true)}
              />
            </div>
          </div>

          <div className="relative z-10 flex items-center gap-2" ref={desktopMenuRef}>
            <button
              type="button"
              onClick={() => setDesktopMenuOpen((v) => !v)}
              className={clsx(
                "h-11 w-14 rounded-2xl flex items-center justify-center transition",
                desktopMenuOpen
                  ? "bg-white/5 border border-white/5 text-white"
                  : "text-white/80 hover:text-white"
              )}
              aria-label="Open menu"
              aria-expanded={desktopMenuOpen}
            >
              <Menu className="w-6 h-6" />
            </button>

            {desktopMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+12px)] w-64 rounded-2xl border border-white/10 bg-background/95 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    setDesktopMenuOpen(false);
                    setAboutOpen(true);
                  }}
                  className="w-full px-4 py-4 flex items-center justify-between text-left hover:bg-white/5 transition"
                >
                  <span className="text-white">About</span>
                  <Info className="w-5 h-5 text-white/80" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDesktopMenuOpen(false);
                    void handleLogout();
                  }}
                  disabled={loggingOut}
                  className="w-full px-4 py-4 flex items-center justify-between text-left hover:bg-white/5 transition border-t border-white/5 disabled:opacity-50"
                >
                  <span className="text-white">{loggingOut ? "Logging out..." : "Log out"}</span>
                  <LogOut className="w-5 h-5 text-white/80" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <header
        className={clsx(
          "md:hidden fixed top-0 inset-x-0 bg-background z-10",
          "pt-[env(safe-area-inset-top)]"
        )}
      >
        <div className="relative h-16 w-full max-w-md mx-auto px-4">
          {/* Left side (title + back) */}
          <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {!showBackButton && (
              <Link href="/" aria-label="Go to home" className="shrink-0">
                <img src="/app.png" alt="Tab" className="w-8 h-8" />
              </Link>
            )}
            {showBackButton && (
              <button
                onClick={() => {
                  // If user is inside Farcaster / WebView — no history
                  if (window.history.length <= 2) {
                    router.push("/");
                    return;
                  }

                  // Otherwise: normal back
                  router.back();
                }}
                className="text-white text-md flex items-center font-medium"
              >
                <ArrowLeft className="w-8 h-8" />
              </button>
            )}
          </div>

          {/* Center title */}
          <div className="absolute left-14 top-1/2 -translate-y-1/2 text-lg font-medium">
            {pageTitle}
          </div>

          {/* Right side — actions */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-4">
            {/* Info Button */}
            <button
              onClick={() => setAboutOpen(true)}
              className="text-white hover:text-white transition"
            >
              <Info className="w-6 h-6" />
            </button>

            {/* Points */}
            <div className="hidden flex items-center gap-1 text-white font-medium text-lg">
              <Flame className="w-6 h-6" />
              <span>{points ?? 0}</span>
            </div>
          </div>
        </div>

        <ReceiveDrawer
          isOpen={showReceiveDrawer}
          onOpenChange={setShowReceiveDrawer}
        />

        <DailySpinDrawer isOpen={spinOpen} setIsOpen={setSpinOpen} />

      </header>

      {/* 🆕 About Drawer */}
      <ResponsiveDialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <ResponsiveDialogContent className="p-0 md:w-full md:max-w-md overflow-hidden">
          <div className="relative bg-background px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:px-5 md:pb-5">
            <ResponsiveDialogTitle className="mt-6 text-center text-xl font-semibold tracking-tight">
              Welcome to tab
            </ResponsiveDialogTitle>

            <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  aria-hidden
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/5 text-2xl"
                >
                  {currentAboutStep.icon}
                </div>
                <div className="min-w-0">
                  <div className="text-white text-lg font-semibold leading-tight">
                    {currentAboutStep.title}
                  </div>
                  <div className="mt-1 text-xs text-white/40">
                    Step {aboutStep + 1} of {ABOUT_STEPS.length}
                  </div>
                </div>
              </div>

              <p className="mt-5 text-white/75 text-md leading-relaxed text-center md:text-left">
                {currentAboutStep.desc}
              </p>
            </div>

            <Button
              className="mt-8 w-full bg-primary text-black hover:bg-primary/90"
              onClick={() => {
                if (aboutStep < ABOUT_STEPS.length - 1) {
                  setAboutStep((prev) => prev + 1);
                  return;
                }
                setAboutOpen(false);
              }}
            >
              {aboutStep < ABOUT_STEPS.length - 1 ? "Next" : "Get started"}
            </Button>

            <div className="mt-4 text-center text-white/30 text-sm">
              2025 © tab tech
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
