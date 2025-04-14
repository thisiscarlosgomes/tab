"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import sdk from "@farcaster/frame-sdk";
import { QRCode } from "react-qrcode-logo";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SplitPayButton } from "@/components/app/splitPayButton";
import { PaymentSuccessDrawer } from "@/components/app/PaymentSuccessDrawer";
// import { useAddPoints } from "@/lib/useAddPoints";
import Tilt from "react-parallax-tilt";
// import { shortAddress } from "@/lib/shortAddress";
import {
  Loader,
  ReceiptText,
  Copy,
  CopyCheck,
  BellRing,
  Share,
} from "lucide-react";
import { tokenList } from "@/lib/tokens"; // or define inline
import { getTokenPrices } from "@/lib/getTokenPrices";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import { getShareUrl } from "@/lib/share";
import { useAddPoints } from "@/lib/useAddPoints";
import { toast } from "sonner";

interface Participant {
  address: string;
  name: string;
  pfp?: string;
  fid?: string;
}

interface Paid {
  address: string;
  name: string;
  txHash: string;
}

interface SplitBill {
  splitId: string;
  code: string; // ✅ Add this line
  creator: Participant;
  description: string;
  totalAmount: number;
  numPeople: number;
  token: string;
  participants?: Participant[];
  paid?: Paid[];
}

type TokenName = (typeof tokenList)[number]["name"];

export default function SplitPage() {
  const { splitId } = useParams();
  const safeSplitId = Array.isArray(splitId) ? splitId[0] : (splitId ?? "");
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();

  const [bill, setBill] = useState<SplitBill | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasPaid, setHasPaid] = useState(false); // Add this line
  const [showSuccess, setShowSuccess] = useState(false);
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const { dismiss } = useFrameSplash();

  useEffect(() => {
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    const fetchPrices = async () => {
      const prices = await getTokenPrices();
      setTokenPrices(prices);
    };
    fetchPrices();
  }, []);

  const formatAmount = (amount: number, token: string) => {
    const decimals = token === "USDC" || token === "EURC" ? 2 : 4;
    return amount.toFixed(decimals);
  };

  const formatUsd = (usd: number) =>
    usd >= 0.01 ? usd.toFixed(2) : usd.toPrecision(2);

  const token = bill?.token;
  const tokenInfo = tokenList.find((t) => t.name === token);
  const fallbackToken = tokenList.find((t) => t.name === "ETH");
  const effectiveTokenInfo = tokenInfo ?? fallbackToken;
  const priceUsd = tokenPrices[token ?? "ETH"] ?? null;
  const eachAmount =
    bill?.totalAmount && bill?.numPeople
      ? bill.totalAmount / bill.numPeople
      : 0;
  const eachAmountFormatted = formatAmount(eachAmount, token ?? "ETH");
  const totalAmountFormatted = formatAmount(
    bill?.totalAmount ?? 0,
    token ?? "ETH"
  );
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const totalUsd = priceUsd
    ? formatUsd((bill?.totalAmount ?? 0) * priceUsd)
    : null;
  const eachUsd = priceUsd ? formatUsd(eachAmount * priceUsd) : null;

  const fetchBill = async () => {
    const res = await fetch(`/api/split/${safeSplitId}`);
    const data = await res.json();
    setBill(data);
  };

  useEffect(() => {
    fetchBill();
    const interval = setInterval(fetchBill, 5000);
    return () => clearInterval(interval);
  }, [safeSplitId]);

  const handleJoin = async () => {
    if (!isConnected) await connect({ connector: farcasterFrame() });
    if (!address) return;

    const context = await sdk.context;
    const participant: Participant = {
      address,
      name: context.user?.username ?? address.slice(0, 6),
      pfp: context.user?.pfpUrl ?? "",
      fid: context.user?.fid?.toString() ?? "",
    };

    setIsJoining(true);

    await fetch(`/api/split/${safeSplitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant }),
    });

    fetchBill();
    setIsJoining(false);
  };

  const hasJoined = !!bill?.participants?.some(
    (p) => p.address.toLowerCase() === address?.toLowerCase()
  );

  const isCreator =
    !!address &&
    bill?.creator?.address?.toLowerCase() === address.toLowerCase();

  const eachShare =
    bill?.totalAmount && bill?.numPeople
      ? (bill.totalAmount / bill.numPeople).toFixed(4)
      : "0";

  const paidList = bill?.paid ?? [];
  const participantList = bill?.participants ?? [];

  const unpaidList = participantList.filter(
    (p) =>
      !paidList.some(
        (paid) => paid.address.toLowerCase() === p.address.toLowerCase()
      )
  );

  const handleCopy = () => {
    if (!bill?.code) return;
    navigator.clipboard.writeText(bill.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    // If user is in the paid list, mark hasPaid as true
    if (
      paidList.some((p) => p.address.toLowerCase() === address?.toLowerCase())
    ) {
      setHasPaid(true);
    }
  }, [paidList, address]);

  const tokenIcon = effectiveTokenInfo?.icon ? (
    <img
      src={effectiveTokenInfo.icon}
      alt={effectiveTokenInfo.name}
      className="absolute bottom-0 -right-2 w-7 h-7 rounded-full border-2 border-background"
    />
  ) : null;

  const handleShare = async () => {
    const url = getShareUrl({
      name: bill?.description ?? "Group Bill",
      description: "Split the bill, pay your share.",
      url: `https://tab.castfriends.com/split/${bill?.splitId}`,
    });

    sdk.actions.openUrl(url);

    if (address) {
      await useAddPoints(address, "share_frame");
    }
  };

  const handleCopyUrl = (copyUrl: string) => {
    navigator.clipboard.writeText(copyUrl);
    setCopiedCode(copyUrl);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const copyUrl = `https://tab.castfriends.com/split/${bill?.splitId}`;

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
              fid: parseInt(p.fid),
              title: "🧾 Payment Reminder",
              message: `Hey @${p.name}, don't forget to pay your share for "${bill?.description}" 💸`,
              targetUrl: `https://tab.castfriends.com/split/${bill?.splitId}`, // or your intended link
            }),
          });
        })
      ),
      {
        loading: "Sending reminders...",
        success: `Notified ${unpaidList.length} unpaid friend${unpaidList.length > 1 ? "s" : ""}`,
        error: "Something went wrong sending reminders",
      }
    );
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-20 pb-32 overflow-y-auto scrollbar-hide">
      <Card className="w-full max-w-md p-6 flex flex-col space-y-4 rounded-lg">
        {!bill ? (
          <div className="flex flex-1 items-center justify-center min-h-[60vh]">
            <Loader className="w-8 h-8 animate-spin text-white/30" />
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center">
              <div className="hidden relative w-16 h-16 rounded-full bg-purple-100 text-purple-800 flex items-center justify-center">
                <ReceiptText className="w-7 h-7" />
                {tokenIcon}
              </div>
              <img
                src="/ethcoin.png"
                alt="cover"
                className="w-16 h-16 animate-subtleBounce"
              />
              <h1 className="text-xl font-bold text-center capitalize">
                {bill.description} group bill
              </h1>
              <p className="text-primary">by @{bill.creator.name} </p>
            </div>

            <div className="border rounded-lg p-4 mt-2">
              <div className="text-sm text-center">
                <p className="text-center text-base">
                  <strong className="text-primary">
                    {totalAmountFormatted} {token}
                  </strong>{" "}
                  split between{" "}
                  <strong className="text-primary">
                    {bill.numPeople} people
                  </strong>
                </p>
                {totalUsd && (
                  <p className="text-center text-sm text-white/30 hidden">
                    ≈ ${totalUsd}
                  </p>
                )}
                <p className="text-center text-base mt-1">
                  Each pays:{" "}
                  <strong className="text-primary">
                    {eachAmountFormatted} {token}
                  </strong>
                </p>
                {eachUsd && (
                  <p className="text-center text-sm text-white/30 hidden">
                    ≈ ${eachUsd}
                  </p>
                )}
              </div>
              {isCreator && (
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
                      handleCopyUrl(copyUrl);
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
                  <Button
                    onClick={notifyUnpaid}
                    disabled={unpaidList.length === 0}
                    className="w-full bg-secondary text-white mt-3"
                  >
                    <BellRing className="w-12 h-12" />
                  </Button>
                </div>
              )}
            </div>

            {isCreator ? (
              <div className="mt-4 flex flex-col items-center space-y-2">
                <Tilt
                  glareEnable={true}
                  glareMaxOpacity={0.8}
                  glareColor="#ffffff"
                  glarePosition="all"
                  glareBorderRadius="16px" // same as your Tailwind rounded-xl
                  scale={1.03}
                  tiltMaxAngleX={8}
                  tiltMaxAngleY={8}
                  className="p-2 bg-white rounded-xl mb-1"
                >
                  <div>
                    <QRCode
                      value={`https://tab.castfriends.com/join-split?splitId=${bill.splitId}&payTo=${bill.creator.address}&amount=${eachShare}&token=${bill.token ?? "ETH"}`}
                      size={200}
                      logoImage="/splash.png"
                      logoWidth={48}
                      logoHeight={48}
                      logoOpacity={1}
                      removeQrCodeBehindLogo
                    />
                    <Button
                      onClick={handleCopy}
                      className="bg-primary w-full hidden"
                    >
                      {copied ? "Copied!" : `Copy Code: ${bill.code}`}
                    </Button>
                  </div>
                </Tilt>
              </div>
            ) : (
              <>
                {hasJoined &&
                  address &&
                  !paidList.some(
                    (p) => p.address.toLowerCase() === address.toLowerCase()
                  ) && (
                    <SplitPayButton
                      recipient={bill.creator.address as `0x${string}`}
                      amount={parseFloat(eachShare)}
                      token={bill.token as TokenName}
                      splitId={safeSplitId}
                      onPaid={fetchBill}
                      payer={{
                        address,
                        name:
                          bill.participants?.find(
                            (p) =>
                              p.address.toLowerCase() === address.toLowerCase()
                          )?.name || "You",
                      }}
                      setShowSuccess={setShowSuccess}
                      creatorFid={
                        bill.creator.fid
                          ? parseInt(bill.creator.fid)
                          : undefined
                      } // ✅ fixed
                      description={bill.description}
                    />
                  )}

                <div className="mt-2">
                  {hasJoined ? (
                    <div className="flex flex-col items-center space-y-2">
                      <p className="text-base font-semibold text-active">
                        {hasPaid ? "You've Paid!" : "You've Joined!"}
                      </p>
                    </div>
                  ) : (
                    <Button
                      onClick={handleJoin}
                      disabled={isJoining}
                      className="w-full bg-primary"
                    >
                      {isJoining ? "Joining..." : "Join Bill"}
                    </Button>
                  )}
                </div>
              </>
            )}

            {(paidList.length > 0 || unpaidList.length > 0) && (
              <div className="mt-4 text-sm text-muted space-y-4">
                {paidList.length > 0 && (
                  <div>
                    <p className="mb-1">✅ Paid:</p>
                    <ul className="space-y-1">
                      {paidList.map((p) => (
                        <li key={p.address}>
                          <span className="text-white">@{p.name}</span>
                          <a
                            href={`https://basescan.org/tx/${p.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hidden"
                          >
                            View tx
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {unpaidList.length > 0 && (
                  <div>
                    <p className="mb-2">⏳ Waiting on:</p>
                    <ul className="space-y-2">
                      {unpaidList.map((p) => (
                        <li
                          key={p.address}
                          className="flex items-center gap-2 mb-2"
                        >
                          <img
                            src={
                              p.pfp ||
                              `https://api.dicebear.com/9.x/glass/svg?seed=${p.name}`
                            }
                            alt={p.name}
                            className="w-7 h-7 rounded-full border-2 border-white object-cover"
                          />
                          <span className="text-white">{p.name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      <div className="w-full max-w-md mt-4 px-16">
        <p className="text-center text-sm opacity-30">
          Friends can scan this and pay you instantly with Tab on Farcaster.
        </p>
      </div>
      <PaymentSuccessDrawer
        isOpen={showSuccess}
        setIsOpen={setShowSuccess}
        name="Tab Paid"
      />
    </div>
  );
}
