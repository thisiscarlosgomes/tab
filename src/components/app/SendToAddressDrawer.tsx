"use client";

import { Drawer } from "vaul";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useSendTransaction } from "wagmi";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { shortAddress } from "@/lib/shortAddress";
import { Button } from "../ui/button";
import { PaymentSuccessDrawer } from "./PaymentSuccessDrawer";
import sdk from "@farcaster/frame-sdk";
// import { useAddPoints } from "@/lib/useAddPoints";
import { ReceiptText } from "lucide-react";

export function SendToAddressDrawer({
  isOpen,
  onOpenChange,
  address,
  amount,
  splitId, // optional
  billName, // ✅ new
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
  address: `0x${string}`;
  amount: number;
  splitId?: string;
  billName?: string; // ✅ new
}) {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();

  const [sending, setSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setSending(false);
      setLastTxHash(null);
    }
  }, [isOpen]);

  const handleSend = async () => {
    if (!address || !amount) return;
    if (!isConnected) await connect({ connector: farcasterFrame() });

    setSending(true);
    try {
      const txHash = await sendTransactionAsync({
        to: address as `0x${string}`,
        value: BigInt(amount * 1e18),
        chainId: 8453,
      });

      setLastTxHash(txHash);
      setShowSuccess(true);
      setSuccessMessage(
        splitId ? `You’ve joined + paid ${amount} ETH` : `Sent ${amount} ETH`
      );

      if (splitId) {
        const context = await sdk.context;
        const userAddress = address.toLowerCase();

        const participant = {
          address,
          name: context.user?.username ?? address.slice(0, 6),
          pfp: context.user?.pfpUrl ?? "",
          fid: context.user?.fid?.toString() ?? "",
        };

        // Fetch split to check if already joined
        const res = await fetch(`/api/split/${splitId}`);
        const data = await res.json();

        const alreadyJoined = data?.participants?.some(
          (p: { address: string }) => p.address.toLowerCase() === userAddress
        );

        if (!alreadyJoined) {
          await fetch(`/api/split/${splitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ participant }),
          });

          // await useAddPoints(address, "invite", undefined, splitId);
        }
      }

      setTimeout(() => {
        onOpenChange(false);
      }, 100);
    } catch (e) {
      console.error("Send failed", e);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Drawer.Root
        open={isOpen}
        onOpenChange={onOpenChange}
        repositionInputs={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20" />
          <Drawer.Content className="space-y-6 p-4 z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background rounded-t-3xl flex flex-col">
            <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-1" />

            <Drawer.Title className="text-lg text-center font-medium flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-full mb-4 bg-purple-100 text-purple-800 flex items-center justify-center">
                <ReceiptText className="w-7 h-7" />
              </div>

              {billName && (
                <p className="text-white/40 text-xl mb-1">
                  Split: {billName} Split
                </p>
              )}

              <p className="text-white mb-2">
                Send {amount} ETH to{" "}
                <span className="text-primary">{shortAddress(address)}</span>
              </p>
            </Drawer.Title>

            <Button
              onClick={handleSend}
              disabled={sending}
              className="w-full bg-primary mt-4"
            >
              {sending ? "Sending..." : `Send ${amount} ETH`}
            </Button>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <PaymentSuccessDrawer
        isOpen={showSuccess}
        setIsOpen={(v) => {
          setShowSuccess(v);
          if (!v) {
            setLastTxHash(null);
            setSuccessMessage("");
          }
        }}
        name="Tab Paid"
        description={successMessage}
        txHash={lastTxHash ?? undefined}
      />
    </>
  );
}
