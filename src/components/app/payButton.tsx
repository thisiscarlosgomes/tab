"use client";

import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from "wagmi";
import { Button } from "@/components/ui/button";
import { useAddPoints } from "@/lib/useAddPoints"; // make sure path matches

interface PayButtonProps {
  recipient: `0x${string}`;
  amountEth: number;
  onlyIf: boolean;
  onPay: () => void;
  payer: {
    address: string;
    name: string;
  };
  roomId: string;
  setShowSuccess: (open: boolean) => void; // ✅ passed from RoomPage
}

export function PayButton({
  recipient,
  amountEth,
  onlyIf,
  onPay,
  payer,
  roomId,
  setShowSuccess, // ✅ use this instead of internal state
}: PayButtonProps) {
  const { isConnected, address } = useAccount();
  const { connect } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();

  const [hash, setHash] = useState<`0x${string}`>();
  const [hasPaid, setHasPaid] = useState(false);
  const [isPaying, setIsPaying] = useState(false);

  const { isSuccess } = useWaitForTransactionReceipt({ hash });
  const successHandled = useRef(false);

  useEffect(() => {
    const handleSuccess = async () => {
      if (!payer?.address || !payer?.name || !hash || !roomId) return;

      await fetch(`/api/game/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: payer.address,
          payment: {
            address: payer.address,
            name: payer.name,
            txHash: hash,
          },
        }),
      });

      await useAddPoints(payer.address, "pay", roomId);

      setHasPaid(true);
      setShowSuccess(true); // ✅ open the drawer from parent
      setIsPaying(false);
      onPay();
    };

    if (isSuccess && !successHandled.current) {
      successHandled.current = true;
      handleSuccess();
    }
  }, [isSuccess, hash, payer, roomId, onPay, setShowSuccess]);

  const handleClick = async () => {
    if (!isConnected || !address) {
      await connect({ connector: farcasterFrame() });
      return;
    }

    setIsPaying(true);

    const txHash = await sendTransactionAsync({
      to: recipient,
      value: BigInt(amountEth * 1e18),
      chainId: 8453,
    });

    setHash(txHash);
  };

  if (!onlyIf) return null;

  return (
    <Button
      onClick={handleClick}
      disabled={hasPaid || !!hash || isPaying}
      className="w-full mt-4"
    >
      {hasPaid
        ? "✅ Paid"
        : isPaying
          ? "⏳ Processing Payment..."
          : `💸 Pay ${amountEth} ETH`}
    </Button>
  );
}
