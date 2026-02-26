"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import sdk from "@farcaster/frame-sdk";
import { NumericFormat } from "react-number-format";
import { useGame } from "@/hooks/useGame";
import { ParticipantList } from "@/components/app/participantList";
import { SpinButton } from "@/components/app/spinButton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PaymentTokenPickerDialog } from "@/components/app/PaymentTokenPickerDialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import { toast } from "sonner";
import { tokenList } from "@/lib/tokens";
import { useTabIdentity } from "@/lib/useTabIdentity";
import { Loader, Copy, CopyCheck, Share, Settings } from "lucide-react";

const getTokenPrefix = (token?: string) => {
  switch (token) {
    case "ETH":
    case "WETH":
      return "Ξ";
    case "EURC":
      return "€";
    case "USDC":
    default:
      return "$";
  }
};

export default function RoomPage() {
  const { dismiss } = useFrameSplash();
  const router = useRouter();
  const { address } = useAccount();
  const {
    address: identityAddress,
    username: identityUsername,
    pfp: identityPfp,
    fid: identityFid,
  } = useTabIdentity();
  const { roomId } = useParams();

  const safeRoomId = Array.isArray(roomId) ? roomId[0] : (roomId ?? "");

  const { game, isLoading, refresh } = useGame(safeRoomId);

  const participants = game?.participants ?? [];
  const invited = game?.invited ?? [];
  const chosen = game?.chosen ?? null;
  const amount = game?.amount ?? 0;

  const [amountInput, setAmountInput] = useState(0.01);
  const [adminOnlySpin, setAdminOnlySpin] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);

  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);
  const [tokenType, setTokenType] = useState<string>("USDC");
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [isSpinning, setIsSpinning] = useState(false);

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle"
  );

  const [closing, setClosing] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const viewerAddress = (address ?? identityAddress ?? "").toLowerCase();
  const hasJoined = participants.some((p) => {
    if (viewerAddress && p.address?.toLowerCase?.() === viewerAddress) return true;
    if (identityFid != null && p.fid != null && Number(p.fid) === Number(identityFid)) {
      return true;
    }
    return false;
  });

  const joinRoom = useCallback(async () => {
    if (!game || !viewerAddress) return;
    if (hasJoined) return;

    let ctx: Awaited<typeof sdk.context> | null = null;
    try {
      ctx = await sdk.context;
    } catch {
      ctx = null;
    }

    const player = {
      name: ctx?.user?.username ?? identityUsername ?? viewerAddress.slice(0, 6),
      address: viewerAddress,
      pfp: ctx?.user?.pfpUrl ?? identityPfp ?? undefined,
      fid: ctx?.user?.fid ?? identityFid ?? undefined,
    };

    const res = await fetch(`/api/game/${safeRoomId.toLowerCase()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player }),
    });

    if (!res.ok) throw new Error("Join failed");
    refresh();
  }, [
    game,
    viewerAddress,
    hasJoined,
    identityUsername,
    identityPfp,
    identityFid,
    safeRoomId,
    refresh,
  ]);

  const isAdmin =
    !!viewerAddress &&
    !!game?.admin &&
    game.admin.toLowerCase() === viewerAddress;

  const hasChosenPaid =
    !!chosen &&
    game?.paid?.some(
      (p) => p.address.toLowerCase() === chosen.address.toLowerCase()
    );

  const canCloseTab =
    !!chosen &&
    !!viewerAddress &&
    chosen.address.toLowerCase() === viewerAddress &&
    !hasChosenPaid;

  const copyUrl = `https://usetab.app/game/${game?.gameId}`;

  const [shakePay, setShakePay] = useState(false);

  useEffect(() => {
    if (chosen) {
      setIsSpinning(false);
    }
  }, [chosen?.address]);

  useEffect(() => {
    if (!chosen || hasChosenPaid || closing) return;

    const interval = setInterval(() => {
      setShakePay(true);
      setTimeout(() => setShakePay(false), 400);
    }, 3500);

    return () => clearInterval(interval);
  }, [chosen, hasChosenPaid, closing]);

  /* ----------------------------------
     AUTO JOIN (EPHEMERAL ROOM LOGIC)
  ---------------------------------- */
  useEffect(() => {
    if (!game || !viewerAddress) return;
    if (hasJoined) return;

    (async () => {
      try {
        await joinRoom();

        // ✅ HAPTIC (best effort)
        try {
          await sdk.haptics.impactOccurred("light");
        } catch {}

        // ✅ TOAST
        toast.success("You joined the tab 🍻");

        refresh();
      } catch (err) {
        console.error("Auto-join failed", err);
      }
    })();
  }, [game, viewerAddress, hasJoined, joinRoom]);

  useEffect(() => {
    dismiss();
  }, [dismiss]);

  const [isEditingSettings, setIsEditingSettings] = useState(false);

  useEffect(() => {
    if (!game || isEditingSettings) return;

    if (typeof game.amount === "number") setAmountInput(game.amount);
    if (typeof game.adminOnlySpin === "boolean")
      setAdminOnlySpin(game.adminOnlySpin);
  }, [game, isEditingSettings]);

  useEffect(() => {
    if (game?.spinToken && tokenType === "") {
      setTokenType(game.spinToken);
    }
  }, [game?.spinToken]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader className="w-8 h-8 animate-spin text-white/40" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center p-6 text-center">
        <img src="/vpush.png" className="w-14 h-14 opacity-60 mb-4" />
        <h1 className="text-lg font-semibold">This page was deleted</h1>
        <p className="text-sm text-white/40 mt-2">
          This group no longer exists.
        </p>

        <Button className="mt-6" onClick={() => router.push("/rooms")}>
          Go back
        </Button>
      </div>
    );
  }

  /* ----------------------------------
     SHARE / COPY
  ---------------------------------- */
  const handleShare = async () => {
    try {
      await sdk.actions.composeCast({
        text: `🎲 Spin the tab — ${participants.length} in, who’s paying?`,

        embeds: [copyUrl],
      });
    } catch (err) {
      console.warn("Feed share cancelled or failed", err);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(copyUrl);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 1500);
  };

  /* ----------------------------------
     NOTIFICATIONS
  ---------------------------------- */
  const notifyUser = async (fid: number) => {
    try {
      await fetch("/api/send-notif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fid, // number, as required by Farcaster
          title: "🎲 Spin the tab",
          message: "We’re spinning soon",
          targetUrl: copyUrl,
        }),
      });

      toast.success("Notification sent");
    } catch {
      toast.error("Failed to notify");
    }
  };

  const paidAddresses = game?.paid?.map((p) => p.address.toLowerCase()) ?? [];
  const pendingInvites = invited.filter((invitedUser) => {
    const invitedAddress = invitedUser.address?.toLowerCase?.() ?? null;
    return !participants.some((p) => {
      if (
        invitedUser.fid != null &&
        p.fid != null &&
        Number(invitedUser.fid) === Number(p.fid)
      ) {
        return true;
      }
      return Boolean(
        invitedAddress &&
          p.address?.toLowerCase?.() &&
          p.address.toLowerCase() === invitedAddress
      );
    });
  });

  const isYou =
    !!viewerAddress &&
    !!chosen &&
    chosen.address.toLowerCase() === viewerAddress;

  const state = !chosen ? "waiting" : hasChosenPaid ? "settled" : "result";

  return (
    <div className="min-h-screen w-full flex flex-col items-center px-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(12rem+env(safe-area-inset-bottom))] overflow-y-auto">
      <Card className="w-full max-w-md p-4 space-y-3">
        {/* HEADER */}
        <div className="flex flex-col items-center">
      
          <h1 className="text-xl font-semibold">
            {game?.name?.trim() || "Spin tab"}
          </h1>
          <p
            className={`
    text-sm font-medium
    ${
      state === "waiting"
        ? "text-white/50"
        : state === "result"
          ? "text-primary"
          : "text-green-400"
    }
  `}
          >
            {state === "waiting" && "Waiting for the spin"}
            {state === "result" && "The tab has been decided"}
            {state === "settled" && "This tab is settled"}
          </p>
        </div>

        {/* AMOUNT */}
        <div className="rounded-xl bg-white/[3%] p-4 text-center">
          <p className="text-xs  tracking-wide text-white/40 mb-1">Total tab</p>
          <div className="text-3xl font-semibold">
            {getTokenPrefix(game.spinToken)}
            {amount}
          </div>
        </div>

        {/* PARTICIPANTS */}
        <ParticipantList
          participants={participants}
          invitedParticipants={pendingInvites}
          adminAddress={game.admin}
          isAdmin={isAdmin}
          onNotify={notifyUser}
          paidAddresses={paidAddresses} // ✅
        />

        {/* PRIMARY ACTION */}
        {isAdmin ? (
          <>
            <div className="flex gap-2 mt-3 items-stretch">
              {/* PRIMARY ACTION */}
              <div className="flex-1">
                <SpinButton
                  participants={participants}
                  roomId={safeRoomId}
                  onPick={() => {
                    setIsSpinning(false);
                    refresh();
                  }}
                  onSpinStart={() => setIsSpinning(true)}
                  userAddress={address}
                  canSpin={!chosen && !closing}
                  adminOnly={game.adminOnlySpin}
                  isAdmin={isAdmin}
                  isSpinning={isSpinning}
                  /* 👇 ensure same height */
                  className="h-[56px]"
                />
              </div>

              {/* SECONDARY ACTION */}

              {!canCloseTab && (
                <>
                  <Button
                    onClick={() => setShowDrawer(true)}
                    variant="secondary"
                    className="h-[56px] w-[56px] p-0 flex items-center justify-center"
                    aria-label="Settings"
                  >
                    <Settings className="w-5 h-5" />
                  </Button>

                  <Button
                    onClick={handleCopy}
                    variant="secondary"
                    className="h-[56px] w-[56px] p-0 flex items-center justify-center"
                    aria-label="Settings"
                  >
                    <Copy className="h-5 w-5" />
                  </Button>
                </>
              )}
            </div>
          </>
        ) : !hasJoined ? (
          <Button
            onClick={async () => {
              try {
                await joinRoom();
                toast.success("You joined the tab 🍻");
              } catch {
                toast.error("Failed to join");
              }
            }}
            className="w-full bg-primary text-black"
          >
            Join group
          </Button>
        ) : (
          <Button onClick={handleShare} className="w-full bg-white text-black">
            <Share className="mr-2 h-4 w-4" />
            Share to feed
          </Button>
        )}

        {!chosen && (
          <p className="text-sm w-full text-center text-white/50">
            Admin spins when everyone’s ready
          </p>
        )}

        {/* RESULT */}
        {chosen && (
          <div className="text-center space-y-2">
            {canCloseTab && (
              <Button
                disabled={isSpinning || closing}
                className={[
                  "w-full bg-primary text-black",
                  shakePay && !isSpinning ? "animate-shake" : "",
                ].join(" ")}
                onClick={async () => {
                  try {
                    setClosing(true);
                    await fetch(`/api/game/${safeRoomId.toLowerCase()}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        address,
                        closeTab: true,
                      }),
                    });

                    toast.success("Tab closed");
                    refresh();
                  } catch {
                    toast.error("Failed to close tab");
                  }
                }}
              >
                {closing ? "Closing…" : "Mark as paid"}
              </Button>
            )}

            {hasChosenPaid ? (
              <h2 className="text-green-400 font-semibold">
                ✅{" "}
                {isYou
                  ? "You covered the tab"
                  : `@${chosen.name} covered the tab`}
              </h2>
            ) : (
              <>
                <h2 className="text-lg font-semibold mt-3">
                  {isYou ? "You got the tab 🍻" : `@${chosen.name} got the tab`}
                </h2>
                <span className="text-sm text-white/50">
                  Covers the full amount for everyone
                </span>
              </>
            )}

            <p className="hidden text-sm text-muted text-center mt-2">
              Only the tab creator can spin
            </p>
          </div>
        )}
      </Card>

      <div className="hidden w-full mt-3 max-w-md rounded-[16px] bg-card p-4 text-left">
        <button
          onClick={() => setShowHowItWorks(!showHowItWorks)}
          className="w-full flex items-center justify-between text-white/40"
        >
          <span className="text-md ml-2">How it works</span>
          <span className="hidden text-white/60">
            {showHowItWorks ? "−" : "+"}
          </span>
        </button>

        {showHowItWorks && (
          <div className="mt-2 space-y-1 text-white/50 text-sm">
            <p>• Everyone joins the group</p>
            <p>• One spin randomly picks who pays</p>
            <p>• The chosen person covers the full tab</p>
          </div>
        )}
      </div>

      <ResponsiveDialog
        open={Boolean(isAdmin && showDrawer)}
        onOpenChange={(open) => setShowDrawer(open)}
        repositionInputs={false}
      >
        <ResponsiveDialogContent className="top-auto bottom-0 p-4 pb-6 md:top-1/2 md:bottom-auto md:-translate-y-1/2 md:max-w-md">
          <ResponsiveDialogTitle className="text-lg font-normal text-center">
            Group Settings
          </ResponsiveDialogTitle>

          <div className="mt-4 space-y-4">
            <div className="max-w-md mx-auto space-y-3">
                <div className="flex flex-col space-y-2">
                  <button
                    onClick={() => setTokenDrawerOpen(true)}
                    className="w-full flex items-center justify-between p-4 rounded-lg bg-white/5"
                  >
                    <span className="text-white">Display currency</span>
                    <div className="flex items-center gap-2">
                      <img
                        src={tokenList.find((t) => t.name === tokenType)?.icon}
                        className="w-6 h-6 rounded-full"
                        alt={tokenType}
                      />
                      <span className="text-white">{tokenType}</span>
                    </div>
                  </button>
                </div>

                <div className="relative w-full">
                  <label className="absolute left-4 top-1/2 -translate-y-1/2 text-white pointer-events-none">
                    Amount
                  </label>

                  <NumericFormat
                    inputMode="decimal"
                    value={amountInput}
                    onFocus={() => setIsEditingSettings(true)}
                    onValueChange={(values) => {
                      setAmountInput(values.floatValue ?? 0);
                    }}
                    thousandSeparator
                    allowNegative={false}
                    decimalScale={3}
                    fixedDecimalScale={false}
                    placeholder={`Amount (${tokenType})`}
                    className="w-full p-4 pr-4 pl-32 rounded-lg text-white text-right bg-white/5 placeholder-white/20"
                  />
                </div>

                <div className="hidden mt-2 flex items-center justify-between rounded-lg bg-white/5 p-4">
                  <label
                    htmlFor="adminOnlySpin"
                    className="text-white text-base"
                  >
                    Only host can spin
                  </label>

                  <button
                    id="adminOnlySpin"
                    onClick={async () => {
                      const next = !adminOnlySpin;
                      setAdminOnlySpin(next);

                      await fetch(`/api/game/${safeRoomId.toLowerCase()}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          address,
                          adminOnlySpin: next,
                        }),
                      });

                      refresh();
                    }}
                    className={`items-center relative inline-flex h-[26px] w-[44px] shrink-0 cursor-pointer rounded-full transition-colors ${
                      adminOnlySpin ? "bg-primary" : "bg-white/20"
                    }`}
                    role="switch"
                    aria-checked={adminOnlySpin}
                  >
                    <span
                      className={`inline-block h-[20px] w-[20px] transform rounded-full bg-white transition-transform ${
                        adminOnlySpin
                          ? "translate-x-[20px]"
                          : "translate-x-[2px]"
                      }`}
                    />
                  </button>
                </div>

                <Button
                  onClick={async () => {
                    setIsSaving(true);
                    setSaveStatus("saving");
                    await fetch(`/api/game/${safeRoomId.toLowerCase()}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        address,
                        amount: amountInput,
                        adminOnlySpin,
                        spinToken: tokenType,
                      }),
                    });

                    setIsSaving(false);
                    setSaveStatus("saved");
                    setShowDrawer(false);
                    refresh();

                    setIsEditingSettings(false);

                    setTimeout(() => setSaveStatus("idle"), 2000);
                  }}
                  disabled={isSaving}
                  className="w-full bg-white text-black hover:opacity-50 transition-all"
                >
                  {saveStatus === "saving" ? "Saving..." : "Save"}
                </Button>

                <Button
                  className="w-full bg-red-500 text-white hover:opacity-50 transition-all"
                  onClick={async () => {
                    if (!address) return;

                    toast.promise(
                      fetch(`/api/game/${safeRoomId.toLowerCase()}`, {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ address }),
                      }),
                      {
                        loading: "Deleting",
                        success: () => {
                          setTimeout(() => {
                            window.location.href = "/rooms";
                          }, 1200);
                          return "deleted!";
                        },
                        error: "Failed to delete ",
                      }
                    );
                  }}
                >
                  Delete
                </Button>
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <PaymentTokenPickerDialog
        open={tokenDrawerOpen}
        onOpenChange={setTokenDrawerOpen}
        selectedToken={tokenType}
        onSelect={setTokenType}
        title="Select payment token"
      />
    </div>
  );
}
