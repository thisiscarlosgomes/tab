"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { useAccount, useConnect } from "wagmi";
import sdk from "@farcaster/frame-sdk";
import { Drawer } from "vaul";

import { useGame } from "@/hooks/useGame";
import { ParticipantList } from "@/components/app/participantList";
import { PayButton } from "@/components/app/payButton";
import { SpinButton } from "@/components/app/spinButton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
// import { Settings } from "lucide-react";
import { PaymentSuccessDrawer } from "@/components/app/PaymentSuccessDrawer";
import { Loader } from "lucide-react";
import { shortAddress } from "@/lib/shortAddress";
// import { useAddPoints } from "@/lib/useAddPoints";
import { toast } from "sonner";

export default function RoomPage() {
  const { dismiss } = useFrameSplash();
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { roomId } = useParams();
  const safeRoomId = Array.isArray(roomId) ? roomId[0] : (roomId ?? "");

  const { game, isLoading, refresh } = useGame(safeRoomId || "");

  const participants = game?.participants || [];
  const chosen = game?.chosen;
  const recipientAddress = game?.recipient ?? "";
  const ethAmount = game?.amount ?? 0;

  const [recipientInput, setRecipientInput] = useState("");
  const [amountInput, setAmountInput] = useState(0.01);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const [showDrawer, setShowDrawer] = useState(false);
  const [adminOnlySpin, setAdminOnlySpin] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const hasChosenPaid = !!game?.paid?.some(
    (p) => p.address.toLowerCase() === chosen?.address?.toLowerCase()
  );

  // Keep in sync with backend value
  useEffect(() => {
    if (game?.adminOnlySpin !== undefined) {
      setAdminOnlySpin(game.adminOnlySpin);
    }
  }, [game?.adminOnlySpin]);

  const handleJoin = async (): Promise<void> => {
    if (!isConnected) {
      await connect({ connector: farcasterFrame() });
    }
    if (!address) return;

    const context = await sdk.context;

    const player = {
      name: context.user?.username ?? address?.slice(0, 6),
      address,
      pfp: context.user?.pfpUrl,
      fid: context.user?.fid,
    };
    await fetch(`/api/game/${safeRoomId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player }),
    });

    // Optional: Give points for joining
    // await useAddPoints(address, "invite", safeRoomId);

    refresh();
  };

  useEffect(() => {
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    if (game?.recipient) setRecipientInput(game.recipient);
    if (game?.amount) setAmountInput(game.amount);
  }, [game?.recipient, game?.amount]);

  const isAdmin = Boolean(
    address && game?.admin && game.admin.toLowerCase() === address.toLowerCase()
  );

  // const canSpin =
  //   recipientAddress.startsWith("0x") &&
  //   recipientAddress.length === 42 &&
  //   ethAmount > 0;

  const canSpin = true; // ✅ Allow spinning even if recipient/amount not set

  const canPay =
    recipientAddress.startsWith("0x") &&
    recipientAddress.length === 42 &&
    ethAmount > 0;

  // useEffect(() => {
  //   if (isAdmin && (!game?.recipient || !game?.amount)) {
  //     setShowDrawer(true);
  //   }
  // }, [isAdmin, game?.recipient, game?.amount]);

  if (isLoading || !game) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[60vh]">
        <Loader className="w-8 h-8 animate-spin text-white/30" />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-6 pt-20 pb-48 overflow-y-auto">
      <h1 className="text-3xl font-bold text-center">
        Table: {decodeURIComponent(safeRoomId)}
        <br />
      </h1>
      {isAdmin && (
        <Button
          variant="ghost"
          className="w-full opacity-30"
          onClick={() => setShowDrawer(true)}
        >
          Table Settings
        </Button>
      )}

      {/* {isAdmin && (
        <button
          className="z-30 fixed top-6 right-6 text-lg opacity-50"
          onClick={() => setShowDrawer(true)}
        >
          <Settings className="w-7 h-7" />
        </button>
      )} */}

      <Card className="flex flex-col mt-2 p-4 w-full max-w-md rounded-lg">
        {!participants.some((p) => p.address === address) ? (
          <>
            {/* Avatars of current participants */}
            {participants.length > 0 && (
              <div className="flex -space-x-2 mb-4 justify-center">
                {participants.slice(0, 5).map((p) => (
                  // <Image
                  //   key={p.address}
                  //   src={
                  //     p.pfp ||
                  //     `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${encodeURIComponent(p.name)}`
                  //   }
                  //   alt={p.name}
                  //   width={32}
                  //   height={32}
                  //   className="w-8 h-8 rounded-full border-2 border-white object-cover"
                  // />
                  <img
                    key={p.address}
                    src={
                      p.pfp ||
                      `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${p.name}`
                    }
                    alt={p.name}
                    className="w-8 h-8 rounded-full border-2 border-white object-cover"
                  />
                ))}
                {participants.length > 5 && (
                  <span className="w-8 h-8 flex items-center justify-center rounded-full bg-muted text-xs text-foreground border-2 border-white">
                    +{participants.length - 5}
                  </span>
                )}
              </div>
            )}

            <button
              onClick={handleJoin}
              className="w-full p-4 rounded-lg bg-primary"
            >
              Join with code
            </button>
          </>
        ) : (
          <>
            <ParticipantList
              participants={participants}
              adminAddress={game.admin}
            />

            {game.paid && game.paid.length > 0 && (
              <div className="mt-4 text-sm text-white/60">
                <p className="text-center mb-2 text-white">✅ Paid Members</p>
                <ul className="text-center text-white/80">
                  {game.paid.map((user) => (
                    <li key={user.txHash}>@{user.name} sent payment</li>
                  ))}
                </ul>
              </div>
            )}

            {game.recipient && game.amount > 0 && (
              <div className="border rounded-lg p-4 mt-2">
                <div className="text-base text-center">
                  <p>
                    Paying{" "}
                    <strong className="text-primary">{game.amount} ETH</strong>{" "}
                    to
                  </p>
                  <p className="break-all">{shortAddress(game.recipient)}</p>
                </div>
              </div>
            )}

            {participants.length >= 1 && (
              <SpinButton
                participants={participants}
                roomId={safeRoomId}
                onPick={refresh}
                userAddress={address}
                canSpin={canSpin}
                adminOnly={game.adminOnlySpin}
                isAdmin={isAdmin}
              />
            )}

            {chosen && (
              <div className="text-center mt-4 space-y-2">
                {/* ...spinner info logic... */}
                {typeof window !== "undefined" &&
                  (() => {
                    const key = `recent-spins-${safeRoomId}`;
                    const spins = JSON.parse(localStorage.getItem(key) || "[]");
                    const lastSpin = spins?.[0];

                    if (lastSpin?.by && lastSpin?.picked) {
                      const spinnerName =
                        participants.find(
                          (p) =>
                            p.address.toLowerCase() ===
                            lastSpin.by.toLowerCase()
                        )?.name ?? "someone";

                      return (
                        <p className="text-sm text-muted">
                          @{spinnerName} spun → @{lastSpin.picked} has to pay
                        </p>
                      );
                    }

                    return null;
                  })()}

                {hasChosenPaid ? (
                  <h2 className="text-lg font-semibold text-green-400 pb-4 mb-4">
                    ✅ @{chosen.name} has paid
                  </h2>
                ) : (
                  <h2 className="text-lg font-semibold text-active pb-2">
                    {(address ?? "").toLowerCase() ===
                    chosen.address.toLowerCase()
                      ? "The wheel chose you 💸!"
                      : `@${chosen.name} was picked to pay 💸`}
                  </h2>
                )}

                {/* Show PayButton only if current user is chosen and hasn't paid */}
                {address &&
                canPay &&
                address.toLowerCase() === chosen.address.toLowerCase() &&
                !hasChosenPaid ? (
                  <PayButton
                    recipient={recipientAddress as `0x${string}`}
                    amountEth={ethAmount}
                    onlyIf
                    onPay={refresh}
                    payer={{
                      address,
                      name:
                        participants.find(
                          (p) =>
                            p.address.toLowerCase() === address.toLowerCase()
                        )?.name ?? "You",
                    }}
                    roomId={safeRoomId}
                    setShowSuccess={setShowSuccess} // ✅ add this
                  />
                ) : (
                  address?.toLowerCase() === chosen.address.toLowerCase() &&
                  !hasChosenPaid && (
                    <p className="text-sm text-muted mt-2">
                      Waiting for @
                      <span>
                        {participants.find(
                          (p) =>
                            p.address.toLowerCase() === game.admin.toLowerCase()
                        )?.name ?? "admin"}
                      </span>{" "}
                      to set payment details
                    </p>
                  )
                )}
              </div>
            )}
          </>
        )}
      </Card>

      <PaymentSuccessDrawer
        isOpen={showSuccess}
        setIsOpen={setShowSuccess}
        name="Payment Sent"
      />

      <Drawer.Root
        open={isAdmin && showDrawer}
        onOpenChange={setShowDrawer}
        repositionInputs={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 !bg-black/60 backdrop-blur-[7.5px] z-20" />
          <Drawer.Content className="z-30 bg-background flex flex-col rounded-t-[32px] mt-24 h-fit fixed bottom-0 left-0 right-0 outline-none">
            <Drawer.Title className="text-lg font-normal text-center mt-6">
              Set Payment Details
            </Drawer.Title>
            <div className="p-6 space-y-4 rounded-t-[10px] flex-1 space-y-4">
              <div className="max-w-md mx-auto text-sm space-y-4">
                <input
                  type="text"
                  placeholder="Recipient address"
                  value={recipientInput}
                  onChange={(e) => setRecipientInput(e.target.value)}
                  className="placeholder-white/20 w-full p-4 rounded-lg text-white bg-white/5 text-base"
                />

                <div className="relative w-full">
                  <input
                    type="number"
                    placeholder="Amount (ETH)"
                    step="0.001"
                    min="0"
                    value={amountInput}
                    onChange={(e) => setAmountInput(parseFloat(e.target.value))}
                    className="placeholder-white/20 w-full p-4 rounded-lg text-white bg-white/5 text-base"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 text-base pointer-events-none">
                    ETH
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-white/5 p-4">
                  <label
                    htmlFor="adminOnlySpin"
                    className="text-white/30 text-base"
                  >
                    Only admin can spin
                  </label>

                  <button
                    id="adminOnlySpin"
                    onClick={async () => {
                      const next = !adminOnlySpin;
                      setAdminOnlySpin(next);

                      await fetch(`/api/game/${safeRoomId}`, {
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

                    await fetch(`/api/game/${safeRoomId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        address,
                        recipient: recipientInput,
                        amount: amountInput,
                        adminOnlySpin, // ✅ send updated value
                      }),
                    });

                    setIsSaving(false);
                    setSaveStatus("saved");
                    setShowDrawer(false);
                    refresh();

                    setTimeout(() => setSaveStatus("idle"), 2000);
                  }}
                  disabled={isSaving}
                  className="w-full bg-primary text-primary-foreground hover:opacity-50 transition-all"
                >
                  {saveStatus === "saving" ? "Saving..." : "Save"}
                </Button>

                <Button
                  className="w-full bg-red-500 text-white hover:opacity-50 transition-all"
                  onClick={async () => {
                    if (!address) return;

                    toast.promise(
                      fetch(`/api/game/${safeRoomId}`, {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ address }),
                      }),
                      {
                        loading: "Deleting table...",
                        success: () => {
                          setTimeout(() => {
                            window.location.href = "/rooms";
                          }, 1200);
                          return "Table deleted!";
                        },
                        error: "Failed to delete table",
                      }
                    );
                  }}
                >
                  Delete Table
                </Button>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
