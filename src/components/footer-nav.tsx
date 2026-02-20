"use client";

import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Home, Bell, ScanLine } from "lucide-react";
import sdk from "@farcaster/frame-sdk";
import { useScanDrawer } from "@/providers/ScanDrawerProvider";
import Link from "next/link";

// Placeholder icon type-safe
const NoIcon = () => null;

export function FooterNav() {
  const pathname = usePathname();
  const { open: openScanDrawer } = useScanDrawer();

  const [pfpUrl, setPfpUrl] = useState<string | null>(null);
  const [seed, setSeed] = useState("anon");

  const [animateHome, setAnimateHome] = useState(false);
  const [animateScan, setAnimateScan] = useState(false);
  const [animateActivity, setAnimateActivity] = useState(false);
  const [animateProfile, setAnimateProfile] = useState(false);

  const handleAnimate = (setter: any) => {
    setter(true);
    setTimeout(() => setter(false), 300);
  };

  useEffect(() => {
    const load = async () => {
      const ctx = await sdk.context;
      const user = ctx?.user;

      setPfpUrl(user?.pfpUrl ?? null);
      setSeed(user?.username || `user-${ctx?.user?.fid ?? "anon"}`);
    };
    load();
  }, []);

  const triggerHaptics = async () => {
    try {
      await sdk.haptics.notificationOccurred("success");
    } catch {}
  };

  /* ------------------ NAV CONFIG ------------------ */

  const nav = [
    {
      href: "/",
      label: "Home",
      icon: Home,
      animate: animateHome,
      setAnimate: setAnimateHome,
    },
    {
      action: "scan",
      label: "Scan",
      icon: ScanLine,
      animate: animateScan,
      setAnimate: setAnimateScan,
    },
    {
      href: "/activity",
      label: "Activity",
      icon: Bell,
      animate: animateActivity,
      setAnimate: setAnimateActivity,
    },
    {
      href: "/profile",
      label: "Profile",
      icon: NoIcon,
      animate: animateProfile,
      setAnimate: setAnimateProfile,
    },
  ];

  /* ------------------ RENDER ------------------ */

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
      <div
        className="
      relative 
      mt-4 mx-auto
      w-[85%] max-w-md
      bg-gradient-to-b
      from-white/5

      via-white/0
      to-transparent 
      backdrop-blur-xl
      border border-white/10
      shadow-[0_4px_20px_rgba(0,0,0,0.4)]
      rounded-full 
      px-4 py-2
      flex items-center justify-between
      mb-10
    "
      >
        {nav.map((item, idx) => {
          const Icon = item.icon;
          const isActive = item.href && pathname === item.href;

          const pillClasses = clsx(
            "flex items-center justify-center",
            "h-11 w-20", // Proper Apple hit target
            "rounded-full transition", // Apple UI pill geometry
            isActive
              ? "bg-white/0 shadow-inner text-white"
              : "text-white/50"
          );

          /* ------------ SCAN BUTTON (MATCH OTHERS NOW) ------------ */
          if (item.action === "scan") {
            return (
              <button
                key="scan"
                className={pillClasses}
                onClick={async () => {
                  handleAnimate(item.setAnimate);
                  await triggerHaptics();
                  setTimeout(() => openScanDrawer(), 300);
                }}
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

          /* ------------ PROFILE IMAGE ICON ------------ */
          if (item.label === "Profile") {
            return (
              <Link
                key="profile"
                href="/profile"
                onClick={async () => {
                  handleAnimate(item.setAnimate);
                  await triggerHaptics();
                }}
                className={pillClasses}
              >
                {pfpUrl ? (
                  <img
                    src={pfpUrl}
                    className={clsx(
                      "w-7 h-7 rounded-full object-cover",
                      item.animate && "animate-scale-bounce"
                    )}
                  />
                ) : (
                  <img
                    src={`https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(
                      seed
                    )}`}
                    className="w-7 h-7 rounded-full"
                  />
                )}
              </Link>
            );
          }

          /* ------------ NORMAL NAV ITEMS ------------ */
          return item.href ? (
            <Link
              key={item.label}
              href={item.href}
              onClick={async () => {
                handleAnimate(item.setAnimate);
                await triggerHaptics();
              }}
              className={pillClasses}
            >
              <Icon
                className={clsx(
                  "w-6 h-6",
                  item.animate && "animate-scale-bounce"
                )}
              />
            </Link>
          ) : null;
        })}
      </div>
    </footer>
  );
}
