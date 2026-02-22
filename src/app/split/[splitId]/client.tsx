"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import sdk from "@farcaster/frame-sdk";
import { QRCode } from "react-qrcode-logo";
import NumberFlow from "@number-flow/react";
import {
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
  parseISO,
} from "date-fns";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SplitPayButton } from "@/components/app/splitPayButton";
import { PaymentSuccessDrawer } from "@/components/app/PaymentSuccessDrawer";
import Tilt from "react-parallax-tilt";
import { Loader, ReceiptText, Settings, Share, QrCode } from "lucide-react";
import { tokenList } from "@/lib/tokens";
import { getTokenPrices } from "@/lib/getTokenPrices";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { shortAddress } from "@/lib/shortAddress";
import { useTabIdentity } from "@/lib/useTabIdentity";

interface Participant {
  address: string;
  name: string;
  pfp?: string;
  fid?: number; // ✅ number
  amount?: number;
}

interface Paid {
  address: string;
  fid: number; // ✅ ADD THIS
  name: string;
  txHash: string;
  timestamp: string;
  amount?: number;
}

type SplitType = "invited" | "pay_other" | "receipt_open";

interface SplitBill {
  splitId: string;
  code: string;
  creator: Participant;
  recipient: Participant;

  description: string;
  totalAmount: number;
  token: string;

  splitType: SplitType; // ✅ ADD THIS

  numPeople?: number;

  participants?: Participant[];
  invited?: Participant[];
  paid?: Paid[];

  createdAt?: string;
  invitedOnly?: boolean;
}

type TokenName = (typeof tokenList)[number]["name"];

export default function SplitPage() {
  const [userFid, setUserFid] = useState<number | null>(null);

  const { splitId } = useParams();
  const safeSplitId = Array.isArray(splitId) ? splitId[0] : (splitId ?? "");
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const {
    fid: identityFid,
    username: identityUsername,
    pfp: identityPfp,
  } = useTabIdentity();

  const [bill, setBill] = useState<SplitBill | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [hasPaid, setHasPaid] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const { dismiss } = useFrameSplash();

  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [showQrDrawer, setShowQrDrawer] = useState(false);

  const normalizeBill = (bill: SplitBill): SplitBill => ({
    ...bill,
    participants: bill.participants?.map((p) => ({
      ...p,
      fid: p.fid != null ? Number(p.fid) : undefined,
    })),
    invited: bill.invited?.map((p) => ({
      ...p,
      fid: p.fid != null ? Number(p.fid) : undefined,
    })),
    paid: bill.paid?.map((p) => ({
      ...p,
      fid: Number(p.fid),
    })),
  });

  const fetchBill = async () => {
    const res = await fetch(`/api/split/${safeSplitId}`);
    const data = await res.json();
    setBill(normalizeBill(data));
  };

  useEffect(() => {
    let mounted = true;

    sdk.context
      .then((ctx) => {
        if (!mounted) return;
        if (ctx?.user?.fid) {
          setUserFid(ctx.user.fid);
        }
      })
      .catch(() => {
        // no frame context in web mode
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!userFid && identityFid) {
      setUserFid(identityFid);
    }
  }, [identityFid, userFid]);

  const [paymentSuccess, setPaymentSuccess] = useState<{
    amount: number;
    token: string;
    recipientUsername?: string;
    txHash?: string;
  } | null>(null);

  useEffect(() => {
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    (async () => {
      const prices = await getTokenPrices();
      setTokenPrices(prices);
    })();
  }, []);

  useEffect(() => {
    fetchBill();
    const interval = setInterval(fetchBill, 5000);
    return () => clearInterval(interval);
  }, [safeSplitId]);

  const token = bill?.token ?? "ETH";
  const tokenInfo = tokenList.find((t) => t.name === token) ?? tokenList[0];

  const priceUsd = tokenPrices[token] ?? null;

  const formatTokenAmount = (amount: number, token: string) => {
    if (token === "USDC" || token === "EURC")
      return amount.toFixed(amount < 1 ? 2 : 1);
    if (amount >= 1) return amount.toFixed(2);
    if (amount >= 0.01) return amount.toFixed(3);
    return amount.toPrecision(4);
  };

  const getTokenSuffix = (token: string) => {
    switch (token) {
      case "USDC":
        return "$";
      case "EURC":
        return "€";
      case "ETH":
      case "WETH":
        return "Ξ";
      default:
        return "$";
    }
  };

  const paidList = bill?.paid ?? [];
  const participantList = bill?.participants ?? [];

  //   const participantList = (bill?.participants ?? []).filter(
  //   (p) => p.fid !== bill?.recipient?.fid
  // );

  // canonical per-person share (same for everyone)
  const perPersonAmount =
    bill?.splitType === "receipt_open" && bill.numPeople
      ? bill.totalAmount / bill.numPeople
      : (bill?.invited?.[0]?.amount ?? 0);

  // viewer-specific (optional)
  const myInvitedEntry =
    userFid != null ? bill?.invited?.find((i) => i.fid === userFid) : null;

  const myAmount = myInvitedEntry?.amount ?? perPersonAmount;

  const eachShare = formatTokenAmount(perPersonAmount, token);

  // const isPaid = paidList.some(
  //   (p) =>
  //     p.address?.toLowerCase?.() &&
  //     address?.toLowerCase?.() &&
  //     p.address.toLowerCase() === address.toLowerCase()
  // );

  const isPaid = userFid != null && paidList.some((p) => p.fid === userFid);

  const hasJoined =
    userFid != null &&
    participantList.some(
      (p) => p.fid === userFid && p.fid !== bill?.recipient?.fid
    );

  const isCreator =
    address &&
    bill?.creator?.address?.toLowerCase?.() === address.toLowerCase();

  const isRecipient =
    address &&
    bill?.recipient?.address?.toLowerCase?.() === address.toLowerCase();

  const debtorCount =
  bill?.splitType === "receipt_open"
    ? bill.numPeople ?? 0
    : bill?.invited?.length ?? 0;

const paidCount = bill?.paid?.length ?? 0;





  

  const allPaid = debtorCount > 0 && paidCount === debtorCount;

  const unpaidList = participantList.filter(
    (p) =>
      p.fid != null &&
      p.fid !== bill?.recipient?.fid &&
      !paidList.some((paid) => paid.fid === p.fid)
  );

  const timeAgo = (() => {
    const date = bill?.createdAt ? parseISO(bill.createdAt) : null;
    if (!date) return null;

    const now = new Date();
    const mins = differenceInMinutes(now, date);
    const hrs = differenceInHours(now, date);
    const days = differenceInDays(now, date);

    if (mins < 60) return `${mins}m ago`;
    if (hrs < 24) return `${hrs}h ago`;
    return `${days}d ago`;
  })();

  const isInvited =
  bill?.splitType !== "receipt_open" &&
  userFid != null &&
  bill?.invited?.some((i) => i.fid === userFid);


  const isFull =
    bill?.splitType === "receipt_open" &&
    bill.numPeople != null &&
    participantList.length >= bill.numPeople;

  const canJoin =
    !hasJoined &&
    !isRecipient &&
    !isCreator &&
    !isFull &&
    (!bill?.invitedOnly || isInvited);

 const canPay =
  userFid != null &&
  hasJoined &&
  !isPaid &&
  !allPaid &&
  (bill?.splitType === "receipt_open" || isInvited);


  useEffect(() => {
    if (isPaid) setHasPaid(true);
  }, [isPaid]);

  const invitedButNotJoined =
    bill?.invited?.filter(
      (inv) => !participantList.some((p) => Number(inv.fid) === p.fid)
    ) ?? [];

  const activityList = Array.from(
    new Map(
      [...participantList, ...invitedButNotJoined]
        .filter((p) => p.fid)
        .map((p) => [Number(p.fid), p])
    ).values()
  );

  const handleJoin = async () => {
    let ctx: Awaited<typeof sdk.context> | null = null;
    try {
      ctx = await sdk.context;
    } catch {
      ctx = null;
    }

    if (
      bill?.invitedOnly &&
      !bill?.invited?.some((inv) => Number(inv.fid) === userFid)
    ) {
      toast("Only invited users can join this split.");
      return;
    }

    if (!isConnected) {
      const connector = connectors[0];
      if (!connector) return;
      await connect({ connector });
    }
    if (!address) return;

    const participantFid = ctx?.user?.fid ?? identityFid ?? undefined;
    const participant: Participant = {
      address,
      name: ctx?.user?.username ?? identityUsername ?? address.slice(0, 6),
      pfp: ctx?.user?.pfpUrl ?? identityPfp ?? "",
      fid: participantFid,
    };

    setIsJoining(true);

    await fetch(`/api/split/${safeSplitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant }),
    });

    await fetchBill();
    setIsJoining(false);
  };

  const handleShare = async () => {
    const url = `https://usetab.app/split/${bill?.splitId}`;

    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
        return;
      }

      // final fallback
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const notifyUnpaid = async () => {
    if (!isCreator || unpaidList.length === 0) return;

    toast.promise(
      Promise.all(
        unpaidList.map(async (p) => {
          if (!p.fid) return;
          return fetch("/api/send-notif", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fid: Number(p.fid), // ✅ REQUIRED
              title: "Reminder to Pay",
              message: `Hey @${p.name}, remember to settle your share for "${bill?.description}" 💸`,
              targetUrl: `https://usetab.app/split/${bill?.splitId}`,
            }),
          });
        })
      ),
      {
        loading: "Sending reminders...",
        success: `Notified ${unpaidList.length} friend${
          unpaidList.length > 1 ? "s" : ""
        }`,
        error: "Something went wrong",
      }
    );
  };

  if (!bill) return null; // or early return above

  const totalPaid = paidList.reduce((sum, p) => sum + (p.amount ?? 0), 0);

  const remaining = Math.max(bill.totalAmount - totalPaid, 0);

  return (
    <div className="min-h-screen w-full flex flex-col items-center px-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(8rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
      <Card className="w-full max-w-md p-4 space-y-4">
        {!bill ? (
          <div className="flex flex-1 items-center justify-center min-h-[60vh]">
            <Loader className="w-8 h-8 animate-spin text-white/30" />
          </div>
        ) : (
          <>
            {/* HEADER */}
            <div className="flex flex-col items-center">
              <h1 className="text-lg font-medium text-center mb-1 mt-4">
                {bill.description}
              </h1>
              <p className="text-primary">Splits by @{bill.creator.name}</p>
              <p className=" opacity-50 py-1 text-sm px-3 bg-white/5 text-white mt-1 rounded-[6px]">
                Recipient: {shortAddress(bill.recipient.address)}
              </p>
            </div>

            {/* AMOUNT + AVATARS + PROGRESS */}
            <div className="border rounded-lg p-4 mt-2">
              <div className="text-sm text-center">
                <NumberFlow
                  value={bill.totalAmount}
                  format={{
                    minimumFractionDigits: token === "USDC" ? 2 : 3,
                    maximumFractionDigits: token === "USDC" ? 2 : 6,
                  }}
                  prefix={getTokenSuffix(token)}
                  className="text-4xl font-medium text-white"
                />

                {participantList.length > 0 && (
                  <div className="flex justify-center -space-x-3 mt-2">
                    {participantList
                      .filter((p) => p.fid !== bill?.recipient?.fid)
                      .slice(0, 8)
                      .map((p) => (
                        <img
                          key={p.address}
                          src={
                            p.pfp ||
                            `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${p.name}`
                          }
                          alt={p.name}
                          className="w-8 h-8 rounded-full border-2 border-white object-cover mb-4"
                        />
                      ))}

                    {participantList.length > 8 && (
                      <span className="w-8 h-8 rounded-full bg-card border-white border-2 text-xs flex items-center justify-center">
                        +{participantList.length - 8}
                      </span>
                    )}
                  </div>
                )}

                <div className="w-full max-w-[180px] h-2 rounded-full bg-white/10 mx-auto overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{
                      width:
                        debtorCount > 0
                          ? `${(paidCount / debtorCount) * 100}%`
                          : "0%",
                    }}
                  />
                </div>

                <div className="flex justify-center items-center gap-2 text-sm mt-2">
                  <span className={allPaid ? "text-green-400" : "text-white"}>
                    {allPaid
                      ? "This split is settled"
                      : `${formatTokenAmount(remaining, token)} ${token} left`}
                  </span>

                  <span className="text-white/40">·</span>

                  <span className={allPaid ? "text-green-400" : "text-white"}>
                    {paidCount} of {debtorCount} paid
                  </span>
                </div>

                {timeAgo && (
                  <p className="text-xs text-white/30 text-center mt-1">
                    Started {timeAgo}
                  </p>
                )}
              </div>

              {/* CREATOR ACTIONS */}
              {/* ACTIONS */}
              <div className="flex flex-row space-x-2 mt-3">
                {/* Share – everyone */}
                <Button
                  onClick={handleShare}
                  className="w-full bg-secondary text-white"
                >
                  <Share className="w-12 h-12" />
                </Button>

                {/* QR – everyone */}
                <Button
                  onClick={() => canPay && setShowQrDrawer(true)}
                  disabled={!canPay}
                  className="w-full bg-secondary text-white disabled:opacity-40"
                >
                  <QrCode className="w-12 h-12" />
                </Button>

                {/* Settings – creator only */}
                {isCreator && (
                  <Button
                    onClick={() => setShowSettingsDrawer(true)}
                    className="w-full bg-secondary text-white"
                  >
                    <Settings className="w-12 h-12" />
                  </Button>
                )}
              </div>
            </div>

            {/* USER ACTIONS */}
            {!isRecipient && (
              <>
                {hasJoined && !isPaid && address && (
                  <SplitPayButton
                    recipient={bill.recipient.address as `0x${string}`} // ✅ CORRECT
                    amount={parseFloat(eachShare)}
                    token={bill.token as TokenName}
                    splitId={safeSplitId}
                    onPaid={fetchBill}
                    payer={{
                      address,
                      name:
                        participantList.find(
                          (p) =>
                            p.address?.toLowerCase() === address.toLowerCase()
                        )?.name ?? "You",
                      fid: userFid!, // ✅ REQUIRED
                    }}
                    onSuccess={(data) => setPaymentSuccess(data)}
                    creatorFid={
                      bill.creator.fid != null
                        ? Number(bill.creator.fid)
                        : undefined
                    }
                    description={bill.description}
                  />
                )}

                <div className="mt-2">
                  {canJoin && (
                    <div className="mt-2">
                      <Button
                        onClick={handleJoin}
                        disabled={isJoining}
                        className="w-full bg-primary"
                      >
                        {isJoining ? "Joining..." : "Join"}
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ACTIVITY */}
            {activityList.length > 0 && (
              <div className="mt-4 text-sm text-muted pb-1">
                <p className="mb-3 text-md font-medium">Members</p>

                <ul className="space-y-2">
                  {activityList.map((p) => {
                    const paid = paidList.find(
                      (x) =>
                        x.address?.toLowerCase?.() &&
                        p.address?.toLowerCase?.() &&
                        x.address.toLowerCase() === p.address.toLowerCase()
                    );

                    const joined = participantList.some(
                      (x) =>
                        x.address?.toLowerCase?.() &&
                        p.address?.toLowerCase?.() &&
                        x.address.toLowerCase() === p.address.toLowerCase()
                    );

                    const isRecipient =
                      bill.recipient?.address?.toLowerCase?.() ===
                      p.address?.toLowerCase?.();

                    const invitedEntry = bill.invited?.find(
                      (i) => i.fid === p.fid
                    );

                    const participantEntry = participantList.find(
                      (x) => x.fid === p.fid
                    );

                    const paidAmount: number =
                      paid?.amount ??
                      participantEntry?.amount ??
                      invitedEntry?.amount ??
                      0;

                    return (
                      <li
                        key={p.address}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <img
                            src={
                              p.pfp ||
                              `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${p.name}`
                            }
                            className="w-7 h-7 rounded-full object-cover"
                          />

                          <div className="flex items-center gap-1">
                            <span className="text-white me-1">@{p.name}</span>

                            {/* Settled (creator only, no onchain payment) */}
                            {isRecipient && (
                              <span className="bg-teal-500/20 text-teal-300 border border-teal-500/30 px-1.5 py-0.5 text-xs rounded-[6px]">
                                Recipient
                              </span>
                            )}

                            {paid && !isRecipient && (
                              <span className="bg-green-500/20 text-green-300 border border-green-500/30 px-1.5 py-0.5 text-xs rounded-[6px]">
                                Paid
                              </span>
                            )}

                            {joined && !paid && !isRecipient && (
                              <span className="bg-yellow-600/20 text-yellow-400 border border-yellow-600/40 px-1.5 py-0.5 text-xs rounded-[6px]">
                                Joined
                              </span>
                            )}

                            {bill.splitType !== "receipt_open" &&
                              !joined &&
                              !isRecipient &&
                              bill.invited?.length && (
                                <span className="bg-blue-600/20 text-blue-400 border border-blue-600/40 px-1.5 py-0.5 text-xs rounded-[6px]">
                                  Invited
                                </span>
                              )}
                          </div>
                        </div>

                        {/* <span className="text-white/40 text-sm">
                          {`${getTokenSuffix(token)}${formatTokenAmount(
                            paidAmount,
                            token
                          )}`}
                        </span> */}
                        {!isRecipient && (
                          <span className="text-white/40 text-sm">
                            {`${getTokenSuffix(token)}${formatTokenAmount(
                              paidAmount,
                              token
                            )}`}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>

      {/* SETTINGS DRAWER */}
      <Drawer.Root
        open={showSettingsDrawer}
        onOpenChange={setShowSettingsDrawer}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
          <Drawer.Content className="z-40 bg-background rounded-t-3xl p-6 fixed bottom-0 w-full max-h-[85vh] overflow-y-auto pb-8 mb-4">
            <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-4" />

            <p className="text-center text-lg">Split Settings</p>

            <p className="text-center text-white/40 mt-2">
              Waiting on payments? Send reminders
            </p>

            <Button
              onClick={notifyUnpaid}
              disabled={unpaidList.length === 0}
              className="w-full bg-white text-black mt-4"
            >
              Send Reminder
            </Button>

            {/* TOGGLE: INVITED ONLY */}
            <div className="hidden mt-4 flex items-center justify-between bg-white/5 p-4 rounded-lg">
              <span className="text-white/60">Restrict to invited only</span>

              <button
                onClick={async () => {
                  const next = !bill?.invitedOnly;
                  await fetch(`/api/split/${safeSplitId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ invitedOnly: next }),
                  });
                  fetchBill();
                }}
                className={`relative inline-flex h-[26px] w-[44px] rounded-full transition ${
                  bill?.invitedOnly ? "bg-primary" : "bg-white/20"
                }`}
              >
                <span
                  className={`absolute h-[20px] w-[20px] rounded-full bg-white transition-transform ${
                    bill?.invitedOnly
                      ? "translate-x-[20px]"
                      : "translate-x-[2px]"
                  }`}
                />
              </button>
            </div>

            {/* DELETE SPLIT */}
            <Button
              className="w-full bg-red-500 text-white mt-6"
              onClick={async () => {
                if (!address) return;

                toast.promise(
                  fetch(`/api/split/${safeSplitId}`, {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ address }),
                  }),
                  {
                    loading: "Deleting...",
                    success: () => {
                      setTimeout(() => {
                        window.location.href = "/";
                      }, 1200);
                      return "Split deleted.";
                    },
                    error: "Failed to delete",
                  }
                );
              }}
            >
              Delete Split
            </Button>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* QR DRAWER */}
      <Drawer.Root open={showQrDrawer} onOpenChange={setShowQrDrawer}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
          <Drawer.Content className="bg-background rounded-t-3xl p-6 fixed bottom-0 w-full z-40">
            <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-4" />

            <p className="text-center text-lg">Scan to pay your share</p>

            {bill && canPay && (
              <div className="flex flex-col items-center space-y-3 mt-4 mb-6">
                <Tilt
                  glareEnable
                  glareMaxOpacity={0.2}
                  glareColor="#ffffff"
                  glarePosition="all"
                  scale={1.02}
                  className="p-2 bg-white rounded-xl"
                >
                  <QRCode
                    value={`https://usetab.app/join-split?splitId=${bill.splitId}&payTo=${bill.recipient.address}&amount=${eachShare}&token=${bill.token}`}
                    size={200}
                    logoImage="/app.png"
                    logoWidth={48}
                    logoHeight={48}
                    removeQrCodeBehindLogo
                  />
                </Tilt>

                <p className="text-white/50 text-sm">
                  Scan with Tab mini app to pay.
                </p>

                {!canPay && (
                  <div className="text-center py-10 text-white/60">
                    <p className="text-lg font-medium">Payment unavailable</p>
                    <p className="text-sm mt-1">
                      You’re not eligible to pay for this split.
                    </p>
                  </div>
                )}
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <PaymentSuccessDrawer
        isOpen={!!paymentSuccess}
        setIsOpen={(open) => {
          if (!open) setPaymentSuccess(null);
        }}
        name="That’s settled"
        description={
          paymentSuccess
            ? `${paymentSuccess.amount} ${paymentSuccess.token}`
            : undefined
        }
        recipientUsername={paymentSuccess?.recipientUsername}
        txHash={paymentSuccess?.txHash}
      />
    </div>
  );
}
