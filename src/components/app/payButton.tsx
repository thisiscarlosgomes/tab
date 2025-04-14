"use client";

import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { Button } from "@/components/ui/button";
import { useAddPoints } from "@/lib/useAddPoints";
import { tokenList } from "@/lib/tokens";
import { erc20Abi, parseUnits } from "viem";

interface PayButtonProps {
  recipient: `0x${string}`;
  amount: number;
  onlyIf: boolean;
  onPay: () => void;
  payer: {
    address: string;
    name: string;
  };
  roomId: string;
  setShowSuccess: (open: boolean) => void;
  token?: string; // new
}

export function PayButton({
  recipient,
  amount,
  onlyIf,
  onPay,
  payer,
  roomId,
  setShowSuccess,
  token = "ETH", // default
}: PayButtonProps) {
  const { isConnected, address } = useAccount();
  const { connect } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const [hash, setHash] = useState<`0x${string}`>();
  const [hasPaid, setHasPaid] = useState(false);
  const [isPaying, setIsPaying] = useState(false);

  const { isSuccess } = useWaitForTransactionReceipt({ hash });
  const successHandled = useRef(false);

  const tokenInfo = tokenList.find((t) => t.name === token);
  const decimals = tokenInfo?.decimals ?? 18;

  function formatAmount(amount: number): string {
    return amount < 0.01 ? amount.toFixed(6) : amount.toFixed(2);
  }

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
            token,
          },
        }),
      });

      await useAddPoints(payer.address, "pay", roomId);

      setHasPaid(true);
      setShowSuccess(true);
      setIsPaying(false);
      onPay();
    };

    if (isSuccess && !successHandled.current) {
      successHandled.current = true;
      handleSuccess();
    }
  }, [isSuccess, hash, payer, roomId, onPay, setShowSuccess, token]);

  const handleClick = async () => {
    if (!isConnected || !address) {
      await connect({ connector: farcasterFrame() });
      return;
    }

    setIsPaying(true);

    if (!tokenInfo) {
      console.error(`Invalid token: ${token}`);
      setIsPaying(false);
      return;
    }

    const value = parseUnits(amount.toString(), decimals);

    try {
      let txHash: `0x${string}`;

      if (!tokenInfo?.address) {
        // Native ETH
        txHash = await sendTransactionAsync({
          to: recipient,
          value,
          chainId: 8453,
        });
      } else {
        // ERC-20 transfer
        txHash = await writeContractAsync({
          address: tokenInfo.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "transfer",
          args: [recipient, value],
          chainId: 8453,
        });
      }

      setHash(txHash);
    } catch (err) {
      console.error("Transaction failed", err);
      setIsPaying(false);
    }
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
          ? `⏳ Sending ${formatAmount(amount)} ${token}...`
          : `💸 Pay ${formatAmount(amount)} ${token}`}
    </Button>
  );
}
