"use client";

import { useEffect, useRef } from "react";

import { Drawer } from "vaul";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { getShareUrl } from "@/lib/share";
import { useViewer } from "@/providers/FrameContextProvider";
import sdk from "@farcaster/frame-sdk";
import confetti from "canvas-confetti";
import { useAddPoints } from "@/lib/useAddPoints";
import { useAccount } from "wagmi";

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
  const { frameAdded } = useViewer();
  const { address } = useAccount();
  const hasGivenPoints = useRef(false); // prevent repeat calls

  // const handleAddFrame = useCallback(async () => {
  //   if (isOpen) setIsOpen(false);
  //   sdk.actions.addFrame();

  //   if (address) {
  //     await useAddPoints(address, "add_frame");
  //   }
  // }, [setIsOpen, isOpen, address]);

  const handleAddFrame = useCallback(async () => {
    if (isOpen) setIsOpen(false);

    sdk.actions.addFrame();

    // Delay to give time for the user to possibly complete the action
    setTimeout(async () => {
      if (address) {
        await useAddPoints(address, "add_frame");
      }
    }, 4000); // 4 seconds buffer
  }, [setIsOpen, isOpen, address]);

  const handleShare = useCallback(async () => {
    if (isOpen) setIsOpen(false);
    const url = getShareUrl({ name, description });
    sdk.actions.openUrl(url);

    if (address) {
      await useAddPoints(address, "share_frame");
    }
  }, [name, description, setIsOpen, isOpen, address]);

  useEffect(() => {
    if (isOpen) {
      confetti({
        particleCount: 190,
        spread: 70,
        origin: { y: 0.9 },
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (frameAdded && address && !hasGivenPoints.current) {
      useAddPoints(address, "add_frame");
      hasGivenPoints.current = true;
    }
  }, [frameAdded, address]);

  return (
    <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-[7.5px] z-20" />
        <Drawer.Content className="z-30 bg-card flex flex-col rounded-t-[32px] fixed bottom-0 left-0 right-0">
          <div className="flex flex-col items-center pt-6 pb-4">
            <div className="flex items-center gap-1">
              <span className="text-xl font-semibold">
                You paid. It's done.{" "}
              </span>
            </div>
          </div>

          <div className="relative w-[365px] mx-auto px-8 pt-2 pb-8 flex flex-col items-center justify-center">
            <h2 className="text-base text-center text-muted mb-4">
              Tell the feed what just happened. <br />
              The ledger knows. The moment’s yours to share.
            </h2>

            {recipientUsername && (
              <p className="text-primary text-xl font-bold text-center -mt-2 mb-2">
                sent to @{recipientUsername}
              </p>
            )}

            {txHash && (
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full"
              >
                <Button variant="outline" className="w-full mt-4 mb-2">
                  View on Basescan
                </Button>
              </a>
            )}

            {frameAdded ? (
              <Button
                onClick={handleAddFrame}
                variant="outline"
                className="w-full"
              >
                Add Frame
              </Button>
            ) : (
              <Button className="w-full" onClick={handleShare}>
                Share
              </Button>
            )}
          </div>

          <div className="pb-[env(safe-area-inset-bottom)]" />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
