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
import { shortAddress } from "@/lib/shortAddress";
import { Loader } from "lucide-react";

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
  participants?: Participant[];
  paid?: Paid[];
}

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

    // Optional: Add points for joining
    // await useAddPoints(address, "invite", undefined, safeSplitId);

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

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-20 pb-32 overflow-y-auto hide-scrollbar">
      <Card className="w-full max-w-md p-6 flex flex-col space-y-4 rounded-lg">
        {!bill ? (
           <div className="flex flex-1 items-center justify-center min-h-[60vh]">
           <Loader className="w-8 h-8 animate-spin text-white/30" />
         </div>
        ) : (
          <>
            <h1 className="text-xl font-bold text-center">
              {bill.description} Bill
            </h1>

            <div className="border rounded-lg p-4 mt-2">
              <div className="text-sm text-center">
                <p className="text-center text-base">
                  <strong className="text-primary">
                    {bill.totalAmount} ETH
                  </strong>{" "}
                  split between{" "}
                  <strong className="text-primary">
                    {bill.numPeople} people
                  </strong>{" "}
                </p>
                <p className="text-center text-base text-">
                  Each pays:{" "}
                  <strong className="text-primary">{eachShare} ETH</strong>
                </p>
              </div>
            </div>

            {isCreator ? (
              <div className="mt-4 flex flex-col items-center space-y-2">
                <div className="flex flex-col items-center mt-1 mb-2">
                  <QRCode
                    value={`https://tab.castfriends.com/join-split?splitId=${bill.splitId}&payTo=${bill.creator.address}&amount=${eachShare}`}
                    size={200}
                    logoImage="/splash.png"
                    logoWidth={48}
                    logoHeight={48}
                    logoOpacity={1}
                    removeQrCodeBehindLogo
                  />
                  <span className="text-sm text-primary mt-3">
                    {shortAddress(bill.creator.address)}
                  </span>
                </div>
                <Button onClick={handleCopy} className="bg-primary w-full">
                  {copied ? "Copied!" : `Share Code: ${bill.code}`}
                </Button>
                <p className="text-base font-semibold text-active pt-2">
                  You created this bill
                </p>
              </div>
            ) : (
              <>
                {hasJoined &&
                  address &&
                  !paidList.some(
                    (p) => p.address.toLowerCase() === address.toLowerCase()
                  ) && (
                    // <SplitPayButton
                    //   recipient={bill.creator.address as `0x${string}`}
                    //   amountEth={parseFloat(eachShare)}
                    //   splitId={safeSplitId}
                    //   onPaid={fetchBill}
                    //   payer={{
                    //     address,
                    //     name:
                    //       bill.participants?.find(
                    //         (p) =>
                    //           p.address.toLowerCase() === address.toLowerCase()
                    //       )?.name || "You",
                    //   }}
                    //   setShowSuccess={setShowSuccess}
                    // />
                    <SplitPayButton
                      recipient={bill.creator.address as `0x${string}`}
                      amountEth={parseFloat(eachShare)}
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
                              `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${p.name}`
                            }
                            alt={p.name}
                            className="w-6 h-6 rounded-full border-2 border-white object-cover"
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

      <PaymentSuccessDrawer
        isOpen={showSuccess}
        setIsOpen={setShowSuccess}
        name="Tab Paid"
      />
    </div>
  );
}
