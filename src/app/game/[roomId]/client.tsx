"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { useAccount, useConnect } from "wagmi";
import sdk from "@farcaster/frame-sdk";
import { Drawer } from "vaul";
import { NumericFormat } from "react-number-format";
import { useGame } from "@/hooks/useGame";
import { ParticipantList } from "@/components/app/participantList";
import { PayButton } from "@/components/app/payButton";
import { SpinButton } from "@/components/app/spinButton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
// import { Settings } from "lucide-react";
import { PaymentSuccessDrawer } from "@/components/app/PaymentSuccessDrawer";
import { shortAddress } from "@/lib/shortAddress";
// import { useAddPoints } from "@/lib/useAddPoints";
import { toast } from "sonner";
import { tokenList } from "@/lib/tokens";
import { getShareUrl } from "@/lib/share";
import { useAddPoints } from "@/lib/useAddPoints";
import { Loader, Copy, CopyCheck, Share } from "lucide-react";

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
  const amount = game?.amount ?? 0;

  const [recipientInput, setRecipientInput] = useState("");
  const [amountInput, setAmountInput] = useState(0.01);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const [showDrawer, setShowDrawer] = useState(false);
  const [adminOnlySpin, setAdminOnlySpin] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);
  const [tokenType, setTokenType] = useState(
    game?.spinToken || tokenList[0].name
  ); // defaults to ETH

  const hasChosenPaid = !!game?.paid?.some(
    (p) => p.address.toLowerCase() === chosen?.address?.toLowerCase()
  );
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Keep in sync with backend value
  useEffect(() => {
    if (game?.adminOnlySpin !== undefined) {
      setAdminOnlySpin(game.adminOnlySpin);
    }
  }, [game?.adminOnlySpin]);

  useEffect(() => {
    if (game?.spinToken) {
      setTokenType(game.spinToken);
    }
  }, [game?.spinToken]);

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
    await fetch(`/api/game/${safeRoomId.toLowerCase()}`, {
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
    amount > 0;

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

  const handleShare = async () => {
    const url = getShareUrl({
      name: game?.gameId ?? "🎲Join pay roulette",
      description: "Who's paying? Come spin and find out!",
      url: `https://tab.castfriends.com/game/${game?.gameId}`,
    });

    sdk.actions.openUrl(url);

    if (address) {
      await useAddPoints(address, "share_frame");
    }
  };

  const handleCopy = (copyUrl: string) => {
    navigator.clipboard.writeText(copyUrl);
    setCopiedCode(copyUrl);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const copyUrl = `https://tab.castfriends.com/game/${game?.gameId}`;

  const notifyUser = async (fid: string) => {
    try {
      await fetch("/api/send-notif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fid,
          title: "🎲 Join pay roulette",
          message: `Get ready… we’re spinning soon on ${game.gameId}`,
          targetUrl: `https://tab.castfriends.com/game/${game.gameId}`, // or your intended link
        }),
      });

      toast.success("Notification sent!");
    } catch {
      toast.error("Failed to send notification.");
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-6 pt-20 pb-48 overflow-y-auto">
      <Card className="flex flex-col mt-2 p-4 w-full max-w-md rounded-lg">
        {!participants.some((p) => p.address === address) ? (
          <>
            <div className="flex flex-col items-center mb-4 mt-2">
              <img
                src="/pl.png"
                alt="cover"
                className="w-24 h-24 animate-slowSpin"
              />
              <h1 className="mt-1 text-xl font-bold text-center capitalize">
                {decodeURIComponent(safeRoomId)} Table
              </h1>
              <p className="text-primary text-center">
                by @
                {participants.find(
                  (p) => p.address.toLowerCase() === game.admin.toLowerCase()
                )?.name ?? shortAddress(game.admin)}
              </p>
            </div>
            <ParticipantList
              participants={participants}
              adminAddress={game.admin}
              isAdmin={isAdmin}
              onNotify={notifyUser}
            />

            <Button onClick={handleJoin} className="w-full bg-primary mt-4">
              Join table
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center mb-2 mt-2">
              <img
                src="/pl.png"
                alt="cover"
                className="w-16 h-16 animate-slowSpin"
              />
              <h1 className="mt-1 text-xl font-bold text-center capitalize">
                {decodeURIComponent(safeRoomId)} Table
              </h1>
              <p className="text-primary text-center">
                by @
                {participants.find(
                  (p) => p.address.toLowerCase() === game.admin.toLowerCase()
                )?.name ?? shortAddress(game.admin)}
              </p>
            </div>

            {isAdmin && (
              <Button
                variant="ghost"
                className="w-full opacity-30 mb-2 p-2 pt-0"
                onClick={() => setShowDrawer(true)}
              >
                Payment Settings
              </Button>
            )}

            <ParticipantList
              participants={participants}
              adminAddress={game.admin}
              isAdmin={isAdmin}
              onNotify={notifyUser}
            />

            {isAdmin && (
              <div className="flex flex-row space-x-2">
                <Button
                  onClick={handleShare}
                  className="w-full bg-secondary text-white mt-3"
                >
                  <Share className="w-12 h-12" />
                </Button>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.nativeEvent.stopImmediatePropagation();
                    handleCopy(copyUrl);
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                  }}
                  className="w-full bg-secondary text-white mt-3"
                >
                  {copiedCode === copyUrl ? (
                    <CopyCheck className="w-12 h-12" />
                  ) : (
                    <Copy className="w-12 h-12" />
                  )}
                </Button>
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
              <div className="text-center space-y-2">
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
                        <p className="text-sm text-muted mt-2 hidden">
                          @{spinnerName} spun → @
                          {lastSpin.picked?.name ?? "unknown"} has to pay
                        </p>
                      );
                    }

                    return null;
                  })()}

                {/* Show PayButton only if current user is chosen and hasn't paid */}
                {address &&
                canPay &&
                address.toLowerCase() === chosen.address.toLowerCase() &&
                !hasChosenPaid ? (
                  <PayButton
                    recipient={recipientAddress as `0x${string}`}
                    amount={amount}
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
                    setShowSuccess={setShowSuccess}
                    token={tokenType} // ✅ This matches the PayButtonProps interface
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
                {hasChosenPaid ? (
                  <h2 className="pt-2 text-lg font-semibold text-green-400 pb-2">
                    ✅ @{chosen.name} has paid
                  </h2>
                ) : (
                  <h2 className="text-lg font-semibold text-active pb-2 pt-4">
                    {(address ?? "").toLowerCase() ===
                    chosen.address.toLowerCase()
                      ? "The wheel chose you 💸!"
                      : `@${chosen.name} was picked to pay 💸`}
                  </h2>
                )}
              </div>
            )}
          </>
        )}
      </Card>
      <div className="w-full max-w-md mt-4 px-8">
        <p className="text-center text-sm opacity-30">
          Everyone joins the table, one person gets picked, and they cover the
          bill.
        </p>
      </div>

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
              Payment Settings
            </Drawer.Title>
            <div className="p-6 space-y-4 rounded-t-[10px] flex-1 space-y-4">
              <div className="max-w-md mx-auto space-y-3">
                <input
                  type="text"
                  placeholder="Recipient address"
                  value={recipientInput}
                  onChange={(e) => setRecipientInput(e.target.value)}
                  className="placeholder-white/20 w-full p-4 rounded-lg text-white bg-white/5 text-base"
                />

                <div className="flex flex-col space-y-2">
                  <button
                    onClick={() => setTokenDrawerOpen(true)}
                    className="w-full flex items-center justify-between p-4 rounded-lg bg-white/5"
                  >
                    <div className="flex items-center gap-2">
                      <img
                        src={tokenList.find((t) => t.name === tokenType)?.icon}
                        className="w-6 h-6 rounded-full"
                        alt={tokenType}
                      />
                      <span className="text-white">{tokenType}</span>
                    </div>
                    <span className="text-white/20">Select Token</span>
                  </button>
                </div>

                <div className="relative w-full">
                  <label className="absolute left-4 top-1/2 -translate-y-1/2 text-white pointer-events-none">
                    Total Amount
                  </label>
                  <NumericFormat
                    inputMode="decimal"
                    pattern="[0-9]*"
                    value={amountInput}
                    onValueChange={(values) => {
                      setAmountInput(parseFloat(values.value || "0"));
                    }}
                    thousandSeparator
                    allowNegative={false}
                    decimalScale={3}
                    placeholder={`Amount (${tokenType})`}
                    className="w-full p-4 pr-8 pl-32 rounded-lg text-white text-right bg-white/5 placeholder-white/20"
                  />
                </div>

                <div className="mt-2 flex items-center justify-between rounded-lg bg-white/5 p-4">
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
                        recipient: recipientInput,
                        amount: amountInput,
                        adminOnlySpin, // ✅ send updated value
                        spinToken: tokenType, // ✅ new token
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
                      fetch(`/api/game/${safeRoomId.toLowerCase()}`, {
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
          <Drawer.Root open={tokenDrawerOpen} onOpenChange={setTokenDrawerOpen}>
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
              <Drawer.Content className="pb-16 fixed bottom-0 left-0 right-0 bg-background p-4 rounded-t-3xl max-h-[80vh] overflow-y-auto z-50">
                <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-4" />
                <p className="text-center text-white/30 mb-2">Select token</p>
                <div className="space-y-2">
                  {tokenList.map((token) => (
                    <button
                      key={token.name}
                      onClick={() => {
                        setTokenType(token.name);
                        setTokenDrawerOpen(false);
                      }}
                      className="w-full flex items-center p-3 rounded-lg bg-white/5 hover:bg-white/10"
                    >
                      <img
                        src={token.icon}
                        className="w-8 h-8 rounded-full mr-4"
                        alt={token.name}
                      />
                      <div className="text-left">
                        <p className="text-white font-medium">{token.name}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
