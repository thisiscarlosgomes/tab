"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
import { useSendDrawer } from "@/providers/SendDrawerProvider";
import { useAccount, useConnect, useSendTransaction } from "wagmi";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";

import { Button } from "../ui/button";
import { shortAddress } from "@/lib/shortAddress";
import { PaymentSuccessDrawer } from "@/components/app/PaymentSuccessDrawer";
import sdk from "@farcaster/frame-sdk";
import { NumericFormat } from "react-number-format";
import { getTokenBalance } from "@/lib/getTokenBalance";
import { tokenList } from "@/lib/tokens"; // or define inline
import { getTokenPrices } from "@/lib/getTokenPrices"; // or define inline
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

export function GlobalSendDrawer() {
  const {
    isOpen,
    close,
    query,
    setQuery,
    scannedUsername,
    setScannedUsername,
  } = useSendDrawer();

  const { isConnected, address } = useAccount();
  const { connect } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();

  const inputRef = useRef<HTMLInputElement>(null);

  const [results, setResults] = useState<FarcasterUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<FarcasterUser | null>(null);
  const [amount, setAmount] = useState("0.00");
  const [sendDrawerOpen, setSendDrawerOpen] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastSentAmount, setLastSentAmount] = useState(0.01);
  const [customMessage, setCustomMessage] = useState("💸");
  const [lastMessage, setLastMessage] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  // const [ethPriceUsd, setEthPriceUsd] = useState<number | null>(null);

  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});

  const [selectedToken, setSelectedToken] = useState<
    "ETH" | "USDC" | "TAB" | null
  >(null);

  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [mode, setMode] = useState<"search" | "token">("search");
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>(
    {}
  );

  const { writeContractAsync } = useWriteContract();

  useEffect(() => {
    const fetchBalances = async () => {
      if (!address) return;

      const userAddress = address;

      const balances: Record<string, string> = {};

      for (const token of tokenList) {
        const balance = await getTokenBalance({
          tokenAddress: token.address as `0x${string}` | undefined,
          userAddress,
          decimals: token.decimals,
        });

        balances[token.name] = balance;
      }

      setTokenBalances(balances);
    };

    if (mode === "token") {
      fetchBalances();
    }
  }, [selectedUser, mode]);

  useEffect(() => {
    if (!isOpen || !scannedUsername || sendDrawerOpen || selectedUser) return;

    const fetchAndOpen = async () => {
      try {
        const res = await fetch(
          `/api/neynar/user/by-username?username=${scannedUsername}`
        );
        const data = await res.json();
        if (data?.username) {
          setSelectedUser(data);
          setSendDrawerOpen(true);
        }
      } catch (e) {
        console.error("error fetching scanned user", e);
      }
    };

    fetchAndOpen();
  }, [scannedUsername, isOpen]);

  useEffect(() => {
    if (!isOpen || !address || mode !== "search") return;

    const delay = setTimeout(async () => {
      try {
        if (query.trim()) {
          const res = await fetch(
            `/api/neynar/user/search?q=${encodeURIComponent(query)}`
          );
          const data = await res.json();
          const searchResults = data.users?.slice(0, 10) || [];
          setResults(searchResults);
        } else {
          const context = await sdk.context;
          setUsername(context.user?.username ?? null);
          const res = await fetch(
            `/api/neynar/user/following?username=${username}`
          );
          const data = await res.json();

          if (Array.isArray(data)) {
            const top10Users = data.slice(0, 20).map((entry) => entry.user);
            setResults(top10Users);
          } else {
            setResults([]);
          }
        }
      } catch {
        setResults([]);
      }
    }, 300);

    return () => clearTimeout(delay);
  }, [query, isOpen, address, mode]);

  useEffect(() => {
    const fetchPrices = async () => {
      const tokenPrices = await getTokenPrices();
      setTokenPrices(tokenPrices); // <-- ADD THIS
      // setEthPriceUsd(tokenPrices["ETH"] ?? null);
    };

    fetchPrices();
  }, []);

  const price = tokenPrices[selectedToken || "ETH"] ?? null;


  const formatUsd = (usd: number) =>
    usd >= 0.01 ? usd.toFixed(2) : usd.toPrecision(2);

  const amountUsd =
    price && parseFloat(amount) > 0
      ? formatUsd(parseFloat(amount) * price)
      : "0.00";

  const handleSend = async () => {
    const parsedAmount = parseFloat(amount);
    if (!selectedUser?.verified_addresses?.primary?.eth_address) return;
    if (!isConnected) await connect({ connector: farcasterFrame() });
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    // ✅ Add this check here
    if (!selectedToken) {
      setSendStatus("idle");
      alert("Please select a token.");
      return;
    }

    setSendStatus("confirming");

    const recipient = selectedUser.verified_addresses.primary
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
      setLastSentAmount(parsedAmount);
      setLastMessage(customMessage);
      setCustomMessage("");
      setAmount("0.00");
      setSendDrawerOpen(false);
      setShowSuccess(true);
      close();

      // await fetch("/api/send-notif", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({
      //     fid: selectedUser.fid,
      //     amount: parsedAmount,
      //     senderUsername: username,
      //     message: customMessage,
      //   }),
      // });
      await fetch("/api/send-notif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fid: selectedUser.fid,
          amount: parsedAmount,
          token: selectedToken, // <-- added
          senderUsername: username,
          message: customMessage,
        }),
      });
      
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSendStatus("idle");
    }
  };

  const formatAmount = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return "0";

    // Limit to 3 decimals but remove trailing zeroes
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  };

  const balance = selectedToken
    ? parseFloat(tokenBalances[selectedToken] || "0")
    : 0;
  const amountNumber = parseFloat(amount);

  const isDisabled =
    sendStatus !== "idle" ||
    !amount ||
    isNaN(amountNumber) ||
    amountNumber <= 0 ||
    !selectedToken ||
    amountNumber > balance;

  return (
    <>
      <Drawer.Root
        open={isOpen}
        onOpenChange={(v) => {
          if (!v) {
            close();
            setQuery("");
            setResults([]);
            setSelectedUser(null);
            setSendDrawerOpen(false);
            setScannedUsername(null); // <== very important
          }
        }}
        repositionInputs={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20" />
          <Drawer.Content className="scroll-smooth z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background p-0 rounded-t-3xl flex flex-col">
            {/* drag handle */}
            <div
              aria-hidden
              className="mx-auto w-12 h-1.5 rounded-full bg-white/10 my-4"
            />

            {!scannedUsername && (
              <>
                {/* Fixed top section */}
                <div className="px-4 sticky top-[80px] bg-background z-10">
                  <Drawer.Title className="text-lg text-center font-medium">
                    Send
                  </Drawer.Title>
                  <div className="relative w-full mt-4">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                      To:
                    </span>
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder="username or name"
                      value={query}
                      onFocus={() => {
                        if (mode === "token") {
                          setMode("search");
                          setQuery(""); // optional: reset input
                        }
                      }}
                      onChange={(e) => setQuery(e.target.value)}
                      className="w-full p-4 pl-12 pr-20 rounded-lg bg-white/5 text-white placeholder-white/20"
                    />

                    {mode === "search" ? (
                      <button
                        onClick={async () => {
                          const text = await navigator.clipboard.readText();
                          setQuery(text);
                        }}
                        className="absolute right-5 top-1/2 -translate-y-1/2 text-primary font-medium hover:underline"
                      >
                        Paste
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setQuery("");
                          setMode("search");
                          setQuery(""); // set your original friend list here
                        }}
                        className="absolute right-5 top-1/2 -translate-y-1/2 text-primary font-medium hover:underline"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="h-4" /> {/* spacer */}
                </div>
                <div className="flex-1 overflow-y-auto px-4 pb-16 space-y-2">
                  {mode === "search" &&
                    results.map((user) => (
                      <button
                        key={user.fid}
                        onClick={() => {
                          setSelectedUser(user);
                          setSelectedToken(null);
                          setMode("token");
                        }}
                        className="flex items-center p-3 rounded-lg bg-white/5 hover:bg-white/10 w-full"
                      >
                        <img
                          src={user.pfp_url}
                          className="w-8 h-8 rounded-full mr-3"
                        />
                        <div className="text-left">
                          <p className="text-primary font-medium">
                            @{user.username}
                          </p>
                          <p className="text-sm text-white/30 break-all">
                            {user.verified_addresses?.primary?.eth_address
                              ? shortAddress(
                                  user.verified_addresses.primary.eth_address
                                )
                              : "No address"}
                          </p>
                        </div>
                      </button>
                    ))}

                  {mode === "token" && (
                    <div className="space-y-3">
                      <p className="ml-4">Select token</p>
                      {tokenList.map((token) => {
                        const balanceRaw = tokenBalances[token.name];
                        const balance = parseFloat(balanceRaw || "0");
                        const isDisabled = !balance || balance <= 0;

                        return (
                          <button
                            key={token.name}
                            onClick={() => {
                              if (!isDisabled) {
                                // setSelectedToken(token.name as "ETH" | "USDC");
                                setSelectedToken(
                                  token.name as "ETH" | "USDC" | "TAB"
                                );

                                setSendDrawerOpen(true);
                              }
                            }}
                            disabled={isDisabled}
                            className={`flex items-center p-3 rounded-lg w-full
        ${isDisabled ? "opacity-40 cursor-not-allowed bg-white/5" : "bg-white/5 hover:bg-white/10"}
      `}
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
                              <p className="text-sm text-white/30 break-all">
                                {balanceRaw
                                  ? `${formatAmount(balanceRaw)} ${token.name}`
                                  : "Loading..."}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            <Drawer.NestedRoot
              open={sendDrawerOpen}
              onOpenChange={(v) => {
                if (!v) {
                  setSendDrawerOpen(false);
                  setAmount("0.00");

                  // ✅ Add these
                  setMode("search");
                  setQuery("");
                  setResults([]);
                }
              }}
              repositionInputs={false}
            >
              <Drawer.Portal>
                <Drawer.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" />
                <Drawer.Content className="z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background p-4 space-y-6 rounded-t-3xl h-[100dvh]">
                  <div
                    aria-hidden
                    className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-1"
                  />
                  <Drawer.Title className="text-lg text-center font-medium">
                    <div className="flex flex-col items-center space-y-2">
                      <img
                        src={
                          selectedUser?.pfp_url ||
                          `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${selectedUser?.username}`
                        }
                        alt={selectedUser?.username}
                        className="w-16 h-16 rounded-full object-cover mb-2"
                      />
                      <Drawer.Title className="text-lg font-medium text-center">
                        You're sending {""}
                        <span className="text-primary">
                          @{selectedUser?.username}
                        </span>
                      </Drawer.Title>
                      <p className="text-white/30 break-all text-center">
                        {selectedUser?.verified_addresses?.primary?.eth_address
                          ? shortAddress(
                              selectedUser.verified_addresses.primary
                                .eth_address
                            )
                          : "No address"}
                      </p>
                    </div>
                  </Drawer.Title>
                  <div className="w-full text-6xl font-medium text-center text-primary bg-transparent outline-none flex justify-center items-baseline gap-2">
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
                        suffix={` ${selectedToken || ""}`}
                        placeholder="0.00"
                        className={`text-6xl bg-transparent text-center font-medium outline-none w-full placeholder-white/20 ${
                          amount === "" || amount === "0.00"
                            ? "text-white/20"
                            : "text-primary"
                        }`}
                      />

                      <p className="text-center text-white/30 text-base mt-1">
                        ≈ ${amountUsd} USD{" "}
                        {selectedToken &&
                          parseFloat(amount) >
                            parseFloat(tokenBalances[selectedToken] || "0") && (
                            <span className="text-red-400 text-sm mt-2">
                              Insufficient balance
                            </span>
                          )}
                      </p>
                    </div>
                  </div>

                  <div className="gap-4 space-y-2">
                    <div className="relative w-full">
                      <textarea
                        value={customMessage}
                        onChange={(e) => setCustomMessage(e.target.value)}
                        placeholder="Add note"
                        className="w-full rounded-2xl bg-white/5 text-white placeholder-white/20 p-4 resize-none"
                      />
                      <span className="absolute bottom-5 italic left-3 text-xs text-white/30 pointer-events-none">
                        Private notification message to @
                        {selectedUser?.username}
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
                          : `Send ${amount} ${selectedToken || ""}`}
                    </Button>
                    {selectedToken && (
                      <p className="text-center text-sm text-white/30 mt-2">
                        Balance:{" "}
                        {formatAmount(tokenBalances[selectedToken] || "0")}{" "}
                        {selectedToken}
                      </p>
                    )}
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
            setSelectedUser(null);
            setLastTxHash(null); // ✅ clear hash here
          }
        }}
        name="Payment Sent"
        description={
          lastMessage ||
          `Just sent ${lastSentAmount} ${selectedToken} to @${selectedUser?.username}`
        }
        recipientUsername={selectedUser?.username}
        txHash={lastTxHash ?? undefined}
      />
    </>
  );
}
