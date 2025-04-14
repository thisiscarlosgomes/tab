"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import sdk from "@farcaster/frame-sdk";
import { ScanLine, Flame } from "lucide-react";
import { useScanDrawer } from "@/providers/ScanDrawerProvider";
import { DrawerCard } from "@/components/app/drawerCard";
import { DailySpinDrawer } from "@/components/app/DailySpinDrawer";

const PAGE_TITLES: Record<string, string> = {
  "/": "",
  "/activity": "Recent Activity",
  "/split/new": "New Split",
};

export function Header() {
  const { address } = useAccount();
  const pathname = usePathname();
  const [username, setUsername] = useState<string | null>(null);
  const { open: openScanDrawer } = useScanDrawer();
  const [points, setPoints] = useState<number | null>(null);
  const [shake, setShake] = useState(false);
  const [spinOpen, setSpinOpen] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setShake(true);
      setTimeout(() => setShake(false), 400); // match animation duration
    }, 5000); // every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const fetchPoints = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/points/${address}`);
      const data = await res.json();
      setPoints(data.points ?? 0);
    } catch {
      setPoints(0); // fallback
    }
  }, [address]);

  useEffect(() => {
    sdk.context.then((ctx) => setUsername(ctx.user?.username ?? null));
    fetchPoints();
  }, [fetchPoints]);

  useEffect(() => {
    fetchPoints();
    const interval = setInterval(fetchPoints, 100000); // every 10 seconds
    return () => clearInterval(interval);
  }, [fetchPoints]);

  const isProfile = pathname === "/profile";
  const pageTitle = isProfile
    ? username
      ? `gm @${username}`
      : "gm"
    : (PAGE_TITLES[pathname] ?? "");

  return (
    <header
      className={clsx(
        "fixed top-0 inset-x-0 bg-background z-10",
        "h-14 px-4 flex items-center justify-center pt-9 pb-8"
      )}
    >
      {/* Page Title */}
      <h1 className="hidden text-xl font-medium text-white">{pageTitle}</h1>

      {/* Left button (QR scanner) */}
      <div className="absolute left-4 top-6">
        <button onClick={openScanDrawer}>
          <ScanLine className="w-7 h-7 text-white/50 hover:text-primary" />
        </button>
      </div>

      {/* 🔥 Points drawer */}
      <div className="absolute right-4 top-6 flex items-center gap-3">
        <DrawerCard
          trigger={
            <div
              className={`flex items-center gap-1 text-primary hover:text-primary text-lg ${
                shake ? "animate-shake" : ""
              }`}
            >
              <Flame className="w-6 h-6" />
              <span>{points ?? 0}</span>
            </div>
          }
          title="Play to Earn. Literally."
          // description="Earn points by taking action across Tab"
        >
          <p>
            Spin. Send. Pay. Show up. Earn points. Win $TAB, instantly. Keep the streak alive.
          </p>
          <ul className="w-full mt-4 space-y-2">
            <li className="p-4 rounded-xl bg-yellow-100 text-yellow-800">
              Add & Share app +50
            </li>
            <li className="p-4 rounded-xl bg-green-100 text-green-800">
              In-app Payments +200 points
            </li>
            {/* <li className="p-4 rounded-xl bg-blue-100 text-blue-800">
              Joins & creates splits +150 points
            </li> */}
            <li className="p-4 rounded-xl bg-purple-100 text-purple-800">
              Wins spins +100 points
            </li>
            {/* <li className="p-4 rounded-xl bg-pink-100 text-pink-800">
              Top 10 of the week +500 points
            </li> */}
          </ul>
        </DrawerCard>
      </div>

      {/* 🎁 Daily Spin icon in center */}
      {/* <button
        onClick={() => setSpinOpen(true)}
        className="absolute top-6 left-1/2 -translate-x-1/2 text-white/50 hover:text-primary"
      >
       
        <img src="/money.gif" alt="points" className="w-8 h-8 rounded-md" />
      </button> */}

      <DailySpinDrawer isOpen={spinOpen} setIsOpen={setSpinOpen} />
    </header>
  );
}
