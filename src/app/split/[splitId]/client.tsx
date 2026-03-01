"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import sdk from "@farcaster/frame-sdk";
import { QRCode } from "react-qrcode-logo";
import NumberFlow from "@number-flow/react";
import { parseUnits } from "viem";
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
import { Copy, Loader, ReceiptText, Settings, QrCode } from "lucide-react";
import { tokenList } from "@/lib/tokens";
import { getTokenPrices } from "@/lib/getTokenPrices";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { useTabIdentity } from "@/lib/useTabIdentity";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

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

function normalizeAddress(value?: string | null) {
  return typeof value === "string" && value ? value.toLowerCase() : null;
}

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
    address: identityAddress,
  } = useTabIdentity();

  const [bill, setBill] = useState<SplitBill | null>(null);
  const [creatorUsernameOverride, setCreatorUsernameOverride] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [hasPaid, setHasPaid] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const { dismiss } = useFrameSplash();

  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [showQrDrawer, setShowQrDrawer] = useState(false);
  const [showMembersDialog, setShowMembersDialog] = useState(false);

  const normalizeBill = (bill: SplitBill): SplitBill => ({
    ...bill,
    participants: bill.participants?.map((p) => ({
      ...p,
      fid: p.fid !== null && p.fid !== undefined ? Number(p.fid) : undefined,
    })),
    invited: bill.invited?.map((p) => ({
      ...p,
      fid: p.fid !== null && p.fid !== undefined ? Number(p.fid) : undefined,
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
    if (identityFid) {
      setUserFid(identityFid);
      return;
    }

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
  }, [identityFid]);

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

    let interval: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (document.visibilityState !== "visible" || interval) return;
      interval = setInterval(fetchBill, 15000);
    };

    const stopPolling = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchBill();
        startPolling();
      } else {
        stopPolling();
      }
    };

    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
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
  const normalizedViewerAddress = normalizeAddress(address ?? identityAddress);

  const matchesViewer = (entry?: { address?: string; fid?: number } | null) => {
    const entryAddress = normalizeAddress(entry?.address);
    if (normalizedViewerAddress && entryAddress === normalizedViewerAddress) {
      return true;
    }
    return (
      userFid !== null &&
      userFid !== undefined &&
      entry?.fid !== null &&
      entry?.fid !== undefined &&
      Number(entry.fid) === Number(userFid)
    );
  };

  const sameEntry = (
    a?: { address?: string; fid?: number } | null,
    b?: { address?: string; fid?: number } | null
  ) => {
    const aAddress = normalizeAddress(a?.address);
    const bAddress = normalizeAddress(b?.address);
    if (aAddress && bAddress && aAddress === bAddress) return true;
    return (
      a?.fid !== null &&
      a?.fid !== undefined &&
      b?.fid !== null &&
      b?.fid !== undefined &&
      Number(a.fid) === Number(b.fid)
    );
  };

  //   const participantList = (bill?.participants ?? []).filter(
  //   (p) => p.fid !== bill?.recipient?.fid
  // );

  // canonical per-person share (same for everyone)
  const perPersonAmount =
    bill?.splitType === "receipt_open" && bill.numPeople
      ? bill.totalAmount / bill.numPeople
      : (bill?.invited?.[0]?.amount ?? 0);

  // viewer-specific (optional)
  const myInvitedEntry = bill?.invited?.find((entry) => matchesViewer(entry)) ?? null;

  const myAmount = myInvitedEntry?.amount ?? perPersonAmount;

  const eachShare = formatTokenAmount(perPersonAmount, token);
  const splitPaymentQrValue = (() => {
    const recipientAddress = bill?.recipient?.address;
    if (!recipientAddress) return "";
    const qrAmount = Number.isFinite(myAmount) && myAmount > 0 ? myAmount : null;

    try {
      if (token === "ETH" || token === "WETH") {
        const amountValue =
          qrAmount !== null ? parseUnits(String(qrAmount), 18).toString() : null;
        return amountValue
          ? `ethereum:${recipientAddress}@8453?value=${amountValue}`
          : `ethereum:${recipientAddress}@8453`;
      }

      const erc20Address = tokenInfo?.address;
      const decimals = tokenInfo?.decimals ?? 18;
      if (!erc20Address) {
        return `ethereum:${recipientAddress}@8453`;
      }

      const amountValue =
        qrAmount !== null ? parseUnits(String(qrAmount), decimals).toString() : null;

      return amountValue
        ? `ethereum:${erc20Address}@8453/transfer?address=${recipientAddress}&uint256=${amountValue}`
        : `ethereum:${erc20Address}@8453/transfer?address=${recipientAddress}`;
    } catch {
      return `ethereum:${recipientAddress}@8453`;
    }
  })();

  // const isPaid = paidList.some(
  //   (p) =>
  //     p.address?.toLowerCase?.() &&
  //     address?.toLowerCase?.() &&
  //     p.address.toLowerCase() === address.toLowerCase()
  // );

  const isPaid = paidList.some((entry) => matchesViewer(entry));

  const hasJoined =
    participantList.some(
      (entry) => matchesViewer(entry) && !sameEntry(entry, bill?.recipient)
    );

  const isCreator =
    !!normalizedViewerAddress &&
    bill?.creator?.address?.toLowerCase?.() === normalizedViewerAddress;

  const isRecipient =
    !!normalizedViewerAddress &&
    bill?.recipient?.address?.toLowerCase?.() === normalizedViewerAddress;
  const creatorNameLooksLikeAddress =
    !!bill?.creator?.name &&
    (bill.creator.name.startsWith("0x") || bill.creator.name.startsWith("@0x"));
  const creatorDisplayName =
    creatorUsernameOverride ??
    (isCreator && creatorNameLooksLikeAddress && identityUsername
      ? identityUsername
      : bill?.creator?.name);
  const creatorHandleLabel = (creatorDisplayName ?? "").replace(/^@+/, "");

  const debtorCount =
  bill?.splitType === "receipt_open"
    ? bill.numPeople ?? 0
    : bill?.invited?.length ?? 0;

const paidCount = bill?.paid?.length ?? 0;





  

  const allPaid = debtorCount > 0 && paidCount === debtorCount;

  const unpaidList = participantList.filter(
    (entry) =>
      !sameEntry(entry, bill?.recipient) &&
      !paidList.some((paid) => sameEntry(paid, entry))
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
    (bill?.invited?.some((entry) => matchesViewer(entry)) ?? false);


  const isFull =
    bill?.splitType === "receipt_open" &&
    bill.numPeople !== null &&
    bill.numPeople !== undefined &&
    participantList.length >= bill.numPeople;

  const canJoin =
    !hasJoined &&
    !isRecipient &&
    !isCreator &&
    !isFull &&
    (!bill?.invitedOnly || isInvited);

  const canPay =
    hasJoined &&
    !isPaid &&
    !allPaid &&
    (bill?.splitType === "receipt_open" || isInvited);


  useEffect(() => {
    if (isPaid) setHasPaid(true);
  }, [isPaid]);

  useEffect(() => {
    let cancelled = false;

    const creatorFid = bill?.creator?.fid;
    if (!creatorNameLooksLikeAddress || !creatorFid) {
      setCreatorUsernameOverride(null);
      return;
    }

    if (isCreator && identityUsername) {
      setCreatorUsernameOverride(identityUsername);
      return;
    }

    const loadCreatorUsername = async () => {
      try {
        const res = await fetch(
          `/api/neynar/user/by-fids?fids=${encodeURIComponent(String(creatorFid))}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = await res.json();
        const user = Array.isArray(data) ? data[0] : null;
        const username =
          typeof user?.username === "string" && user.username.trim()
            ? user.username.trim()
            : null;
        if (!cancelled) setCreatorUsernameOverride(username);
      } catch {
        if (!cancelled) setCreatorUsernameOverride(null);
      }
    };

    void loadCreatorUsername();
    return () => {
      cancelled = true;
    };
  }, [bill?.creator?.fid, creatorNameLooksLikeAddress, isCreator, identityUsername]);

  const invitedButNotJoined =
    bill?.invited?.filter(
      (invitedEntry) => !participantList.some((entry) => sameEntry(invitedEntry, entry))
    ) ?? [];

  const activityList = Array.from(
    new Map(
      [...participantList, ...invitedButNotJoined]
        .map((entry) => [
          normalizeAddress(entry.address) ?? `fid:${entry.fid ?? entry.name}`,
          entry,
        ])
    ).values()
  );

  const handleJoin = async () => {
    let ctx: Awaited<typeof sdk.context> | null = null;

    if (!identityUsername && !identityPfp && !identityFid) {
      try {
        ctx = await sdk.context;
      } catch {
        ctx = null;
      }
    }

    if (
      bill?.invitedOnly &&
      !bill?.invited?.some((entry) => matchesViewer(entry))
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

  const handleCopyLink = async () => {
    const url = `https://usetab.app/split/${bill?.splitId}`;

    try {
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

    const notifyTargets = unpaidList.filter(
      (participant) => participant.address || participant.fid
    );

    if (notifyTargets.length === 0) {
      toast.error("No reachable recipients to notify");
      return;
    }

    toast.promise(
      Promise.all(
        notifyTargets.map(async (p) => {
          return fetch("/api/send-notif", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fid: p.fid ? Number(p.fid) : undefined,
              recipientAddress: p.address,
              title: "Reminder",
              message: `Hey @${p.name}, remember to settle your share for "${bill?.description}"`,
              targetUrl: `https://usetab.app/split/${bill?.splitId}`,
            }),
          });
        })
      ),
      {
        loading: "Sending reminders...",
        success: `Notified ${notifyTargets.length} friend${
          notifyTargets.length > 1 ? "s" : ""
        }`,
        error: "Something went wrong",
      }
    );
  };

  if (!bill) return null; // or early return above

  const totalPaid = paidList.reduce((sum, p) => sum + (p.amount ?? 0), 0);

  const remaining = Math.max(bill.totalAmount - totalPaid, 0);
  const progressRatio =
    debtorCount > 0 ? Math.min(Math.max(paidCount / debtorCount, 0), 1) : 0;
  const progressPercent = Math.round(progressRatio * 100);
  const ringRadius = 110;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - progressRatio);
  const previewMembers = activityList.slice(0, 4);
  const extraMembersCount = Math.max(activityList.length - previewMembers.length, 0);

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
              <h1 className="text-xl font-medium text-center mb-1 mt-4">
                {bill.description}
              </h1>
              <p className="text-primary">Splits by @{creatorHandleLabel}</p>
            </div>

            {/* AMOUNT + AVATARS + PROGRESS */}
            <div className="">
              <div className="text-sm text-center">
                {activityList.length > 0 && (
                  <button
                    onClick={() => setShowMembersDialog(true)}
                    className="mx-auto mb-4 flex items-center"
                  >
                    <div className="flex -space-x-3">
                      {previewMembers.map((p) => (
                        <img
                          key={normalizeAddress(p.address) ?? `member:${p.fid ?? p.name}`}
                          src={
                            p.pfp ||
                            `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${p.name}`
                          }
                          alt={p.name}
                          className="w-10 h-10 rounded-full border-2 border-background object-cover"
                        />
                      ))}
                      {extraMembersCount > 0 && (
                        <span className="w-10 h-10 rounded-full bg-white/10 border-2 border-background text-sm flex items-center justify-center">
                          +{extraMembersCount}
                        </span>
                      )}
                    </div>
                  </button>
                )}

                <div className="relative mx-auto w-[260px] h-[260px] flex items-center justify-center">
                  <svg className="absolute inset-0 -rotate-90" viewBox="0 0 260 260">
                    <circle
                      cx="130"
                      cy="130"
                      r={ringRadius}
                      stroke="currentColor"
                      strokeWidth="10"
                      className="text-white/10"
                      fill="none"
                    />
                    <circle
                      cx="130"
                      cy="130"
                      r={ringRadius}
                      stroke="currentColor"
                      strokeWidth="10"
                      strokeLinecap="round"
                      className="text-primary transition-all duration-700"
                      fill="none"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringOffset}
                    />
                  </svg>

                  <div className="text-center">
                    <NumberFlow
                      value={bill.totalAmount}
                      format={{
                        minimumFractionDigits: token === "USDC" ? 2 : 3,
                        maximumFractionDigits: token === "USDC" ? 2 : 6,
                      }}
                      prefix={getTokenSuffix(token)}
                      className="text-5xl font-medium text-white"
                    />
                    <p className="text-sm text-white/50 mt-1">
                      {progressPercent}% complete
                    </p>
                  </div>
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
                {/* Copy link – everyone */}
                <Button
                  onClick={handleCopyLink}
                  className="w-full bg-secondary text-white"
                >
                  <Copy className="w-12 h-12" />
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

            {!allPaid && (
              <>
                {!isRecipient && canPay && hasJoined && !isPaid && address ? (
                  <SplitPayButton
                    recipient={bill.recipient.address as `0x${string}`}
                    amount={parseFloat(eachShare)}
                    token={bill.token as TokenName}
                    splitId={safeSplitId}
                    onPaid={fetchBill}
                    payer={{
                      address,
                      name:
                        participantList.find(
                          (p) => p.address?.toLowerCase() === address.toLowerCase()
                        )?.name ?? "You",
                      fid: userFid,
                    }}
                    onSuccess={(data) => setPaymentSuccess(data)}
                    creatorFid={
                      bill.creator.fid !== null && bill.creator.fid !== undefined
                        ? Number(bill.creator.fid)
                        : undefined
                    }
                    description={bill.description}
                    ctaLabel="Contribute"
                  />
                ) : (
                  <Button
                    onClick={canJoin ? handleJoin : undefined}
                    disabled={!canJoin || isJoining}
                    className="w-full bg-primary mt-4"
                  >
                    {isJoining
                      ? "Joining..."
                      : canJoin
                        ? "Contribute"
                        : "Contribute unavailable"}
                  </Button>
                )}
             </>
            )}
          </>
        )}
      </Card>

      <ResponsiveDialog open={showMembersDialog} onOpenChange={setShowMembersDialog}>
        <ResponsiveDialogContent className="p-6 pb-8 md:max-w-md">
          <ResponsiveDialogTitle className="text-center text-lg">
            Members
          </ResponsiveDialogTitle>

          <ul className="mt-4 space-y-2">
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

              const invitedEntry = bill.invited?.find((entry) => sameEntry(entry, p));
              const participantEntry = participantList.find((entry) => sameEntry(entry, p));
              const paidAmount: number =
                paid?.amount ?? participantEntry?.amount ?? invitedEntry?.amount ?? 0;

              return (
                <li key={p.address} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <img
                      src={
                        p.pfp ||
                        `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${p.name}`
                      }
                      alt={p.name}
                      className="w-8 h-8 rounded-full object-cover"
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-white me-1">@{p.name}</span>
                      {paid ? (
                        <span className="bg-green-500/20 text-green-300 border border-green-500/30 px-1.5 text-[12px] rounded-[6px]">
                          Paid
                        </span>
                      ) : joined ? (
                        <span className="bg-yellow-600/20 text-yellow-400 border border-yellow-600/40 px-1.5 text-[12px] rounded-[6px]">
                          Joined
                        </span>
                      ) : (
                        <span className="bg-blue-600/20 text-blue-400 border border-blue-600/40 px-1.5 text-[12px] rounded-[6px]">
                          Invited
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="text-white/40 text-sm">
                    {`${getTokenSuffix(token)}${formatTokenAmount(paidAmount, token)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* SETTINGS DIALOG / SHEET */}
      <ResponsiveDialog
        open={showSettingsDrawer}
        onOpenChange={setShowSettingsDrawer}
      >
        <ResponsiveDialogContent className="p-6 pb-8 md:max-w-md">
          <ResponsiveDialogTitle className="text-center text-lg">
            Split Settings
          </ResponsiveDialogTitle>

          <p className="text-center text-white/40 mt-2">
            Waiting on payments? Send reminders
          </p>

          <Button
            onClick={notifyUnpaid}
            disabled={unpaidList.length === 0}
            className="w-full bg-white/5 text-white mt-4"
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
            className="w-full bg-red-500 text-white mt-2"
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
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* QR DIALOG / SHEET */}
      <ResponsiveDialog open={showQrDrawer} onOpenChange={setShowQrDrawer}>
        <ResponsiveDialogContent className="p-6 md:max-w-md">
          <ResponsiveDialogTitle className="text-center text-lg">
            Scan to pay your share
          </ResponsiveDialogTitle>

          {bill && canPay ? (
            <div className="flex flex-col items-center space-y-3 mt-4 mb-2">
              <Tilt
                glareEnable
                glareMaxOpacity={0.2}
                glareColor="#ffffff"
                glarePosition="all"
                scale={1.02}
                className="p-2 bg-white rounded-xl"
              >
                <QRCode
                  value={splitPaymentQrValue}
                  size={200}
                  logoImage="/newnewapp.png"
                  logoWidth={48}
                  logoHeight={48}
                  removeQrCodeBehindLogo
                />
              </Tilt>

              <p className="text-white/50 text-sm">
                Scan to open a payment request in your wallet.
              </p>
            </div>
          ) : (
            <div className="text-center py-10 text-white/60">
              <p className="text-lg font-medium">Payment unavailable</p>
              <p className="text-sm mt-1">
                You’re not eligible to pay for this split.
              </p>
            </div>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <PaymentSuccessDrawer
        isOpen={!!paymentSuccess}
        setIsOpen={(open) => {
          if (!open) setPaymentSuccess(null);
        }}
        name="Done"
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
