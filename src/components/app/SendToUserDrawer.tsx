"use client";

import { Drawer } from "vaul";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useSendTransaction } from "wagmi";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { shortAddress } from "@/lib/shortAddress";
import { Button } from "../ui/button";
import { PaymentSuccessDrawer } from "@/components/app/PaymentSuccessDrawer";
import sdk from "@farcaster/frame-sdk";
import { toast } from "sonner";
import { NumericFormat } from "react-number-format";

type FarcasterUser = {
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  verified_addresses?: {
    primary?: {
      eth_address?: string | null;
    };
  };
};

type SendStatus = "idle" | "confirming" | "sending";

export function SendToUserDrawer({
  user,
  isOpen,
  onOpenChange,
}: {
  user: FarcasterUser | null;
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();

  const [amount, setAmount] = useState("0.00");
  const [message, setMessage] = useState("💸");
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");

  const [showSuccess, setShowSuccess] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [lastRecipientUsername, setLastRecipientUsername] = useState<
    string | null
  >(null);
  const [ethPriceUsd, setEthPriceUsd] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setAmount("0.01");
      setMessage("");
    }
  }, [isOpen]);

  if (!user) return null;

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
        );
        const data = await res.json();
        setEthPriceUsd(data.ethereum.usd);
      } catch (e) {
        console.error("Failed to fetch ETH price", e);
      }
    };

    fetchPrice();
  }, []);

  const amountUsd =
    ethPriceUsd && parseFloat(amount) > 0
      ? (parseFloat(amount) * ethPriceUsd).toFixed(2)
      : "0.00";

  const handleSend = async () => {
    if (!user.verified_addresses?.primary?.eth_address) return;
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;
    if (!isConnected) await connect({ connector: farcasterFrame() });

    setSendStatus("confirming");

    try {
      const txHash = await sendTransactionAsync({
        to: user.verified_addresses.primary.eth_address as `0x${string}`,
        value: BigInt(parsedAmount * 1e18),
        chainId: 8453,
      });

      setSendStatus("sending");

      setLastTxHash(txHash);
      setLastRecipientUsername(user.username);
      setShowSuccess(true);

      const context = await sdk.context;
      const senderUsername = context.user?.username;

      const notifRes = await fetch("/api/send-notif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fid: user.fid,
          amount: parsedAmount,
          senderUsername,
          message,
        }),
      });

      const notifJson = await notifRes.json();
      console.log("[SendToUserDrawer notif result]", notifJson);

      if (notifRes.ok) {
        toast.success("Recipient has been notified.");
      } else {
        toast.warning(
          "Payment sent, but notification may not have been delivered."
        );
      }

      setTimeout(() => {
        onOpenChange(false);
      }, 100);
    } catch (e) {
      console.error("Send failed", e);
      toast.error("Transaction failed.");
      setSendStatus("idle");
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
          <Drawer.Content className="space-y-6 p-4 scroll-smooth z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background p-0 rounded-t-3xl flex flex-col">
            <div
              aria-hidden
              className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-1"
            />
            <Drawer.Title className="text-lg text-center font-medium">
              <div className="flex flex-col items-center space-y-2">
                <img
                  src={
                    user.pfp_url ||
                    `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${user.username}`
                  }
                  alt={user.username}
                  className="w-16 h-16 rounded-full object-cover mb-2"
                />
                <span>
                  You're sending{" "}
                  <span className="text-primary">@{user.username}</span>
                </span>
                <p className="text-white/30 break-all text-center">
                  {user.verified_addresses?.primary?.eth_address
                    ? shortAddress(user.verified_addresses.primary.eth_address)
                    : "No address"}
                </p>
              </div>
            </Drawer.Title>
            {/* <div>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^[0-9]*[.]?[0-9]*$/.test(val)) setAmount(val);
                }}
                className="text-6xl bg-transparent text-center text-primary font-medium outline-none w-full"
              />
              <p className="text-center text-white/30 text-sm mt-1">
                ≈ ${amountUsd}
              </p>
            </div> */}

            <div className="flex flex-col">
              <NumericFormat
                inputMode="decimal"
                pattern="[0-9]*"
                value={amount}
                onValueChange={(values) => {
                  setAmount(values.value); // raw number string (e.g. "0.01")
                }}
                thousandSeparator
                allowNegative={false}
                allowLeadingZeros={false}
                decimalScale={4}
                suffix=" ETH"
                placeholder="0.00"
                className={`text-6xl bg-transparent text-center font-medium outline-none w-full placeholder-white/20 ${
                  amount === "" || amount === "0.00"
                    ? "text-white/20"
                    : "text-primary"
                }`}
              />

              <p className="text-center text-white/30 text-base mt-1">
                ≈ ${amountUsd} USD
              </p>
            </div>

            {/* <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Add note (private notification to ${user?.username})`}
              className="w-full rounded-2xl bg-white/5 text-white placeholder-white/20 p-4 resize-none"
            /> */}

            <div className="relative w-full">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Add note"
                className="w-full rounded-2xl bg-white/5 text-white placeholder-white/20 p-4 resize-none"
              />
              <span className="absolute bottom-5 italic left-3 text-xs text-white/30 pointer-events-none">
                Private notification message to @{user?.username}
              </span>
            </div>

            <Button
              onClick={handleSend}
              disabled={sendStatus !== "idle"}
              className="w-full bg-primary"
            >
              {sendStatus === "confirming"
                ? "Confirming..."
                : sendStatus === "sending"
                  ? "Sending..."
                  : `Send ${amount} ETH`}
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
            setLastRecipientUsername(null);
          }
        }}
        name="Payment Sent"
        description={
          message || `Just sent ${amount} ETH to @${lastRecipientUsername}`
        }
        recipientUsername={lastRecipientUsername ?? undefined}
        txHash={lastTxHash ?? undefined}
      />
    </>
  );
}
