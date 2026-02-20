"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { Button } from "@/components/ui/button";
import sdk from "@farcaster/frame-sdk";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import { shortAddress } from "@/lib/shortAddress";

import { SuccessShareDrawer } from "@/components/app/SuccessShareDrawer";

export default function GroupClaimPage() {
  const { groupId } = useParams();
  const { dismiss } = useFrameSplash();
  const searchParams = useSearchParams();
  const claimToken = searchParams.get("claimToken");

  const { address, isConnected } = useAccount();
  const { connect } = useConnect();

  const [drops, setDrops] = useState<any[]>([]);
  const [resolvedClaimUsername, setResolvedClaimUsername] = useState<
    string | null
  >(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "claimed" | "error"
  >("idle");
  const [fid, setFid] = useState<number | null>(null);

  const [hasAlreadyClaimed, setHasAlreadyClaimed] = useState(false);

  const [showSuccessDrawer, setShowSuccessDrawer] = useState(false);

  useEffect(() => {
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    sdk.context.then((ctx) => {
      if (!ctx) {
        const currentUrl = window.location.href;
        window.location.href = `https://warpcast.com/?launchFrameUrl=${encodeURIComponent(currentUrl)}`;
      } else {
        setFid(ctx?.user?.fid ?? null);
      }
    });
  }, []);

  useEffect(() => {
    const fetchGroupDrops = async () => {
      const res = await fetch(`/api/drop/group/${groupId}`);
      const data = await res.json();
      setDrops(data.drops || []);

      if (fid) {
        const claimedByUser = data.drops.some(
          (d: any) => d.claimed && d.claimedByFid === fid
        );
        setHasAlreadyClaimed(claimedByUser);
      }
    };

    if (groupId) fetchGroupDrops();
  }, [groupId, fid]);

  const unclaimedDrop = drops.find((d) => !d.claimed);

  const handleClaim = async () => {
    if (!address || !groupId || fid == null) {
      toast.error("Still loading user info. Please try again in a moment.");
      return;
    }

    setStatus("loading");

    const res = await fetch(`/api/drop/group/${groupId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, fid }),
    });

    const result = await res.json();

    if (res.ok && result.success) {
      setStatus("claimed");
      setShowSuccessDrawer(true);
      setHasAlreadyClaimed(true);
      confetti({ particleCount: 400, spread: 120, origin: { y: 0.6 } });

      // ✅ Re-fetch updated drop data
      const refresh = await fetch(`/api/drop/group/${groupId}`);
      const freshData = await refresh.json();
      setDrops(freshData.drops || []);
    } else {
      if (res.status === 403) {
        toast.error("You’ve already claimed from this group.");
      }
      setStatus("error");
    }
  };

  const groupUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/claims/group/${groupId}`
      : "";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      {status === "idle" && drops.length === 0 && (
        <p className="text-white opacity-30">Loading group claim...</p>
      )}

      {unclaimedDrop && (
        <div className="max-w-sm w-full mx-auto space-y-3">
          <h1 className="text-white text-xl font-semibold mb-4">
            {!isConnected ? (
              <>Connect wallet to claim</>
            ) : address?.toLowerCase() ===
              unclaimedDrop.creator?.address?.toLowerCase() ? (
              <>
                You created a {unclaimedDrop.amount} {unclaimedDrop.token} cash
                link
              </>
            ) : (
              <>
                <span className="text-primary">
                  @{unclaimedDrop.creator?.name || "Someone"}
                </span>{" "}
                sent you {unclaimedDrop.amount} {unclaimedDrop.token} cash link
              </>
            )}
          </h1>

          <div className="rounded-xl p-[2px] bg-gradient-to-br from-violet-400/90 via-purple-500/60 to-fuchsia-500/30 mt-2">
            <div className="bg-background rounded-xl p-6 flex flex-col items-center">
              <div className="text-5xl font-medium text-primary mb-1">
                ${unclaimedDrop.amount}
              </div>
              <p className="text-white text-sm opacity-30 hidden">
                {unclaimedDrop.amount} {unclaimedDrop.token}
              </p>
              <p className="text-white/40 text-xs mt-2">
                Total available:{" "}
                {Number(
                  drops
                    .filter((d) => d.token === unclaimedDrop.token)
                    .reduce((acc, d) => acc + parseFloat(d.amount), 0)
                ).toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })}{" "}
                {unclaimedDrop.token}
              </p>
              <p className="text-white/40 text-xs">
                {
                  drops.filter(
                    (d) => d.token === unclaimedDrop.token && d.claimed
                  ).length
                }{" "}
                / {drops.filter((d) => d.token === unclaimedDrop.token).length}{" "}
                Claimed
              </p>
            </div>
          </div>

          {hasAlreadyClaimed ? (
            <p className="text-white/40 text-sm">
              You’ve already claimed from this drop.
            </p>
          ) : !isConnected ? (
            <Button
              onClick={() => connect({ connector: farcasterFrame() })}
              className="w-full"
            >
              Connect Wallet
            </Button>
          ) : (
            <Button
              disabled={status === "loading"}
              onClick={handleClaim}
              className="w-full"
            >
              {status === "loading" ? "Claiming..." : "Claim Now"}
            </Button>
          )}

          <p className="hidden text-white/30 text-xs mt-2 px-6">
            You can only claim this drop once.
          </p>
        </div>
      )}

      {status === "idle" &&
        drops.length > 0 &&
        fid !== null &&
        !unclaimedDrop &&
        hasAlreadyClaimed && (
          <div className="max-w-sm w-full mx-auto space-y-3 text-center">
            <h1 className="text-white text-xl font-semibold mb-4 px-6">
              You’ve already claimed from this group cash link.
            </h1>

            <div className="rounded-xl p-[2px] bg-gradient-to-br from-violet-400/90 via-purple-500/60 to-fuchsia-500/30 mt-2">
              <div className="bg-background rounded-xl p-6 flex flex-col items-center">
                <div className="text-5xl font-medium text-primary mb-1">
                  ${drops[0].amount}
                </div>
                <p className="text-white text-sm opacity-30 hidden">
                  {drops[0].amount} {drops[0].token}
                </p>
                <p className="text-white/40 text-xs mt-2">
                  Total available:{" "}
                  {Number(
                    drops
                      .filter((d) => d.token === drops[0].token)
                      .reduce((acc, d) => acc + parseFloat(d.amount), 0)
                  ).toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })}{" "}
                  {drops[0].token}
                </p>
                <p className="text-white/40 text-xs">
                  {
                    drops.filter((d) => d.token === drops[0].token && d.claimed)
                      .length
                  }{" "}
                  / {drops.filter((d) => d.token === drops[0].token).length}{" "}
                  Claimed
                </p>
              </div>
            </div>

            <p className="hidden text-white/40 text-sm mt-4">
              Thanks for claiming. Share this drop with others!
            </p>
          </div>
        )}

      {status === "idle" &&
        drops.length > 0 &&
        fid !== null &&
        !unclaimedDrop &&
        !hasAlreadyClaimed && (
          <div className="max-w-sm w-full mx-auto space-y-3 text-center">
            <h1 className="text-white text-xl font-semibold mb-4 px-6">
              All drops in this group have been claimed.
            </h1>

            <div className="rounded-xl p-[2px] bg-gradient-to-br from-violet-400/90 via-purple-500/60 to-fuchsia-500/30 mt-2">
              <div className="bg-background rounded-xl p-6 flex flex-col items-center">
                <div className="text-5xl font-medium text-primary mb-1">
                  ${drops[0].amount}
                </div>
                <p className="text-white text-sm opacity-30 hidden">
                  {drops[0].amount} {drops[0].token}
                </p>
                <p className="text-white/40 text-xs mt-2">
                  Total available:{" "}
                  {Number(
                    drops
                      .filter((d) => d.token === drops[0].token)
                      .reduce((acc, d) => acc + parseFloat(d.amount), 0)
                  ).toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })}{" "}
                  {drops[0].token}
                </p>
                <p className="text-white/40 text-xs">
                  {
                    drops.filter((d) => d.token === drops[0].token && d.claimed)
                      .length
                  }{" "}
                  / {drops.filter((d) => d.token === drops[0].token).length}{" "}
                  Claimed
                </p>
              </div>
            </div>

            <p className="text-white/40 text-sm mt-4">
              Stay tuned for future drops.
            </p>
          </div>
        )}

      {status === "claimed" && (
        <div className="mt-6 text-white flex flex-col items-center space-y-2">
          <h2 className="text-green-400 text-xl font-semibold mb-2">
            Successfully Claimed 🎉
          </h2>
        </div>
      )}

      <SuccessShareDrawer
        isOpen={showSuccessDrawer}
        setIsOpen={setShowSuccessDrawer}
        txHash={unclaimedDrop?.txHash ?? undefined} // ✅ safe fallback
        title="Successfully Claimed 🎉"
        shareText="Just claimed a cash link on Tab 💸"
        amount={Number(unclaimedDrop?.amount || drops[0]?.amount)}
        token={unclaimedDrop?.token || drops[0]?.token}
        extraNote="Share this moment with the feed"
        embeds={[`https://usetab.app/claims/group/${groupId}`]} // ✅ wrapped in array
      />

      {status === "error" && (
        <p className="text-red-500 mt-4">
          This reward was already claimed or invalid.
        </p>
      )}
    </div>
  );
}
