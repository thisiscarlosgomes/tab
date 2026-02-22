"use client";

import { Drawer } from "vaul";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useSendTransaction } from "wagmi";
import { shortAddress } from "@/lib/shortAddress";
import { Button } from "../ui/button";
import { PaymentSuccessDrawer } from "@/components/app/PaymentSuccessDrawer";
import sdk from "@farcaster/frame-sdk";
import { toast } from "sonner";
import { NumericFormat } from "react-number-format";
import { tokenList } from "@/lib/tokens";
import { getTokenPrices } from "@/lib/getTokenPrices";
import { getTokenBalance } from "@/lib/getTokenBalance";
import { useWriteContract } from "wagmi";
import { erc20Abi, parseUnits } from "viem";

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
  const { isConnected, address: userAddress } = useAccount(); // Get the connected user's address
  const { connect, connectors } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();

  const [amount, setAmount] = useState("0");
  const [message, setMessage] = useState("💸");
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [sending, setSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [lastRecipientUsername, setLastRecipientUsername] = useState<
    string | null
  >(null);
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>(
    {}
  );
  const [selectedToken, setSelectedToken] = useState<"ETH" | "USDC" | "TAB">(
    "USDC"
  );

  const { writeContractAsync } = useWriteContract();

  const balance = parseFloat(tokenBalances[selectedToken] || "0");
  const parsedAmount = parseFloat(amount);
  const isInsufficient = parsedAmount > balance;

  const isDisabled =
    sending || isNaN(parsedAmount) || parsedAmount <= 0 || isInsufficient;

  useEffect(() => {
    if (!isOpen) {
      setAmount("0.1");
      setMessage("");
      setSendStatus("idle");
      setSending(false);
      setSelectedToken("USDC");
      setTokenPrices({});
      setTokenBalances({});
      setLastTxHash(null);
      setLastRecipientUsername(null);
    }
  }, [isOpen]);

  if (!user) return null;

  useEffect(() => {
    if (!isOpen || !userAddress) return;

    const fetchBalancesAndPrices = async () => {
      const prices = await getTokenPrices(); // Fetch token prices
      setTokenPrices(prices);

      const balances: Record<string, string> = {};
      for (const token of tokenList) {
        const balance = await getTokenBalance({
          tokenAddress: token.address as `0x${string}` | undefined,
          userAddress: userAddress, // Get balance of the sender (user)
          decimals: token.decimals,
        });
        balances[token.name] = balance;
      }
      setTokenBalances(balances);
    };

    fetchBalancesAndPrices();
  }, [isOpen, userAddress]);

  const handleSend = async () => {
    const parsedAmount = parseFloat(amount);
    if (!user?.verified_addresses?.primary?.eth_address) return;
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;
    if (!isConnected) {
      const connector = connectors[0];
      if (!connector) return;
      await connect({ connector });
    }

    setSendStatus("confirming");
    setSending(true);

    const recipient = user.verified_addresses.primary
      .eth_address as `0x${string}`;
    const token = tokenList.find((t) => t.name === selectedToken);
    const decimals = token?.decimals ?? 18;
    const rawAmount = parseUnits(amount, decimals);

    try {
      let txHash: `0x${string}`;

      if (selectedToken === "ETH") {
        const tx = await sendTransactionAsync({
          to: recipient,
          value: rawAmount,
          chainId: 8453,
        });
        txHash = tx;
      } else {
        if (!token?.address) throw new Error("Token address missing");

        const tx = await writeContractAsync({
          address: token.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "transfer",
          args: [recipient, rawAmount],
          chainId: 8453,
        });
        txHash = tx;
      }

      setSendStatus("sending");
      setLastTxHash(txHash);
      setLastRecipientUsername(user.username);
      setShowSuccess(true);

      if (userAddress) {
        void fetch("/api/activity/client-transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderAddress: userAddress,
            recipientAddress: recipient,
            amount: parsedAmount,
            token: selectedToken,
            txHash,
            recipientUsername: user.username ?? null,
            recipientPfp: user.pfp_url ?? null,
            recipientResolutionSource: "farcaster",
          }),
        }).catch(() => {});
      }

      // Send notification to recipient
      let senderUsername: string | null = null;
      try {
        const context = await sdk.context;
        senderUsername = context?.user?.username ?? null;
      } catch {
        senderUsername = null;
      }
      await fetch("/api/send-notif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fid: user.fid,
          amount: parsedAmount,
          senderUsername,
          message,
        }),
      });

      setTimeout(() => {
        onOpenChange(false);
      }, 100);
    } catch (e) {
      console.error("Send failed", e);
      toast.error("Transaction failed.");
      setSendStatus("idle");
    }
  };

  const price = tokenPrices[selectedToken || "ETH"];
  const formatUsd = (usd: number) =>
    usd >= 0.01 ? usd.toFixed(2) : usd.toPrecision(2);
  const amountUsd =
    price && parseFloat(amount) > 0
      ? formatUsd(parseFloat(amount) * price)
      : "0";

  const formatAmount = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return "0";
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  };

  const selectedTokenMeta = tokenList.find((t) => t.name === selectedToken);

  return (
    <>
      <Drawer.Root
        open={isOpen}
        onOpenChange={onOpenChange}
        repositionInputs={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-20" />
          <Drawer.Content className="space-y-4 p-4 scroll-smooth z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background p-0 rounded-t-3xl flex flex-col">
            <div
              aria-hidden
              className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-1"
            />
            <Drawer.Title className="text-lg text-center font-medium">
              <div className="flex flex-col items-center space-y-2">
                <div className="mb-4 flex items-center justify-center relative">
                  <img
                    src={
                      user.pfp_url ||
                      `https://api.dicebear.com/9.x/glass/svg?seed=${user.username}`
                    }
                    alt={user.username}
                    className="w-16 h-16 rounded-full object-cover"
                  />
                  {selectedTokenMeta?.icon && (
                    <img
                      src={selectedTokenMeta.icon}
                      alt={selectedToken}
                      className="absolute bottom-0 -right-2 w-6 h-6 rounded-full border-2 border-background"
                    />
                  )}
                </div>

                <span>
                  <span className="text-primary">@{user.username}</span>
                </span>
                <p className="text-white/30 text-sm break-all text-center">
                  {user.verified_addresses?.primary?.eth_address
                    ? shortAddress(user.verified_addresses.primary.eth_address)
                    : "No address"}
                </p>
              </div>
            </Drawer.Title>

            <div className="space-y-1">
              <div className="grid grid-cols-3 gap-2">
                {tokenList.map((token) => (
                  <button
                    key={token.name}
                    onClick={() =>
                      setSelectedToken(token.name as "ETH" | "USDC" | "TAB")
                    }
                    className={`w-full text-center py-2 rounded-sm border-2 border-white/5 ${
                      selectedToken === token.name
                        ? "bg-white/5 text-primary"
                        : "bg-background text-white/30"
                    }`}
                  >
                    <div className="flex items-center justify-center space-x-2">
                      <span>{token.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

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
                suffix={` ${selectedToken}`}
                placeholder="0"
                className="text-5xl bg-transparent text-center font-medium outline-none w-full placeholder-white/20 text-primary"
              />

              <p className="text-center text-white/30 text-sm mt-1">
                Paying with: {formatAmount(tokenBalances[selectedToken] || "0")}{" "}
                {selectedToken}
                <br />
                {isInsufficient && (
                  <span className="text-center text-sm text-red-400">
                    Insufficient balance
                  </span>
                )}
              </p>
            </div>

            <div className="relative w-full">
              <textarea
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Add note"
                className="w-full rounded-2xl bg-white/5 text-white placeholder-white/20 p-4 resize-none"
              />
              <span className="absolute bottom-5 italic left-3 text-xs text-white/30 pointer-events-none">
                Private message (optional)
              </span>
            </div>

            <Button
              onClick={handleSend}
              disabled={isDisabled}
              className="w-full bg-primary"
            >
              {sendStatus === "confirming"
                ? "Confirming..."
                : sendStatus === "sending"
                  ? "Sending..."
                  : `Send`}
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
