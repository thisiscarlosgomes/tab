"use client";

import { useEffect, useRef, useState } from "react";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import {
  useAccount,
  useConnect,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { toast } from "sonner";


// interface SplitPayButtonProps {
//   recipient: `0x${string}`;
//   amountEth: number;
//   splitId: string;
//   onPaid: () => void;
//   payer: {
//     address: string;
//     name: string;
//   };
//   setShowSuccess: (open: boolean) => void;
// }

interface SplitPayButtonProps {
  recipient: `0x${string}`;
  amountEth: number;
  splitId: string;
  onPaid: () => void;
  payer: {
    address: string;
    name: string;
  };
  setShowSuccess: (open: boolean) => void;
  creatorFid?: number; // ✅ optional
  description?: string; // ✅ optional
}

export function SplitPayButton({
  recipient,
  amountEth,
  splitId,
  onPaid,
  payer,
  setShowSuccess,
  creatorFid,
  description, // ✅ Add this line
}: SplitPayButtonProps) {
  const { isConnected, address } = useAccount();
  const { connect } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [hasPaid, setHasPaid] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); // Track processing state

  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const successHandled = useRef(false);


  useEffect(() => {
    if (isSuccess && txHash && !successHandled.current) {
      successHandled.current = true;

      const handlePostPayment = async () => {
        // 1. Mark as paid in DB
        await fetch(`/api/split/${splitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment: {
              address: payer.address,
              name: payer.name,
              txHash,
              status: "paid",
            },
          }),
        });

        // 2. Notify admin if they have a fid
        if (creatorFid) {
          const notifRes = await fetch("/api/send-notif", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fid: creatorFid,
              amount: amountEth,
              senderUsername: payer.name,
              message: `Just paid their share${description ? ` for "${description}"` : ""}`,
            }),
          });
        
          if (notifRes.ok) {
            toast.success("The creator has been notified.");
          } else {
            toast.warning("Payment succeeded but notification may not have been delivered.");
          }
        }
        
       

        // 3. Final updates
        setShowSuccess(true);
        onPaid();
        setHasPaid(true);
        setIsProcessing(false);
      };

      handlePostPayment(); // 👈 run it
    }
  }, [
    isSuccess,
    txHash,
    splitId,
    payer,
    onPaid,
    creatorFid,
    amountEth,
    description,
  ]);

  const handleClick = async () => {
    if (!isConnected || !address) {
      await connect({ connector: farcasterFrame() });
      return;
    }

    // Start processing payment
    setIsProcessing(true);

    const hash = await sendTransactionAsync({
      to: recipient,
      value: BigInt(amountEth * 1e18),
      chainId: 8453, // Base mainnet
    });

    setTxHash(hash);
  };

  return (
    <>
      <Button
        onClick={handleClick}
        className="w-full mt-4"
        disabled={hasPaid || isProcessing || !!txHash}
      >
        {isProcessing
          ? "⏳ Processing Payment..."
          : hasPaid
            ? "✅ Paid"
            : `💸 Pay ${amountEth} ETH`}
      </Button>
    </>
  );
}
