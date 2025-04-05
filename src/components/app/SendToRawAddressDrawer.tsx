"use client";

import { Drawer } from "vaul";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useSendTransaction } from "wagmi";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { shortAddress } from "@/lib/shortAddress";
import { Button } from "../ui/button";
import { PaymentSuccessDrawer } from "./PaymentSuccessDrawer";
import { ReceiptText } from "lucide-react";
import { NumericFormat } from "react-number-format";

export function SendToRawAddressDrawer({
  isOpen,
  onOpenChange,
  address,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
  address: `0x${string}`;
}) {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();

  const [amount, setAmount] = useState("0.00");
  const [sending, setSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [ethPriceUsd, setEthPriceUsd] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSending(false);
      setLastTxHash(null);
      setAmount("0.00");
    }
  }, [isOpen]);

  const handleSend = async () => {
    const parsedAmount = parseFloat(amount);
    if (!address || parsedAmount <= 0 || isNaN(parsedAmount)) return;
    if (!isConnected) await connect({ connector: farcasterFrame() });

    setSending(true);
    try {
      const txHash = await sendTransactionAsync({
        to: address,
        value: BigInt(parsedAmount * 1e18),
        chainId: 8453,
      });

      setLastTxHash(txHash);
      setShowSuccess(true);
      setSuccessMessage(`Sent ${parsedAmount} ETH`);

      setTimeout(() => {
        onOpenChange(false);
      }, 100);
    } catch (e) {
      console.error("Send failed", e);
    } finally {
      setSending(false);
    }
  };

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

              <p className="text-white mb-2">
                You're sending
                <span className="text-primary">{shortAddress(address)}</span>
              </p>
            </Drawer.Title>

            {/* <NumericFormat
              value={amount}
              onValueChange={(values) => {
                setAmount(values.value);
              }}
              thousandSeparator
              allowNegative={false}
              allowLeadingZeros={false}
              decimalScale={4}
              suffix=" ETH"
              placeholder="0.00"
              className="text-5xl bg-transparent text-center font-medium outline-none w-full placeholder-white/20 text-primary"
            /> */}

            <div className="flex flex-col">
              <NumericFormat
              inputMode="decimal"
  pattern="[0-9]*"
                value={amount}
                onValueChange={(values) => {
                  setAmount(values.value);
                }}
                thousandSeparator
                allowNegative={false}
                allowLeadingZeros={false}
                decimalScale={4}
                suffix=" ETH"
                placeholder="0.00"
                className="text-5xl bg-transparent text-center font-medium outline-none w-full placeholder-white/20 text-primary"
              />

              <p className="text-center text-white/30 text-base mt-1">
                ≈ ${amountUsd} USD
              </p>
            </div>

            <Button
              onClick={handleSend}
              disabled={sending || parseFloat(amount) <= 0}
              className="w-full bg-primary mt-4"
            >
              {sending ? "Sending..." : `Send ${amount || "ETH"}`}
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
