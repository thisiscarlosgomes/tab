"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import confetti from "canvas-confetti"; // ✅ import confetti
import { getShareUrl } from "@/lib/share";
import { toast } from "sonner";
import { shortAddress } from "@/lib/shortAddress";
import { useTabIdentity } from "@/lib/useTabIdentity";

type Drop = {
  dropId: string;
  groupId?: string; // 🆕
  token: string;
  amount: string;
  claimed: boolean;
  txHash?: string;
  claimedBy?: string;
  claimedByFid?: number; // 🆕
  creator: {
    name?: string;
    address: string;
  };
};

export default function ClaimPage() {
  const { dropId } = useParams();
  const { dismiss } = useFrameSplash();
  const searchParams = useSearchParams();
  const claimToken = searchParams.get("claimToken");
  const [copied, setCopied] = useState(false);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "claimed" | "error"
  >("idle");
  const [txHash, setTxHash] = useState<string | null>(null);

  // const [localClaimToken, setLocalClaimToken] = useState<string | null>(null);

  // useEffect(() => {
  //   if (!claimToken && dropId) {
  //     const local = localStorage.getItem(`claimToken:${dropId}`);
  //     if (local) {
  //       setLocalClaimToken(local);
  //     }
  //   }
  // }, [claimToken, dropId]);

  const { address, isConnected, fid } = useTabIdentity();
  const { login } = usePrivy();
  const [resolvedClaimUsername, setResolvedClaimUsername] = useState<
    string | null
  >(null);

  useEffect(() => {
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    const resolveUsername = async () => {
      if (drop?.claimedBy) {
        try {
          const res = await fetch(
            `/api/neynar/user/by-address/${drop.claimedBy.toLowerCase()}`
          );
          const data = await res.json();
          if (data?.username) {
            setResolvedClaimUsername(`@${data.username}`);
          } else {
            setResolvedClaimUsername(drop.claimedBy);
          }
        } catch {
          setResolvedClaimUsername(drop.claimedBy);
        }
      }
    };

    resolveUsername();
  }, [drop?.claimedBy]);

  useEffect(() => {
    const fetchDrop = async () => {
      const res = await fetch(`/api/drop/${dropId}`);
      const data = await res.json();
      if (!claimToken && data.drop?.claimToken) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}?claimToken=${data.drop.claimToken}`
        );
      }

      if (res.ok) setDrop(data.drop);
      else setStatus("error");
    };

    if (dropId) fetchDrop();
  }, [dropId]);

  const handleClaim = async () => {
    if (!address || !claimToken) return;

    setStatus("loading");

    const claimEndpoint = drop?.groupId
      ? `/api/drop/group/${drop.groupId}/claim`
      : `/api/drop/${dropId}/claim`;

    const res = await fetch(claimEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, claimToken, fid }),
    });

    // const res = await fetch(`/api/drop/${dropId}/claim`, {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify({ address, claimToken }),
    // });

    const result = await res.json();

    if (res.ok && result.success) {
      setStatus("claimed");
      setTxHash(result.txHash);
      confetti({ particleCount: 400, spread: 120, origin: { y: 0.6 } });
    } else {
      setStatus("error");
    }
  };

  const handleShare = async () => {
    const text = `Thanks @${drop?.creator?.name || "someone"} for the ${drop?.amount} ${drop?.token}!`;
    try {
      if (navigator.share) {
        await navigator.share({ text, url: window.location.href });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${window.location.href}`);
      toast.success("Share text copied");
    } catch {
      toast.error("Unable to share");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      {!drop && status === "idle" && (
        <p className="text-white opacity-30">Loading claim link...</p>
      )}

      {drop && (
        <div className="max-w-sm w-full mx-auto space-y-3">
          <h1 className="text-white text-xl font-semibold mb-4">
            {isConnected &&
            address?.toLowerCase() === drop.creator.address.toLowerCase() ? (
              <>
                You created a {drop.amount} {drop.token} cash link
              </>
            ) : (
              <>
                <span className="text-primary">
                  @{drop.creator?.name || "Someone"}
                </span>{" "}
                sent you {drop.amount} {drop.token}
              </>
            )}
          </h1>

          <div className="rounded-xl p-[2px] bg-gradient-to-br from-violet-400/90 via-purple-500/60 to-fuchsia-500/30 mt-2">
            <div className="bg-background rounded-xl p-6 flex flex-col items-center">
              <div className="text-5xl font-medium text-primary mb-1">
                ${drop.amount}
              </div>
              <p className="text-white text-sm opacity-30">
                {drop.amount} {drop.token}
              </p>
            </div>
          </div>

          {drop.txHash && (
            <Button
              variant="ghost"
              className="w-full mb-2 text-primary"
              onClick={() =>
                window.open(`https://basescan.org/tx/${drop.txHash}`, "_blank")
              }
            >
              Claimed by{" "}
              {resolvedClaimUsername ?? shortAddress(drop.claimedBy ?? "")}.
              View tx ↗
            </Button>
          )}

          {/* ✅ Hide claim button if already claimed or after success */}
          {drop.claimed || status === "claimed" ? (
            <p className="hidden text-primary text-base mt-2 ">
              This cash link has been claimed by
            </p>
          ) : !isConnected ? (
            <Button
              onClick={() => login()}
              className="w-full"
            >
              Continue with email
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

          {isConnected &&
            address?.toLowerCase() === drop.creator.address.toLowerCase() &&
            claimToken && (
              <>
                <Button
                  className="w-full bg-white"
                  onClick={async () => {
                    const fullUrl = `${window.location.origin}/claim/${drop.dropId}?claimToken=${claimToken}`;
                    await navigator.clipboard.writeText(fullUrl);
                    setCopied(true);
                    toast.success("Link copied to clipboard!");
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "Copied!" : "Copy Claim link!"}
                </Button>
                <p className="text-white/30 text-xs mt-2 px-6">
                  Anyone with the link can claim the funds. The claim token
                  stays on this device, so you'll need to view it here to access
                  it.
                </p>
              </>
            )}
        </div>
      )}

      {/* ✅ Show TX info if just claimed */}
      {status === "claimed" && txHash && (
        <div className="mt-6 text-white flex flex-col items-center space-y-2">
          <h2 className="text-green-400 text-xl font-semibold mb-2">
            Successfully Claimed 🎉
          </h2>

          <Button className="w-full bg-white mt-2" onClick={handleShare}>
            Share to Feed
          </Button>

          <Button
            variant="ghost"
            onClick={() => window.open(`https://basescan.org/tx/${txHash}`, "_blank")}
          >
            View on BaseScan
          </Button>
        </div>
      )}
      {status === "error" && (
        <p className="text-red-500 mt-4">
          {drop?.groupId
            ? "You’ve already claimed a reward from this group."
            : "Invalid or already claimed."}
        </p>
      )}
    </div>
  );
}
