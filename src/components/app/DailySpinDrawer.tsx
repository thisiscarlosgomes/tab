"use client";

import { useState, useEffect } from "react";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import confetti from "canvas-confetti";
import sdk from "@farcaster/frame-sdk";
import { useAddPoints } from "@/lib/useAddPoints";
import { useAccount } from "wagmi";
import { getShareUrl } from "@/lib/share";
import { Loader } from "lucide-react";
import { toast } from "sonner";

export function DailySpinDrawer({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}) {
  const [fid, setFid] = useState<number | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [hasSpun, setHasSpun] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [canSpin, setCanSpin] = useState(true);
  const [nextEligibleSpinAt, setNextEligibleSpinAt] = useState<string | null>(
    null
  );
  const { address } = useAccount();
  const [showShare, setShowShare] = useState(false);
  const [isStatusLoading, setIsStatusLoading] = useState(false);

  const [spinMeta, setSpinMeta] = useState<{
    totalSpins: number;
    spinsToday: number;
    streak: number;
  } | null>(null);

  // useEffect(() => {
  //   const init = async () => {
  //     const context = await sdk.context;
  //     const userFid = context?.user?.fid ?? null;
  //     if (!userFid) return; // or setCanSpin(false)

  //     setFid(userFid);
  //     await fetchSpinStatus(userFid);
  //   };

  //   if (isOpen) init();
  // }, [isOpen]);

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
        if (score < 0.3) {
          toast.error("Need a Neynar score of 0.3+ to spin");
          setCanSpin(false);
          return;
        }

        setFid(user.fid);
        await fetchSpinStatus(user.fid);
      } catch (err) {
        console.error("Failed to fetch user data", err);
        toast.error("Couldn't verify Neynar score.");
        setCanSpin(false);
      }
    };

    if (isOpen) init();
  }, [isOpen]);

  const getRewardImage = (reward: string | null): string | null => {
    if (!reward) return null;
    if (reward.includes("$tab")) return "/boom.gif";
    if (reward.includes("Points")) return "/spark.gif";
    return "/ship.gif"; // fallback image (like for "Nothing today")
  };

  const fetchSpinStatus = async (
    fidToUse: number,
    skipResultUpdate = false
  ) => {
    try {
      setIsStatusLoading(true); // 🟢 start loading

      const res = await fetch(`/api/daily-spin?fid=${fidToUse}`);
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
      setCanSpin(true); // fallback
    } finally {
      setIsStatusLoading(false); // 🔴 end loading
    }
  };

  const handleSpin = async () => {
    setIsSpinning(true);
    setHasSpun(false);

    try {
      const res = await fetch("/api/daily-spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fid, address }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        if (errorData.limitReached) {
          setResult("Daily limit reached");
          setCanSpin(false);
          setHasSpun(true);
          return;
        }

        throw new Error("Spin failed");
      }

      const data = await res.json();

      setResult(data.reward?.reward ?? null);
      setHasSpun(true);
      setCanSpin(false);

      if (data.reward.type === "erc20" && address) {
        await useAddPoints(address, "daily_spin_win");
      }

      const rewardText = data.reward?.reward ?? "Nothing today";

      if (
        rewardText !== "Nothing today" &&
        rewardText !== "Today's pool is empty"
      ) {
        setShowShare(true);
        confetti({ particleCount: 400, spread: 120, origin: { y: 0.82 } });
      }
    } catch (e) {
      console.error("Spin failed", e);
    } finally {
      setIsSpinning(false);
      // ✅ Always refresh spin status
      if (fid !== null) {
        await fetchSpinStatus(fid, true);
      }
    }
  };

  const handleShare = async () => {
    const url = getShareUrl({
      name:
        result === "Tab Points +10"
          ? "Earned +10 Tab Points 🎉"
          : `I just won ${result} on Daily Spin!`,

      description: "Spin for rewards. ETH, Points, glory.",
    });
    sdk.actions.openUrl(url);

    if (address) {
      await useAddPoints(address, "share_frame");
    }
  };

  // ⏳ Countdown to next eligible spin
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
    if (!isOpen) {
      setResult(null);
      setCountdown(null);
      setHasSpun(false);
      setIsSpinning(false);
      setShowShare(false);
      setCanSpin(false); // ✅ this line is the fix
    }
  }, [isOpen]);

  const getCardStyle = (reward: string | null) => {
    if (!reward) return "";
    if (reward.includes("$tab"))
      return "bg-green-100 text-green-700 border-green-500";
    if (reward.includes("Points"))
      return "bg-green-100 text-green-800 border-green-300";
    return "bg-card text-white/20";
  };

  return (
    <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
      <Drawer.Portal>
        {/* <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20" />
        <Drawer.Content className="scroll-smooth z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background rounded-t-3xl flex flex-col">
           */}
        <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20" />
        <Drawer.Content className="pb-6 z-30 bg-background flex flex-col rounded-t-[32px] mt-24 h-fit fixed bottom-0 left-0 right-0 outline-none">
          <div className="mt-3 mx-auto w-10 h-1.5 rounded-full bg-white/10 mb-4" />

          <div className="px-6 mb-6">
            <h2 className="text-xl font-medium text-white">Daily Spin & Win</h2>
            <p className="text-white/50 text-base mt-4">
              100,000 $tab up for grabs daily. Spin up to 3x a day. Rewards drop
              straight to your wallet.
            </p>
            {spinMeta && (
              <p className="text-white/30 text-base mt-2">
                Streak: {spinMeta.streak} day{spinMeta.streak > 1 ? "s" : ""} •
                Total Spins: {spinMeta.totalSpins}
              </p>
            )}
          </div>

          {/* Spin Result */}
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <div
              className={`w-full p-6 rounded-xl border-2 shadow-md transition-all duration-200 ${
                result
                  ? getCardStyle(result)
                  : "bg-white/5 text-white/80 border-white/10"
              } ${isStatusLoading ? "opacity-50 animate-pulse" : ""}`}
            >
              {isStatusLoading ? (
                <p className="text-lg text-white/50">Checking status...</p>
              ) : hasSpun && result ? (
                <>
                  {result === "Nothing today" ? (
                    <p className="text-3xl font-bold text-white opacity-30">
                      {result}
                      <br /> Try again..
                    </p>
                  ) : (
                    <p className="text-2xl font-bold">
                      <span className="text-3xl flex items-center justify-center gap-2 mt-2">
                        <img
                          src={getRewardImage(result) ?? undefined}
                          alt={result ?? "Reward"}
                          className="w-8 h-8 rounded-md"
                        />
                        {result}
                        <img
                          src={getRewardImage(result) ?? undefined}
                          alt={result ?? "Reward"}
                          className="w-8 h-8 rounded-md"
                        />
                      </span>
                      {result?.includes("$tab") && (
                        <p className="text-sm mt-2 text-green-600">
                          Boom. It’s in your wallet.
                        </p>
                      )}

                      {result === "Today's $tab pool is empty" && (
                        <p className="text-sm mt-3 text-white/30">
                          All rewards are gone for today
                        </p>
                      )}
                    </p>
                  )}

                  {result === "Daily limit reached" && (
                    <p className="text-sm mt-3 text-white/30">
                      Daily limit reached, come back tomorrow!
                    </p>
                  )}
                </>
              ) : (
                <p className="text-lg font-medium">spin to try your luck 🎯</p>
              )}
            </div>
          </div>

          <div className="px-6 pb-6 space-y-2 mt-4">
            {showShare && result !== "Nothing today" && (
              <Button onClick={handleShare} className="w-full mt-3 bg-white">
                🎊 Share (Let 'em know)
              </Button>
            )}

            <Button
              onClick={handleSpin}
              disabled={isSpinning || !canSpin || isStatusLoading || !fid}
              className="w-full"
            >
              {isSpinning ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader className="w-6 h-6 animate-spin" />
                  Spinning...
                </div>
              ) : isStatusLoading ? (
                "Loading..."
              ) : !canSpin && !nextEligibleSpinAt && !hasSpun ? (
                "Score too low to spin"
              ) : !canSpin && nextEligibleSpinAt ? (
                `Spin again in ${countdown ?? "soon"}`
              ) : !canSpin && !nextEligibleSpinAt ? (
                "Daily limit reached"
              ) : (
                "Spin"
              )}
            </Button>
            {!canSpin && !hasSpun && !nextEligibleSpinAt && (
              <p className="text-sm text-white/50 text-center mt-2">
                Your Neynar score must be at least 0.3 to spin.
              </p>
            )}
          </div>
          <div className="pb-[env(safe-area-inset-bottom)]" />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
