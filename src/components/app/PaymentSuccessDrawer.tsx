"use client";

import { useEffect } from "react";
import { Drawer } from "vaul";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useViewer } from "@/providers/FrameContextProvider";
import sdk from "@farcaster/frame-sdk";
import confetti from "canvas-confetti";
import { useAccount } from "wagmi";

interface PaymentSuccessDrawerProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  name: string;
  description?: string;
  recipientUsername?: string;
  txHash?: string;
  recipient?: {
  username?: string;
  address?: string;
};

}

export function PaymentSuccessDrawer({
  isOpen,
  setIsOpen,
  name,
  description,
  recipientUsername,
  txHash,
}: PaymentSuccessDrawerProps) {
  const { frameAdded } = useViewer();
  const { address } = useAccount();

  const handleAddFrame = useCallback(async () => {
    if (isOpen) setIsOpen(false);
    sdk.actions.addFrame();
  }, [setIsOpen, isOpen]);

  const handleShare = useCallback(async () => {
    if (isOpen) setIsOpen(false);

    const text = `${name}\n\n${description || ""}`;

    try {
      await sdk.actions.composeCast({
        text,
        embeds: ["https://usetab.app/"], // Add links or media if needed
      });
    } catch (err) {
      console.error("Failed to compose cast", err);
    }
  }, [name, description, setIsOpen, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    confetti({
      particleCount: 140,
      spread: 60,
      origin: { y: 0.8 },
    });
  }, [isOpen]);

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) setIsOpen(false);
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-[7.5px] z-20" />
        <Drawer.Content className="z-40 bg-background rounded-t-3xl p-4 fixed bottom-0 w-full max-h-[85vh] overflow-y-auto pb-8 mb-4">
          <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-4" />

          <div className="flex flex-col items-center pt-2 pb-1">
            <div className="flex items-center gap-1">
              <span className="text-xl font-semibold">That’s settled</span>
            </div>
          </div>

          <div className="py-2 px-3 space-y-4 rounded-t-[10px] flex-1 space-y-4">
            <p className="text-md text-center text-muted mb-4">
              Your payment went through successfully
            </p>

            <div className="w-full bg-white/[2%] rounded-xl p-4 mb-4 text-center">
              <p className="text-md text-muted">You paid</p>
              {description && (
                <p className="text-lg text-primary font-semibold">
                  {description}
                </p>
              )}

              {recipientUsername && (
                <p className="text-md text-muted">to @{recipientUsername}</p>
              )}
            </div>

            <Button className="w-full mb-2" onClick={() => setIsOpen(false)}>
              Done
            </Button>

            {txHash && (
              <Button
                variant="ghost"
                className="hidden w-full mb-2"
                onClick={() =>
                  sdk.actions.openUrl(`https://basescan.org/tx/${txHash}`)
                }
              >
                View transaction
              </Button>
            )}

            <Button
              variant="outline"
              className="hidden w-full"
              onClick={handleShare}
            >
              Share (optional)
            </Button>

            {/* {txHash && (
              <Button
                variant="outline"
                className="w-full mt-4 mb-2"
                onClick={() => {
                  sdk.actions.openUrl(`https://basescan.org/tx/${txHash}`);
                }}
              >
                View tx
              </Button>
            )}
            <Button className="w-full bg-white mb-6 pb-6" onClick={handleShare}>
              🎊 Share to Feed
            </Button> */}
          </div>

          <div className="pb-[env(safe-area-inset-bottom)]" />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
