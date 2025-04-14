"use client";

import { useEffect, useRef, useState } from "react";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import {
  useAccount,
  useConnect,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { tokenList } from "@/lib/tokens";
import { erc20Abi, parseUnits } from "viem";
import { useAddPoints } from "@/lib/useAddPoints"; // ✅ ensure this is imported

interface SplitPayButtonProps {
  recipient: `0x${string}`;
  amount: number;
  token: string; // support any from tokenList
  splitId: string;
  onPaid: () => void;
  payer: {
    address: string;
    name: string;
  };
  setShowSuccess: (open: boolean) => void;
  creatorFid?: number;
  description?: string;
}

export function SplitPayButton({
  recipient,
  amount,
  token,
  splitId,
  onPaid,
  payer,
  setShowSuccess,
  creatorFid,
  description,
}: SplitPayButtonProps) {
  const { isConnected, address } = useAccount();
  const { connect } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [hasPaid, setHasPaid] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const successHandled = useRef(false);

  useEffect(() => {
    if (isSuccess && txHash && !successHandled.current) {
      successHandled.current = true;

      const handlePostPayment = async () => {
        await fetch(`/api/split/${splitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment: {
              address: payer.address,
              name: payer.name,
              txHash,
              status: "paid",
              token, // ✅ include token info
            },
          }),
        });

        // ✅ Reward user for paying a split
        await useAddPoints(payer.address, "pay", undefined, splitId);

        if (creatorFid) {
          try {
            await fetch("/api/send-notif", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fid: creatorFid,
                amount,
                token,
                senderUsername: payer.name,
                title: "💸 You received a payment",
                message: `Just paid their share${
                  description ? ` for "${description}"` : ""
                }.`,
                targetUrl: `https://tab.castfriends.com/split/${splitId}`, // or your intended link
              }),
            });
          } catch (err) {
            console.warn("Split payment notification failed:", err);
          }
        }

        setShowSuccess(true);
        onPaid();
        setHasPaid(true);
        setIsProcessing(false);
      };

      handlePostPayment();
    }
  }, [
    isSuccess,
    txHash,
    splitId,
    payer,
    onPaid,
    creatorFid,
    amount,
    token,
    description,
  ]);

  const handleClick = async () => {
    if (!isConnected || !address) {
      await connect({ connector: farcasterFrame() });
      return;
    }

    const tokenInfo = tokenList.find((t) => t.name === token);
    if (!tokenInfo) {
      toast.error(`Unsupported token: ${token}`);
      return;
    }

    const decimals = tokenInfo.decimals ?? 18;
    const rawAmount = parseUnits(amount.toString(), decimals);

    setIsProcessing(true);

    try {
      let hash: `0x${string}`;

      if (!tokenInfo.address) {
        // Native ETH
        const tx = await sendTransactionAsync({
          to: recipient,
          value: rawAmount,
          chainId: 8453,
        });
        hash = tx;
      } else {
        // ERC-20 transfer
        const tx = await writeContractAsync({
          address: tokenInfo.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "transfer",
          args: [recipient, rawAmount],
          chainId: 8453,
        });
        hash = tx;
      }

      setTxHash(hash);
    } catch (err) {
      console.error("Payment failed", err);
      toast.error("Payment failed. Try again.");
      setIsProcessing(false);
    }
  };

  return (
    <Button
      onClick={handleClick}
      className="w-full mt-4"
      disabled={hasPaid || isProcessing || !!txHash}
    >
      {isProcessing
        ? "⏳ Processing..."
        : hasPaid
          ? "✅ Paid"
          : `💸 Pay ${amount} ${token}`}
    </Button>
  );
}
