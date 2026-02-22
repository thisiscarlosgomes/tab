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

        // Resolve username -> fid so we can use the current notification route.
        void (async () => {
          try {
            const userRes = await fetch(
              `/api/neynar/user/by-username?username=${encodeURIComponent(
                recipientUsername.replace(/^@/, "")
              )}`
            );
            const recipient = await userRes.json();
            const fid = Number(recipient?.fid);
            if (!Number.isFinite(fid) || fid <= 0) return;

            await fetch("/api/send-notif", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fid,
                title: "🎁 Gift card received",
                message: `You’ve received a gift card! Code: ${giftCode}`,
              }),
            });
          } catch (err) {
            console.warn("Gift card notification failed", err);
          }
        })();

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
        <Drawer.Content className="z-40 fixed inset-0 top-[110px] bg-background rounded-t-3xl flex flex-col max-h-[calc(100vh-110px)] pb-8">
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

