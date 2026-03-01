"use client";

import { useEffect, useCallback } from "react";
import { Drawer } from "vaul";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";

interface SuccessShareDrawerProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  title?: string;
  shareText?: string;
  txHash?: string;
  amount?: number;
  token?: string;
  showAddFrame?: boolean;
  extraNote?: string;
  embeds?: [string] | [string, string] | []; // matches SDK
}

export function SuccessShareDrawer({
  isOpen,
  setIsOpen,
  title = "Done!",
  shareText = "Let the feed know what just happened.",
  txHash,
  amount,
  token,
  showAddFrame = false,
  extraNote,
  embeds,
}: SuccessShareDrawerProps) {
  const handleShare = useCallback(async () => {
    if (isOpen) setIsOpen(false);

    const text = `${shareText}`;
    const shareUrl = embeds?.[0] ?? (typeof window !== "undefined" ? window.location.href : undefined);

    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text,
          url: shareUrl,
        });
        return;
      }

      const fallbackText = shareUrl ? `${text} ${shareUrl}` : text;
      await navigator.clipboard.writeText(fallbackText);
    } catch (err) {
      console.error("Failed to share", err);
    }
  }, [embeds, isOpen, setIsOpen, shareText, title]);

  useEffect(() => {
    if (
      isOpen &&
      title?.toLowerCase().includes("$tab") &&
      title?.toLowerCase().includes("done!")
    ) {
      confetti({
        particleCount: 180,
        spread: 70,
        origin: { y: 0.85 },
      });
    }
  }, [isOpen, title]);

  return (
    <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-50" />
        <Drawer.Content className="pb-8 z-50 bg-card flex flex-col rounded-t-3xl fixed bottom-0 left-0 right-0">
          <div className="flex flex-col items-center pt-6 pb-4">
            <span className="text-xl font-semibold">{title}</span>
            {/* {amount && token && (
              <p className="hidden text-primary mt-2 text-lg font-bold">
                +{amount} {token}
              </p>
            )} */}
          </div>

          <div className="w-full px-8 pb-6 flex flex-col items-center justify-center">
            <p className="text-muted text-base text-center mb-4">{shareText}</p>
            {extraNote && (
              <div className="w-full text-green-400 text-base text-center mt-2 mb-2 bg-green-400/10 p-4 rounded-lg">
                {extraNote}
              </div>
            )}
            {txHash && txHash.length >= 10 && (
              <Button
                variant="outline"
                className="w-full mb-2"
                onClick={() => window.open(`https://basescan.org/tx/${txHash}`, "_blank", "noopener,noreferrer")}
              >
                View Tx ({txHash.slice(0, 6)}...{txHash.slice(-4)})
              </Button>
            )}

            <Button onClick={handleShare} className="w-full bg-white">
              🎊 Share to Feed
            </Button>
          </div>

          <div className="pb-[env(safe-area-inset-bottom)]" />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
