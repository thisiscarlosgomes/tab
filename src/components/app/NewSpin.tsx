"use client";

import { useEffect, useState, useRef } from "react";
import clsx from "clsx";
import { SuccessShareDrawer } from "@/components/app/SuccessShareDrawer";
import { Loader } from "lucide-react";
import sdk from "@farcaster/frame-sdk";

type Reward = {
  label: string;
  type: string;
  amount: number;
};

export default function SpinGameGrid({
  fid,
  address,
  onResult,
  canSpin,
  countdown,
  hasSpun,
  streak,
  streakHistory,
}: {
  fid: number | null;
  address: string | null;
  onResult?: (reward: Reward) => void;
  canSpin: boolean;
  countdown?: string | null;
  hasSpun: boolean;
  streak: number;
  streakHistory: { date: string; spun: boolean }[];
}) {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [finalIndex, setFinalIndex] = useState<number | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [recentReward, setRecentReward] = useState<Reward | null>(null);
  const [loading, setLoading] = useState(true);

  const spinOrder = [0, 1, 2, 5, 8, 7, 6, 3];
  const STREAK_REWARDS = [50, 80, 120, 150, 200];
  const spinAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    spinAudioRef.current = new Audio("/sounds/spin.mp3");
    spinAudioRef.current.loop = true;
  }, []);

  useEffect(() => {
    const loadRewardsAndResult = async () => {
      setLoading(true);
      const res = await fetch("/api/daily-spin-rewards");
      const rewardsData = await res.json();
      setRewards(rewardsData);

      if (fid && hasSpun) {
        const resultRes = await fetch(`/api/daily-spin?fid=${fid}`);
        const resultData = await resultRes.json();
        const latestLabel = resultData?.latestResult?.reward;
        const idx = rewardsData.findIndex(
          (r: Reward) => r.label === latestLabel
        );
        if (idx !== -1) setFinalIndex(idx);
      }

      setLoading(false);
    };

    loadRewardsAndResult();
  }, [fid, canSpin]);

  const spin = async () => {
    if (spinning || rewards.length !== 9 || !fid) return;

    if (spinAudioRef.current) {
      spinAudioRef.current
        .play()
        .catch((err) => console.warn("Spin audio play failed", err));
    }

    try {
      await sdk.haptics.notificationOccurred("success");
    } catch (err) {
      console.warn("Haptics not supported", err);
    }

    setSpinning(true);
    setFinalIndex(null);

    const res = await fetch("/api/daily-spindeleted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fid, address }),
    });

    const data = await res.json();
    const reward: Reward = data.reward;
    const winningLabel = reward?.label;
    const winningIndex = rewards.findIndex((r) => r.label === winningLabel);

    const totalSpins = 30 + Math.floor(Math.random() * 10);

    const spinLoop = async () => {
      let current = 0;

      while (current < totalSpins) {
        const idx = spinOrder[current % spinOrder.length];
        setActiveIndex(idx);
        current++;

        const delay = 50 + Math.min(300, current * 8);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      setFinalIndex(winningIndex);
      setActiveIndex(null);
      setSpinning(false);
      if (spinAudioRef.current) {
        spinAudioRef.current.pause();
        spinAudioRef.current.currentTime = 0;
      }

      try {
        if (reward.type === "erc20") {
          await sdk.haptics.notificationOccurred("success");
        } else {
          await sdk.haptics.notificationOccurred("error");
        }
      } catch (err) {
        console.warn("Haptics error", err);
      }

      // ✅ Removed points assignment here

      setRecentReward(reward);
      setShowSuccess(true);
      if (onResult) onResult(reward);
    };

    await spinLoop();
  };

  return (
    <>
      <div className="flex items-center justify-center w-full relative">
        <div className="max-w-sm p-2 rounded-[36px] border-4 border-violet-500 w-full min-w-screen bg-gradient-to-br from-violet-800 via-violet-800 to-violet-800 relative z-10 min-h-[360px]">
          {[
            { top: "top-4", left: "left-6", size: "w-10 h-10" },
            { top: "top-[35%]", right: "right-4", size: "w-8 h-8" },
            { bottom: "bottom-10", left: "left-[20%]", size: "w-10 h-10" },
            {
              bottom: "bottom-[30%]",
              right: "right-[22%]",
              src: "/ship.gif",
              size: "w-9 h-9",
            },
            {
              top: "top-[50%]",
              left: "left-[55%]",
              src: "/money.gif",
              size: "w-12 h-12",
            },
            { bottom: "bottom-4", right: "right-8", size: "w-11 h-11" },
          ].map((style, i) => (
            <img
              key={i}
              src={style.src || "/coin.png"}
              alt="coin"
              className={clsx(
                "absolute opacity-20 blur-sm rotate-[30deg] pointer-events-none",
                style.top,
                style.bottom,
                style.left,
                style.right,
                style.size
              )}
            />
          ))}

          <div className="min-h-[340px] p-[4px] rounded-[36px] bg-gradient-to-br from-violet-400 via-violet-700 to-violet-400">
            {loading ? (
              <div className="flex items-center justify-center min-h-[340px]">
                <Loader className="w-8 h-8 text-white animate-spin opacity-60" />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 p-3 rounded-[36px]">
                {rewards.map((reward, i) => {
                  if (i === 4) {
                    return (
                      <>
                        {!canSpin ? (
                          <div
                            key={i}
                            className="text-black/60 text-center text-sm bg-gradient-to-br from-violet-800 via-violet-600 to-violet-800 border-[4px] border-violet-500 shadow-2xl col-span-1 row-span-1 rounded-full w-full aspect-square flex items-center justify-center font-bold text-[13px] leading-none"
                          >
                            {countdown ? (
                              <span>
                                Spin in <br />
                                {countdown}
                              </span>
                            ) : hasSpun ? (
                              <span>
                                Limit <br />
                                reached
                              </span>
                            ) : (
                              <span>
                                Min 0.3 <br />
                                score
                              </span>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={spin}
                            disabled={!fid || !address || spinning}
                            className={clsx(
                              "shadow-2xl text-white col-span-1 row-span-1 rounded-full w-full aspect-square flex items-center justify-center font-bold text-[13px] leading-tight",
                              "text-base uppercase bg-gradient-to-b from-violet-100 via-violet-500 to-violet-800 border-[6px] border-violet-500",
                              !fid || !address || spinning
                                ? "opacity-30 cursor-not-allowed"
                                : "hover:brightness-105"
                            )}
                          >
                            Spin!
                          </button>
                        )}
                      </>
                    );
                  }

                  const isActive = i === activeIndex;
                  const isFinal = i === finalIndex;

                  return (
                    <div
                      key={i}
                      className={clsx(
                        "aspect-square flex flex-col items-center justify-center rounded-xl bg-white/30 background-blur-lg shadow-lg text-[13px] font-semibold text-[#1a1a1a]",
                        isFinal
                          ? "border-4 border-yellow-400 bg-white/90"
                          : isActive
                            ? "border-4 border-white/70"
                            : ""
                      )}
                    >
                      <img
                        src={
                          reward.type === "none"
                            ? "/tab0.png"
                            : reward.amount === 10000 || reward.amount === 1000
                              ? "/tab2.png"
                              : "/tab3.png"
                        }
                        alt="coin"
                        className={clsx(
                          "w-14 h-14",
                          reward.type === "none" ? "saturate-0" : ""
                        )}
                      />
                      {reward.label}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="text-left p-3 bg-card border-2 border-muted/80 rounded-[24px]">
        <p className="mb-4 hidden">Daily Streak Points</p>
        <div className="grid grid-cols-5 gap-2 w-full text-center">
          {STREAK_REWARDS.map((points, i) => {
            const day = i + 1;
            const spun = streakHistory?.[i]?.spun;
            const isToday = day === streak;

            return (
              <div
                key={day}
                className={clsx(
                  "rounded-[20px] py-2 flex flex-col items-center justify-center border-2",
                  spun
                    ? "bg-yellow-100 border-yellow-400"
                    : "bg-card border-muted/80",
                  isToday && spun && "ring-2 ring-yellow-500"
                )}
              >
                <span className="text-xs text-muted">Day {day}</span>
                <img src="/tab2.png" className="w-9 h-9" />
                <span className="text-xs font-bold text-orange-500">
                  +{points}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-center ml-1 italic text-xs mt-3 opacity-30">
          Spin to earn $tab. Sent instantly to your wallet.
          <br />
          Longer streak. More points.
        </p>
      </div>

      <SuccessShareDrawer
        isOpen={showSuccess}
        setIsOpen={setShowSuccess}
        title={
          recentReward?.type === "erc20"
            ? `You won ${recentReward.amount} $tab!`
            : "Try again!"
        }
        shareText={
          recentReward?.type === "erc20"
            ? `Spun the wheel, got ${recentReward.amount} $tab. Let’s see what you get 🎊.`
            : `Spun the wheel for daily rewards — come try yours!`
        }
      />
    </>
  );
}
