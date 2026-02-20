"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import sdk from "@farcaster/frame-sdk";
import { Flame, Scan, Info, QrCode, ArrowLeft, ScanQrCode } from "lucide-react";
import { Drawer } from "vaul";
import { useScanDrawer } from "@/providers/ScanDrawerProvider";
import { DailySpinDrawer } from "@/components/app/DailySpinDrawer";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ReceiveDrawer } from "@/components/app/ReceiveDrawer";

const PAGE_TITLES: Record<string, string> = {
  "/": "",
  "/activity": "",
  "/split/new": "",
};

export function Header() {
  const router = useRouter();
  const { address } = useAccount();
  const pathname = usePathname();
  const showBackButton = pathname !== "/";
  const [username, setUsername] = useState<string | null>(null);
  const { open: openScanDrawer } = useScanDrawer();
  const [points, setPoints] = useState<number | null>(null);
  const [shake, setShake] = useState(false);
  const [spinOpen, setSpinOpen] = useState(false);

  const [showReceiveDrawer, setShowReceiveDrawer] = useState(false);

  // NEW
  const [aboutOpen, setAboutOpen] = useState(false);

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
    sdk.context.then((ctx) => setUsername(ctx.user?.username ?? null));
    fetchPoints();
  }, [fetchPoints]);

  useEffect(() => {
    fetchPoints();
    const interval = setInterval(fetchPoints, 100000);
    return () => clearInterval(interval);
  }, [fetchPoints]);

  const isProfile = pathname === "/";
  const pageTitle = isProfile ? (
    username ? (
      <span>
        gm <span>@{username}</span>
      </span>
    ) : (
      "gm"
    )
  ) : (
    (PAGE_TITLES[pathname] ?? "")
  );

  return (
    <>
      <header
        className={clsx(
          "fixed top-0 inset-x-0 bg-background z-10",
          "h-14 px-4 flex items-center justify-center pt-9 pb-8 z-10"
        )}
      >
        {/* Left side (title + back) */}
        <div className="absolute left-4 top-6 flex items-center gap-2">
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
              className="text-white text-lg flex items-center font-medium"
            >
              <ArrowLeft className="w-8 h-8" />
            </button>
          )}
        </div>

        {/* Center title */}
        <div className="absolute left-4 top-6 text-lg font-medium">
          {pageTitle}
        </div>

        {/* Right side — Points + NEW info button */}
        <div className="absolute right-4 top-6 flex items-center gap-5">
          {/* 🆕 QR Button */}
          <button
            onClick={() => setShowReceiveDrawer(true)}
            className="text-white hover:text-white transition"
          >
            <ScanQrCode className="w-6 h-6" />
          </button>

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

        <ReceiveDrawer
          isOpen={showReceiveDrawer}
          onOpenChange={setShowReceiveDrawer}
        />

        <DailySpinDrawer isOpen={spinOpen} setIsOpen={setSpinOpen} />
      </header>

      {/* 🆕 About Drawer */}
      <Drawer.Root open={aboutOpen} onOpenChange={setAboutOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-background rounded-t-3xl p-6 pb-14 z-40">
            <div className="w-12 h-1.5 bg-white/10 rounded-full mx-auto mb-4" />

            <h2 className="text-xl font-medium mb-4 text-center ml-2 mb-2">
              Welcome to tab
            </h2>

            <div className="space-y-2">
              <AboutRow
                img="/vpeople.png"
                title="Pay and Get paid"
                desc="Split bills. Send money. Request payments, all in seconds."
              />
              <AboutRow
                img="/vpush.png"
                title="Sping the tab"
                desc="Spin the wheel. One friend pays the whole bill."
              />

              <AboutRow
                img="/vcash.png"
                title="More ways to use Tab"
                desc="Earn yield, onchain jackpot, airdrop. Tools that turn your wallet into a supertool."
              />
            </div>

            <div className="mt-4 text-center text-white/30 text-sm">
              2025 © tab tech
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}

function AboutRow({
  img,
  title,
  desc,
}: {
  img: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-center gap-2 bg-white/5 p-3 rounded-xl">
      <img src={img} className="w-10 h-10 rounded-lg" />
      <div>
        <div className="text-white font-medium text-md">{title}</div>
        <div className="text-white/30 text-md leading-[1.2] mt-1">{desc}</div>
      </div>
    </div>
  );
}
