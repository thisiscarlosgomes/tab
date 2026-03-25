"use client";

import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { erc20Abi, parseUnits } from "viem";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { tokenList } from "@/lib/tokens";
import { BUILDER_CODE_DATA_SUFFIX } from "@/lib/builderCode";

interface SplitPayButtonProps {
  recipient: `0x${string}`;
  amount: number;
  token: string; // must exist in tokenList
  splitId: string;
  onPaid: () => void;
  payer: {
    address: string;
    name: string;
    fid?: number | null;
    userKey?: string;
  };
  onSuccess: (data: {
    amount: number;
    token: string;
    recipientUsername?: string;
    txHash?: string;
  }) => void;

  creatorFid?: number;
  description?: string;
  ctaLabel?: string;
}

export function SplitPayButton({
  recipient,
  amount,
  token,
  splitId,
  onPaid,
  payer,
  onSuccess,
  creatorFid,
  description,
  ctaLabel,
}: SplitPayButtonProps) {
  const { isConnected, address } = useAccount();
  const { connect, connectors } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [isProcessing, setIsProcessing] = useState(false);

  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const successHandled = useRef(false);

  /* ----------------------------------
     Handle on-chain success
  ---------------------------------- */
  useEffect(() => {
    if (!isSuccess || !txHash || successHandled.current) return;

    successHandled.current = true;
    setIsProcessing(false);

    // 1. UX FIRST: show success immediately
    onSuccess({
      amount,
      token,
      recipientUsername: payer.name,
      txHash,
    });
    if (typeof window !== "undefined") {
      if (token === "USDC") {
        window.dispatchEvent(
          new CustomEvent("tab:balance-updated", {
            detail: { deltaUsdc: -amount },
          })
        );
      } else {
        window.dispatchEvent(new Event("tab:balance-updated"));
      }
    }

    // 2. Fire-and-forget side effects
    void handlePostPayment();
  }, [isSuccess, txHash]);

  /* ----------------------------------
     Post-payment side effects
  ---------------------------------- */
  const handlePostPayment = async () => {
    // 1. Update split state (FID is canonical)
    try {
      const res = await fetch(`/api/split/${splitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment: {
            fid: payer.fid,
            userKey:
              payer.userKey ??
              (address ? `wallet:${address.toLowerCase()}` : undefined),
            address,
            name: payer.name,
            txHash,
            status: "paid",
            token,
            amount,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json();

        if (err?.error?.toLowerCase?.().includes("already")) {
          toast.error("You already paid for this split.");
          return;
        }

        throw new Error(err?.error ?? "Failed to update split");
      }
    } catch (err) {
      console.warn("Split update failed:", err);
      toast.error("Payment recorded on-chain, but split update failed.");
      return;
    }

    // 2. Incoming payment notifications are sent by the Moralis webhook to avoid duplicates.

    // 3. Local UI refresh
    onPaid();
  };

  /* ----------------------------------
     Handle click
  ---------------------------------- */
  const handleClick = async () => {
    // Prevent double taps
    if (isProcessing || txHash) return;

    // Connect wallet if needed
    if (!isConnected || !address) {
      setIsProcessing(true);
      try {
        const preferred =
          connectors.find((c) => c.id === "injected") ?? connectors[0];
        if (!preferred) {
          toast.error("No wallet connector available");
          return;
        }
        await connect({ connector: preferred });
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    // Pre-flight: prevent duplicate payment by FID
    try {
      const res = await fetch(`/api/split/${splitId}`);
      const bill = await res.json();
      const currentKey =
        payer.userKey ?? (address ? `wallet:${address.toLowerCase()}` : null);

      if (
        bill?.paid?.some(
          (p: any) =>
            (currentKey && p.userKey === currentKey) ||
            (p.address &&
              address &&
              p.address.toLowerCase() === address.toLowerCase())
        )
      ) {
        toast.error("You already paid for this split.");
        return;
      }
    } catch {
      // fail open — backend still protects
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

      // Native ETH
      if (!tokenInfo.address) {
        hash = await sendTransactionAsync({
          to: recipient,
          value: rawAmount,
          chainId: 8453,
          dataSuffix: BUILDER_CODE_DATA_SUFFIX,
        });
      } else {
        // ERC20
        hash = await writeContractAsync({
          address: tokenInfo.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "transfer",
          args: [recipient, rawAmount],
          chainId: 8453,
          dataSuffix: BUILDER_CODE_DATA_SUFFIX,
        });
      }

      setTxHash(hash);
    } catch (err) {
      console.error("Payment failed", err);
      toast.error("Payment failed. Try again.");
      setIsProcessing(false);
    }
  };

  /* ----------------------------------
     Render
  ---------------------------------- */
  return (
    <Button
      onClick={handleClick}
      className="w-full mt-4"
      disabled={isProcessing || !!txHash}
    >
      {isProcessing
        ? "Processing…"
        : txHash
          ? "Paid"
          : (ctaLabel ?? `Pay ${amount} ${token}`)}
    </Button>
  );
}
