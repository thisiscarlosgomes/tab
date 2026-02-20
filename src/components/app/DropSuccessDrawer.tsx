"use client";

import { useEffect, useState } from "react";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import confetti from "canvas-confetti";

interface DropSuccessDrawerProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  claimUrl: string;
  amount: string;
  token: string;
}

export function DropSuccessDrawer({
  isOpen,
  setIsOpen,
  claimUrl,
  amount,
  token,
}: DropSuccessDrawerProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      confetti({
        particleCount: 160,
        spread: 70,
        origin: { y: 0.9 },
      });
    }
  }, [isOpen]);

  const handleCopy = () => {
    navigator.clipboard.writeText(claimUrl);
    setCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-[7.5px] z-20" />
        <Drawer.Content className="z-30 bg-card flex flex-col rounded-t-[32px] fixed bottom-0 left-0 right-0">
          <div className="flex flex-col items-center pt-6 pb-4 px-6">
            <h2 className="text-xl font-semibold text-center mb-1">
              Share your link
            </h2>
            <p className="text-base text-muted text-center">
              Your link is ready. Share it with your friends. Claim it on
              farcaster.
            </p>
          </div>

          <div className="bg-white/5 rounded-xl p-6 mx-6 mt-2 flex flex-col items-center border-2 border-white/10">
            <div className="text-5xl font-medium text-primary mb-1">
              ${amount}
            </div>
            <p className="text-white text-sm">
              {amount} {token}
            </p>
          </div>

          <div className="mt-6 mx-6">
            <div className="bg-white/5 rounded-lg px-4 py-3 flex items-center justify-between">
              <span className="text-sm truncate text-white">{claimUrl}</span>
              <button
                onClick={handleCopy}
                className="ml-3 text-white/70 hover:text-white"
              >
                {copied ? (
                  <span className="text-xs text-green-400">Copied!</span>
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            {/* <p className="text-white/30 text-xs mt-2">
              Anyone with the link can claim. The claim token stays on this
              device, so make sure to keep this page open if you need to claim
              it yourself.
            </p> */}

            <p className="text-white/30 text-xs mt-2">
              {claimUrl.includes("/group/")
                ? "Anyone with the link can claim, until the drop is fully claimed."
                : "Anyone with the link can claim. The claim token stays on this device, so you'll need to view it here to access it."}
            </p>
          </div>

          <div className="p-6 pt-4">
            <Button className="w-full bg-primary" onClick={handleCopy}>
              {copied
                ? "Copied!"
                : claimUrl.includes("/group/")
                  ? "Copy Group Link"
                  : "Copy Link"}
            </Button>
          </div>

          <div className="pb-[env(safe-area-inset-bottom)]" />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
