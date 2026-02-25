"use client";

import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Home, Bell, QrCode, CreditCard } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { useScanDrawer } from "@/providers/ScanDrawerProvider";
import Link from "next/link";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useTabIdentity } from "@/lib/useTabIdentity";

// Placeholder icon type-safe
const NoIcon = () => null;
const NOTIFICATIONS_LAST_SEEN_KEY_PREFIX = "tab:notifications:last-seen:";

function getNotificationsLastSeenKey(address: string) {
  return `${NOTIFICATIONS_LAST_SEEN_KEY_PREFIX}${address.toLowerCase()}`;
}

export function FooterNav({
  variant = "mobile",
  onDesktopScanAction,
}: {
  variant?: "mobile" | "desktop-inline";
  onDesktopScanAction?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { open: openScanDrawer } = useScanDrawer();
  const { pfp, username, fid, address } = useTabIdentity();
  const { user } = usePrivy();

  const [pfpUrl, setPfpUrl] = useState<string | null>(null);
  const [seed, setSeed] = useState("anon");

  const [animateHome, setAnimateHome] = useState(false);
  const [animateScan, setAnimateScan] = useState(false);
  const [animateActivity, setAnimateActivity] = useState(false);
  const [animateWallet, setAnimateWallet] = useState(false);
  const [animateProfile, setAnimateProfile] = useState(false);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);

  const handleAnimate = (setter: Dispatch<SetStateAction<boolean>>) => {
    setter(true);
    setTimeout(() => setter(false), 300);
  };

  useEffect(() => {
    const privyPfp =
      (user?.farcaster as { pfp?: string | null } | undefined)?.pfp ??
      (user?.linkedAccounts?.find(
        (account) => account.type === "farcaster"
      ) as { pfp?: string | null } | undefined)?.pfp ??
      null;
    setPfpUrl(pfp ?? privyPfp ?? null);
    setSeed(username || `user-${fid ?? "anon"}`);
  }, [pfp, username, fid, user]);

  const triggerHaptics = () => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(15);
    }
  };

  const prefetchHref = (href?: string) => {
    if (!href) return;
    router.prefetch(href);
  };

  const isDesktopInline = variant === "desktop-inline";

  /* ------------------ NAV CONFIG ------------------ */

  const navBase = [
    {
      href: "/",
      label: "Home",
      icon: Home,
      animate: animateHome,
      setAnimate: setAnimateHome,
    },
    ...(isDesktopInline
      ? [{
      action: "scan",
      label: "Scan",
      icon: QrCode,
      animate: animateScan,
      setAnimate: setAnimateScan,
    }]
      : []),
    {
      href: "/activity",
      label: "Activity",
      icon: Bell,
      animate: animateActivity,
      setAnimate: setAnimateActivity,
    },
  ];

  const mobileWalletItem = {
    href: "/wallet",
    label: "Wallet",
    icon: CreditCard,
    animate: animateWallet,
    setAnimate: setAnimateWallet,
  };

  const profileItem = {
    href: "/profile",
    label: "Profile",
    icon: NoIcon,
    animate: animateProfile,
    setAnimate: setAnimateProfile,
  };

  const nav = isDesktopInline
    ? [...navBase, mobileWalletItem, profileItem]
    : [...navBase, mobileWalletItem, profileItem];

  useEffect(() => {
    nav.forEach((item) => {
      if (item.href) {
        prefetchHref(item.href);
      }
    });
  }, [router]);

  useEffect(() => {
    if (!address) {
      setHasUnreadNotifications(false);
      return;
    }

    if (pathname === "/activity") {
      try {
        window.localStorage.setItem(
          getNotificationsLastSeenKey(address),
          new Date().toISOString()
        );
      } catch {}
      setHasUnreadNotifications(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const syncUnreadIndicator = async () => {
      try {
        const res = await fetch(
          `/api/activity?address=${encodeURIComponent(address)}&limit=1`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );
        if (!res.ok) return;

        const data = await res.json();
        const latest = Array.isArray(data?.activity) ? data.activity[0] : null;
        const latestTs = Date.parse(String(latest?.timestamp ?? ""));
        if (!Number.isFinite(latestTs)) {
          if (!cancelled) setHasUnreadNotifications(false);
          return;
        }

        let seenTs = 0;
        try {
          seenTs = Date.parse(
            window.localStorage.getItem(getNotificationsLastSeenKey(address)) ?? ""
          );
          if (!Number.isFinite(seenTs)) seenTs = 0;
        } catch {
          seenTs = 0;
        }

        if (!cancelled) {
          setHasUnreadNotifications(latestTs > seenTs);
        }
      } catch {
        // keep previous unread indicator on transient failures
      }
    };

    void syncUnreadIndicator();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [address, pathname]);

  /* ------------------ RENDER ------------------ */

  const renderNavBar = () => (
    <div
      className={clsx(
        "relative flex items-center",
        isDesktopInline
          ? "h-full w-full justify-center gap-8 px-0 bg-transparent border-0 backdrop-blur-none"
          : "w-full justify-between bg-background backdrop-blur-xl border-t border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.35)] px-3 pt-3 pb-3 mb-0"
      )}
    >
      {nav.map((item) => {
        const Icon = item.icon;
        const isActive = item.href && pathname === item.href;

        const pillClasses = clsx(
          "flex items-center justify-center rounded-full transition",
          isDesktopInline ? "h-11 w-16 rounded-2xl" : "h-11 flex-1",
          isDesktopInline
            ? (isActive
                ? "bg-white/5 border border-white/5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                : "text-white/50 hover:text-white/80")
            : (isActive ? "bg-white/5 text-white" : "text-white/50 hover:text-white/80")
        );

        if (item.action === "scan") {
          return (
            <button
              key="scan"
              className={pillClasses}
              onClick={() => {
                handleAnimate(item.setAnimate);
                triggerHaptics();
                if (isDesktopInline && onDesktopScanAction) {
                  onDesktopScanAction();
                  return;
                }
                setTimeout(() => openScanDrawer(), 300);
              }}
              aria-label={isDesktopInline ? "Open get paid QR" : "Open scanner"}
            >
            <Icon
              className={clsx(
                "w-6 h-6",
                item.animate && "animate-scale-bounce"
              )}
            />
          </button>
        );
      }

        if (item.label === "Profile") {
          return (
            <Link
              key="profile"
              href="/profile"
              prefetch
              onClick={() => {
                handleAnimate(item.setAnimate);
                triggerHaptics();
              }}
              onMouseEnter={() => prefetchHref("/profile")}
              onTouchStart={() => prefetchHref("/profile")}
              className={pillClasses}
            >
              <UserAvatar
                src={pfpUrl}
                seed={seed}
                width={28}
                className={clsx(
                  "w-7 h-7 rounded-full object-cover",
                  item.animate && "animate-scale-bounce"
                )}
              />
            </Link>
          );
        }

        return item.href ? (
          <Link
            key={item.label}
            href={item.href}
            prefetch
            onClick={() => {
              handleAnimate(item.setAnimate);
              triggerHaptics();
              if (item.label === "Activity" && address) {
                try {
                  window.localStorage.setItem(
                    getNotificationsLastSeenKey(address),
                    new Date().toISOString()
                  );
                } catch {}
                setHasUnreadNotifications(false);
              }
            }}
            onMouseEnter={() => prefetchHref(item.href)}
            onTouchStart={() => prefetchHref(item.href)}
            className={pillClasses}
          >
            <span className="relative inline-flex items-center justify-center">
              <Icon
                className={clsx(
                  "w-6 h-6",
                  item.animate && "animate-scale-bounce"
                )}
              />
              {item.label === "Activity" && hasUnreadNotifications ? (
                <span className="absolute -top-1.5 -right-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background" />
              ) : null}
            </span>
          </Link>
        ) : null;
      })}
    </div>
  );

  if (isDesktopInline) {
    return renderNavBar();
  }

  return (
    <footer className="fixed bottom-0 inset-x-0 z-20">
      {/* Apple-style gradient */}
      <div
        className="
      pointer-events-none
      absolute inset-0
    "
      />

      {/* Main navigation bar */}
      {renderNavBar()}
    </footer>
  );
}
