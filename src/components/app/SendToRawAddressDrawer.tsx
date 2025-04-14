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
  verified_addresses: {
    primary?: {
      eth_address?: string | null;
    };
  };
};

type SendStatus = "idle" | "confirming" | "sending";

export function SendToRawAddressDrawer({
  isOpen,
  onOpenChange,
  address,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
  address: `0x${string}`;
}) {
  const { isConnected, address: userAddress } = useAccount(); // Get the connected user's address
  const { connect } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();
  const [selectedUser, setSelectedUser] = useState<FarcasterUser | null>(null);
  const [amount, setAmount] = useState("0");
  const [sending, setSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [customMessage, setCustomMessage] = useState("💸");
  // const [selectedToken, setSelectedToken] = useState<"ETH" | "USDC" | "TAB">(
  //   "ETH"
  // );
  const [mode, setMode] = useState<"token" | "send">("token");
  const [sendDrawerOpen, setSendDrawerOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<"ETH" | "USDC" | "TAB">(
    "ETH"
  );
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>(
    {}
  );
  const { writeContractAsync } = useWriteContract();

  const balance = parseFloat(tokenBalances[selectedToken] || "0");
  const parsedAmount = parseFloat(amount);
  const isInsufficient = parsedAmount > balance;

  const isDisabled =
    sendStatus !== "idle" ||
    sending ||
    isNaN(parsedAmount) ||
    parsedAmount <= 0 ||
    isInsufficient;

  const [farcasterUsername, setFarcasterUsername] = useState<string | null>(
    null
  );
  const [farcasterPfp, setFarcasterPfp] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (selectedUser) setCustomMessage("💸");
    else setCustomMessage(""); // no-op for non-Farcaster
  }, [isOpen, selectedUser]);

  useEffect(() => {
    if (!address) return;

    const checkFarcaster = async () => {
      try {
        const res = await fetch(`/api/neynar/user/by-address/${address}`);
        const data = await res.json();

        if (data?.username) {
          setSelectedUser(data);
          setFarcasterUsername(data.username);
          setFarcasterPfp(data.pfp_url || null);
        } else {
          setSelectedUser(null); // ✅ important
          setFarcasterUsername(null);
          setFarcasterPfp(null);
        }
      } catch {
        setFarcasterUsername(null);
        setFarcasterPfp(null);
      }
    };

    checkFarcaster();
  }, [address]);

  useEffect(() => {
    if (!isOpen) {
      setSending(false);
      setLastTxHash(null);
      setAmount("0");
      setShowSuccess(false);
      setSuccessMessage("");
      setSelectedToken("ETH");
    }
  }, [isOpen]);

  // Fetch balances for the user (sender), not the recipient
  useEffect(() => {
    if (!isOpen || !userAddress) return;

    const fetchBalancesAndPrices = async () => {
      const prices = await getTokenPrices();
      setTokenPrices(prices);

      const balances: Record<string, string> = {};
      for (const token of tokenList) {
        const balance = await getTokenBalance({
          tokenAddress: token.address as `0x${string}` | undefined,
          userAddress: userAddress, // Fetch balance for the sender
          decimals: token.decimals,
        });
        balances[token.name] = balance;
      }
      setTokenBalances(balances);
    };

    fetchBalancesAndPrices();
  }, [isOpen, userAddress]);

  const handleSend = async () => {
    if (!address || parsedAmount <= 0 || isNaN(parsedAmount)) return;
    if (!isConnected) await connect({ connector: farcasterFrame() });

    // ✅ Add this check here
    if (!selectedToken) {
      setSendStatus("idle");
      alert("Please select a token.");
      return;
    }

    setSending(true);
    try {
      const token = tokenList.find((t) => t.name === selectedToken);
      const decimals = token?.decimals ?? 18;
      const rawAmount = parseUnits(amount, decimals);

      let txHash: `0x${string}`;
      if (selectedToken === "ETH") {
        const tx = await sendTransactionAsync({
          to: address,
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
          args: [address, rawAmount],
          chainId: 8453,
        });
        txHash = tx;
      }

      setLastTxHash(txHash);
      setShowSuccess(true);
      setSuccessMessage(`Sent ${parsedAmount} ${selectedToken}`);

      if (selectedUser?.fid) {
        await fetch("/api/send-notif", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fid: selectedUser.fid,
            amount: parsedAmount,
            token: selectedToken,
            message: customMessage,
          }),
        });
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

  const price = tokenPrices[selectedToken || "ETH"];
  const formatUsd = (usd: number) =>
    usd >= 0.01 ? usd.toFixed(2) : usd.toPrecision(2);
  const amountUsd =
    price && parseFloat(amount) > 0
      ? formatUsd(parseFloat(amount) * price)
      : "0";

  const selectedTokenMeta = tokenList.find((t) => t.name === selectedToken);

  const formatAmount = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return "0";
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    });
  };

  return (
    <>
      <Drawer.Root
        open={isOpen}
        // onOpenChange={onOpenChange}
        onOpenChange={(v) => {
          if (!v) {
            setMode("token");
            setAmount("0");
            setCustomMessage("💸");
            setSelectedUser(null);
          }
          onOpenChange(v); // ✅ notify parent
        }}
        repositionInputs={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20" />
          <Drawer.Content className="scroll-smooth z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background p-0 rounded-t-3xl flex flex-col">
            <div
              aria-hidden
              className="mx-auto w-12 h-1.5 rounded-full bg-white/10 my-4"
            />
            <>
              <div className="px-4 sticky top-[80px] bg-background z-10">
                <Drawer.Title className="text-lg text-center font-medium">
                  Send
                </Drawer.Title>

                <div className="relative w-full mt-4">
                  {mode === "token" && (
                    <div className="space-y-3">
                      {tokenList.map((token) => {
                        const balanceRaw = tokenBalances[token.name];
                        const balance = parseFloat(balanceRaw || "0");
                        const isDisabled = !balance || balance <= 0;

                        return (
                          <button
                            key={token.name}
                            onClick={() => {
                              if (!isDisabled) {
                                setSelectedToken(
                                  token.name as "ETH" | "USDC" | "TAB"
                                );
                                setSendDrawerOpen(true);
                                setMode("send");
                              }
                            }}
                            disabled={isDisabled}
                            className={`flex items-center p-3 rounded-lg w-full ${
                              isDisabled
                                ? "opacity-40 cursor-not-allowed bg-white/5"
                                : "bg-white/5 hover:bg-white/10"
                            }`}
                          >
                            <img
                              src={token.icon}
                              alt={token.name}
                              className="w-8 h-8 rounded-full mr-3"
                            />
                            <div className="text-left">
                              <p className="text-primary font-medium">
                                {token.name}
                              </p>
                              <p className="text-sm text-white/30">
                                {balance.toFixed(4)} {token.name}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>

            <Drawer.NestedRoot
              open={sendDrawerOpen}
              onOpenChange={(v) => {
                setSendDrawerOpen(v);
                if (!v) {
                  setMode("token");
                  setAmount("0");
                }
              }}
            >
              <Drawer.Portal>
                <Drawer.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" />
                <Drawer.Content className="z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background p-4 space-y-4 rounded-t-3xl h-[100dvh]">
                  <div
                    aria-hidden
                    className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-1"
                  />
                  {/* <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-1" /> */}

                  <Drawer.Title className="text-lg text-center font-medium flex flex-col items-center justify-center">
                    <div className="w-16 h-16 rounded-full mb-4 bg-purple-100 text-purple-800 flex items-center justify-center relative">
                      {farcasterPfp ? (
                        <img
                          src={farcasterPfp}
                          alt={farcasterUsername ?? address}
                          className="w-full h-full object-cover rounded-full"
                        />
                      ) : (
                        <ReceiptText className="w-7 h-7" />
                      )}
                      {selectedTokenMeta?.icon && (
                        <img
                          src={selectedTokenMeta.icon}
                          alt={selectedToken}
                          className="absolute bottom-0 -right-2 w-6 h-6 rounded-full border-2 border-background"
                        />
                      )}
                    </div>

                    <p className="text-white mb-2">
                      You're sending{" "}
                      <span className="text-primary">
                        {farcasterUsername
                          ? `@${farcasterUsername}`
                          : shortAddress(address)}
                      </span>
                    </p>
                  </Drawer.Title>

                  <div className="flex flex-col">
                    <NumericFormat
                      inputMode="decimal"
                      pattern="[0-9]*"
                      value={amount}
                      onValueChange={(values) => {
                        setAmount(values.value);
                      }}
                      onFocus={() => {
                        if (amount === "0") {
                          setAmount("");
                        }
                      }}
                      thousandSeparator
                      allowNegative={false}
                      allowLeadingZeros={false}
                      decimalScale={4}
                      suffix={` ${selectedToken}`}
                      placeholder="0"
                      className={`text-6xl bg-transparent text-center font-medium outline-none w-full placeholder-white/20 ${
                        amount === "" || amount === "0"
                          ? "text-white/20"
                          : "text-primary"
                      }`}
                    />

                    <p className="text-center text-white/30 text-base mt-1">
                      ≈ ${amountUsd} USD
                    </p>
                  </div>

                  <div className="gap-4 space-y-2">
                    {selectedUser && (
                      <div className="relative w-full">
                        <textarea
                          rows={3}
                          value={customMessage}
                          onChange={(e) => setCustomMessage(e.target.value)}
                          placeholder="Add note"
                          className="w-full rounded-2xl bg-white/5 text-white placeholder-white/20 p-4 resize-none"
                        />
                        <span className="absolute bottom-5 italic left-3 text-xs text-white/30 pointer-events-none">
                          Private notification message to @
                          {selectedUser.username}
                        </span>
                      </div>
                    )}

                    <Button
                      onClick={handleSend}
                      disabled={isDisabled}
                      className="w-full bg-primary mt-4"
                    >
                      {/* {sending
                  ? "Sending..."
                  : `Send ${amount || "0"} ${selectedToken}`} */}
                      {sending
                        ? `Sending ${amount || "0"} ${selectedToken}`
                        : `Send ${amount || "0"} ${selectedToken}`}
                    </Button>
                  </div>
                  <div className="text-center">
                    <p className="text-white/30 text-sm">
                      Balance:{" "}
                      {formatAmount(tokenBalances[selectedToken] || "0")}{" "}
                      {selectedToken}
                      <br />
                      {isInsufficient && (
                        <span className="text-center text-sm text-red-400">
                          Insufficient balance
                        </span>
                      )}
                    </p>
                  </div>
                </Drawer.Content>
              </Drawer.Portal>
            </Drawer.NestedRoot>
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
