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
import { tokenList } from "@/lib/tokens";
import { erc20Abi, parseUnits } from "viem";
import { useWriteContract } from "wagmi";

export function SendToAddressDrawer({
  isOpen,
  onOpenChange,
  address,
  amount,
  splitId,
  billName,
  token = "ETH", // default to ETH
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
  address: `0x${string}`;
  amount: number;
  splitId?: string;
  billName?: string;
  token?: string; // ✅ add this
}) {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();

  const [sending, setSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const { writeContractAsync } = useWriteContract();
  const tokenInfo = tokenList.find((t) => t.name === token);
  const fallbackToken = tokenList.find((t) => t.name === "ETH");
  const effectiveTokenInfo = tokenInfo ?? fallbackToken;
  const effectiveToken = effectiveTokenInfo?.name ?? "ETH";

  const tokenIcon = effectiveTokenInfo?.icon ? (
    <img
      src={effectiveTokenInfo.icon}
      alt={effectiveTokenInfo.name}
      className="absolute bottom-0 -right-2 w-7 h-7 rounded-full border-2 border-background"
    />
  ) : null;

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
      let txHash: `0x${string}`;
      const decimals = effectiveTokenInfo?.decimals ?? 18;
      const rawAmount = parseUnits(amount.toString(), decimals);
      if (amount <= 0) {
        console.error("Invalid amount");
        return;
      }

      if (!effectiveTokenInfo?.address) {
        // Native ETH
        txHash = await sendTransactionAsync({
          to: address,
          value: rawAmount,
          chainId: 8453,
        });
      } else {
        // ERC-20
        txHash = await writeContractAsync({
          address: effectiveTokenInfo.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "transfer",
          args: [address, rawAmount],
          chainId: 8453,
        });
      }

      setLastTxHash(txHash);
      setShowSuccess(true);
      const effectiveToken = effectiveTokenInfo?.name ?? "ETH";
      setSuccessMessage(
        splitId
          ? `You’ve joined + paid ${amount.toFixed(2)} ${effectiveToken}`
          : `Sent ${amount.toFixed(2)} ${effectiveToken}`
      );

      if (splitId) {
        const context = await sdk.context;

        const username = context.user?.username;

        let senderAddress = address.toLowerCase(); // fallback

        if (username) {
          try {
            const res = await fetch(
              `/api/neynar/user/by-username?username=${username}`
            );
            const data = await res.json();
            const verified = data?.verified_addresses?.primary?.eth_address;
            if (verified) {
              senderAddress = verified.toLowerCase();
            }
          } catch (err) {
            console.warn("Failed to resolve verified address via Neynar", err);
          }
        }

        const participant = {
          address: senderAddress,
          name: username ?? senderAddress.slice(0, 6),
          pfp: context.user?.pfpUrl ?? "",
          fid: context.user?.fid?.toString() ?? "",
        };

        // Fetch split to check if already joined
        const res = await fetch(`/api/split/${splitId}`);
        const data = await res.json();

        const alreadyJoined = data?.participants?.some(
          (p: { address: string }) => p.address.toLowerCase() === senderAddress
        );

        if (!alreadyJoined) {
          await fetch(`/api/split/${splitId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              participant,
              payment: {
                address: participant.address,
                name: participant.name,
                txHash,
                status: "paid",
                token: effectiveToken,
                timestamp: new Date().toISOString(), // ✅ add this
              },
            }),
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
              <div className="relative w-16 h-16 rounded-full mb-4 bg-purple-100 text-purple-800 flex items-center justify-center">
                <ReceiptText className="w-7 h-7" />
                {tokenIcon}
              </div>

              {billName && (
                <p className="text-white/40 text-xl mb-1">
                  Split: {billName} Split
                </p>
              )}

              <p className="text-white mb-2">
                Send {amount} {token} to{" "}
                <span className="text-primary">{shortAddress(address)}</span>
              </p>
            </Drawer.Title>

            <Button
              onClick={handleSend}
              disabled={sending}
              className="w-full bg-primary mt-4"
            >
              {/* {sending ? "Sending..." : `Send ${amount} ${token}`} */}
              {sending
                ? `Sending ${amount.toFixed(2)} ${effectiveToken}...`
                : `Send ${amount.toFixed(2)} ${effectiveToken}`}
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
