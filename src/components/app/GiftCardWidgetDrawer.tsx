"use client";

import * as Drawer from "vaul";
import { useEffect } from "react";

export function GiftCardWidgetDrawer({
  isOpen,
  onClose,
  recipientUsername,
}: {
  isOpen: boolean;
  onClose: () => void;
  recipientUsername: string;
}) {
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.origin !== "https://embed.bitrefill.com") return;

      const { event, data } = e.data || {};
      if (event === "invoice_complete") {
        const giftCode = data?.card?.code || data?.orderId;

        // Optional: send DM or show confirmation
        fetch("/api/send-notification", {
          method: "POST",
          body: JSON.stringify({
            to: recipientUsername,
            message: `🎁 You’ve received a gift card! Code: ${giftCode}`,
          }),
        });

        onClose();
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [recipientUsername, onClose]);

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-20" />
        <Drawer.Content className="z-40 fixed inset-0 top-[80px] bg-background rounded-t-3xl flex flex-col max-h-[calc(100vh-80px)] pb-8">
          <iframe
            src="https://embed.bitrefill.com/?ref=tabapp&walletConnect=1&paymentMethods=usdc_erc20&locale=en-US&utm_source=tabapp"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            width="100%"
            height="100%"
            className="border-none"
          />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}


