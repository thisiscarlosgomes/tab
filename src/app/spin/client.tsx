"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import confetti from "canvas-confetti";
import sdk from "@farcaster/frame-sdk";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import SpinGameGrid from "@/components/app/NewSpin";
import { useFrameSplash } from "@/providers/FrameSplashProvider";

type Reward = {
  label: string;
  type: string;
  amount: number;
};

export default function DailySpin() {
  const { dismiss } = useFrameSplash();
  const [fid, setFid] = useState<number | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [hasSpun, setHasSpun] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [canSpin, setCanSpin] = useState(true);
  const [nextEligibleSpinAt, setNextEligibleSpinAt] = useState<string | null>(
    null
  );
  const { address } = useAccount();
  const [showShare, setShowShare] = useState(false);
  const [isStatusLoading, setIsStatusLoading] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [streakHistory, setStreakHistory] = useState<
    { date: string; spun: boolean }[]
  >([]);

  const [spinMeta, setSpinMeta] = useState<{
    totalSpins: number;
    spinsToday: number;
    streak: number;
  } | null>(null);

  useEffect(() => {
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    const init = async () => {
      const context = await sdk.context;
      const username = context?.user?.username;
      if (!username) return;

      try {
        const res = await fetch(
          `/api/neynar/user/by-username?username=${username}`
        );
        const user = await res.json();
        const score = user?.experimental?.neynar_user_score ?? 0;

        if (score < 0) {
          toast.error("Need a Neynar score of 0.3+ to spin");
          setCanSpin(false);
          return;
        }

        setFid(user.fid);
        await fetchSpinStatus(user.fid);
        const streakRes = await fetch(`/api/spin-streak?fid=${user.fid}`);

        const streakData = await streakRes.json();
        setStreakHistory(streakData.history || []);
      } catch (err) {
        console.error("Failed to fetch user data", err);
        toast.error("Couldn't verify Neynar score.");
        setCanSpin(false);
      }
    };

    init();
  }, []);

  const fetchSpinStatus = async (
    fidToUse: number,
    skipResultUpdate = false
  ) => {
    try {
      setIsStatusLoading(true);
      const res = await fetch(`/api/daily-spindeleted?fid=${fidToUse}`);
      const data = await res.json();

      setCanSpin(data.canSpin);

      if (!skipResultUpdate) {
        setResult(data.latestResult?.reward ?? null);
        setHasSpun(!!data.latestResult?.reward);
      }

      setNextEligibleSpinAt(data.nextEligibleSpinAt ?? null);
      setSpinMeta({
        totalSpins: data.totalSpins,
        spinsToday: data.spinsToday,
        streak: data.streak,
      });
    } catch {
      setCanSpin(true);
    } finally {
      setIsStatusLoading(false);
    }
  };

  const handleSpinComplete = async (reward: Reward) => {
    setResult(reward.label);
    setHasSpun(true);
    setCanSpin(false);

    if (
      reward.label !== "Nothing" &&
      reward.label !== "Today's $tab pool is empty"
    ) {
      setShowShare(true);
      confetti({ particleCount: 400, spread: 120, origin: { y: 0.82 } });
    }

    if (fid !== null) {
      await fetchSpinStatus(fid, true);
    }
  };

  const handleShare = async () => {
    const fallbackUrl = `https://usetab.app/spin`;
    const shareText = result?.includes("Points")
      ? "💸 Just got some points on Daily Spin!"
      : `I just won ${result} on Daily Spin!`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Daily Spin",
          text: shareText,
          url: fallbackUrl,
        });
      } else {
        await sdk.actions.composeCast({
          text: `${shareText} Try your luck ↓`,
          embeds: [fallbackUrl],
        });
      }
    } catch (err) {
      console.warn("Share failed or cancelled", err);
    }
  };

  useEffect(() => {
    if (!nextEligibleSpinAt) return;
    const updateCountdown = () => {
      const diff = new Date(nextEligibleSpinAt).getTime() - Date.now();
      if (diff <= 0) {
        setCountdown(null);
        setCanSpin(true);
        return;
      }
      const hrs = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);
      setCountdown(
        `${hrs.toString().padStart(2, "0")}:${mins
          .toString()
          .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
      );
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [nextEligibleSpinAt]);

  useEffect(() => {
    return () => {
      setResult(null);
      setCountdown(null);
      setHasSpun(false);
      setShowShare(false);
      setCanSpin(false);
    };
  }, []);

  return (
    <div className="pt-20 pb-32 overflow-y-auto scrollbar-hide">
      {/* <div className="px-4 pb-12 space-y-3">
        <SpinGameGrid
          fid={fid}
          address={address ?? null}
          onResult={handleSpinComplete}
          canSpin={canSpin}
          countdown={countdown}
          hasSpun={hasSpun}
          streak={spinMeta?.streak ?? 0}
          streakHistory={streakHistory}
        />

        {showShare && result !== "Nothing" && (
          <Button onClick={handleShare} className="w-full mt-3 bg-white">
            🎊 Share to feed
          </Button>
        )}
      </div> */}
    </div>
  );
}
