// src/components/PaymentSuccessScreen.tsx
"use client";

import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  txHash: string;
  recipientUsername: string;
  onDone: () => void;
};

export default function PaymentSuccessScreen({
  txHash,
  recipientUsername,
  onDone,
}: Props) {
  const txUrl = `https://basescan.org/tx/${txHash}`;

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      <CheckCircle className="w-16 h-16 text-green-500 mb-6" />
      <h2 className="text-2xl font-semibold mb-2">Payment Sent</h2>
      <p className="text-white/70 mb-4">
        You just sent ETH to <span className="text-primary">@{recipientUsername}</span>
      </p>
      <a
        href={txUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline text-sm mb-8"
      >
        View on explorer
      </a>
      <Button onClick={onDone} className="bg-primary w-full max-w-xs">
        Done
      </Button>
    </div>
  );
}
