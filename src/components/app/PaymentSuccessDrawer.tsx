"use client";

import { useEffect } from "react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import confetti from "canvas-confetti";

interface PaymentSuccessDrawerProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  name: string;
  description?: string;
  recipientUsername?: string;
  txHash?: string;
}

export function PaymentSuccessDrawer({
  isOpen,
  setIsOpen,
  name,
  description,
  recipientUsername,
  txHash,
}: PaymentSuccessDrawerProps) {
  const handleShare = useCallback(async () => {
    if (isOpen) setIsOpen(false);

    const text = `${name}\n\n${description || ""}`;

    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text, url: "https://usetab.app/" });
        return;
      }
      if (typeof window !== "undefined") {
        window.open("https://x.com/intent/post?text=" + encodeURIComponent(text));
      }
    } catch {}
  }, [name, description, setIsOpen, isOpen]);

  const openTx = useCallback(() => {
    if (!txHash) return;
    if (typeof window !== "undefined") {
      window.open(`https://basescan.org/tx/${txHash}`, "_blank");
    }
  }, [txHash]);

  useEffect(() => {
    if (!isOpen) return;

    confetti({
      particleCount: 140,
      spread: 60,
      origin: { y: 0.8 },
    });
  }, [isOpen]);

  return (
    <ResponsiveDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) setIsOpen(false);
      }}
    >
      <ResponsiveDialogContent className="top-auto bottom-0 w-full rounded-t-3xl border-white/10 bg-background px-4 pb-8 pt-2 md:top-1/2 md:bottom-auto md:max-w-md md:-translate-y-1/2 md:rounded-3xl md:px-6 md:pt-6">
        <ResponsiveDialogHeader className="items-center space-y-3 pb-2 text-center">
          <ResponsiveDialogTitle className="text-center text-xl font-semibold tracking-tight text-white">
            That&apos;s settled
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-center text-base text-white/50">
            Your payment went through successfully
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="px-0 py-3">
          <div className="w-full rounded-2xl border border-white/6 bg-white/[0.03] px-5 py-6 text-center">
            <p className="text-base text-white/45">You paid</p>
            {description ? (
              <p className="mt-2 text-2xl font-semibold tracking-tight text-primary">
                {description}
              </p>
            ) : null}
            {recipientUsername ? (
              <p className="mt-2 text-base text-white/45">to @{recipientUsername}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <Button className="w-full" onClick={() => setIsOpen(false)}>
            Done
          </Button>

          {txHash ? (
            <Button
              variant="ghost"
              className="hidden w-full"
              onClick={openTx}
            >
              View transaction
            </Button>
          ) : null}

          <Button
            variant="outline"
            className="hidden w-full"
            onClick={handleShare}
          >
            Share (optional)
          </Button>
        </div>

        <div className="pb-[env(safe-area-inset-bottom)]" />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
