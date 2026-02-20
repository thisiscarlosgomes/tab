"use client";

import { Drawer } from "vaul";
import { useEffect, useState, useMemo } from "react";
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
// import { erc20Abi, parseUnits } from "viem";
import { erc20Abi, parseUnits, createWalletClient, custom } from "viem";
import { base } from "viem/chains";
import sdk from "@farcaster/frame-sdk";
import { useWallets } from "@privy-io/react-auth";
import { LoaderCircle } from "lucide-react";

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

const getTokenSuffix = (token: string) => {
  switch (token) {
    case "ETH":
    case "WETH":
      return "Ξ";
    case "EURC":
      return "€";
    case "USDC":
    default:
      return "$";
  }
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
  const { isConnected, address: userAddress } = useAccount();
  const { connect } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const [selectedUser, setSelectedUser] = useState<FarcasterUser | null>(null);
  const [amount, setAmount] = useState("0");
  const [sending, setSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [customMessage, setCustomMessage] = useState("💸");
  const [showTokenDrawer, setShowTokenDrawer] = useState(false);
  const [selectedToken, setSelectedToken] = useState<"ETH" | "USDC" | "TAB">(
    "USDC"
  );
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>(
    {}
  );
  const [tokenType, setTokenType] = useState(tokenList[2]?.name ?? "ETH");

  const [farcasterUsername, setFarcasterUsername] = useState<string | null>(
    null
  );
  const [farcasterPfp, setFarcasterPfp] = useState<string | null>(null);

  const { wallets } = useWallets();

  const balance = parseFloat(tokenBalances[selectedToken] || "0");
  const parsedAmount = parseFloat(amount);
  const isInsufficient = parsedAmount > balance;
  const isDisabled =
    sendStatus !== "idle" ||
    sending ||
    isNaN(parsedAmount) ||
    parsedAmount <= 0 ||
    isInsufficient;

  const selectedTokenMeta = tokenList.find((t) => t.name === selectedToken);
  const [insideFrame, setInsideFrame] = useState(false);

  useEffect(() => {
    const checkFrame = async () => {
      const context = await sdk.context;
      setInsideFrame(!!context);
    };

    checkFrame();
  }, []);

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
          setSelectedUser(null);
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
      setSelectedToken("USDC");
      setTokenType("USDC");
      setCustomMessage("💸");
      setSelectedUser(null);
    }
  }, [isOpen]);

  const walletAddress = useMemo(() => {
    return isConnected && userAddress
      ? userAddress
      : (wallets[0]?.address ?? null);
  }, [isConnected, userAddress, wallets]);

  useEffect(() => {
    const resolvedAddress =
      isConnected && userAddress ? userAddress : wallets[0]?.address;

    if (!isOpen || !resolvedAddress || !resolvedAddress.startsWith("0x"))
      return;

    const fetchBalancesAndPrices = async () => {
      const prices = await getTokenPrices();
      setTokenPrices(prices);

      const balances: Record<string, string> = {};
      for (const token of tokenList) {
        const balance = await getTokenBalance({
          tokenAddress: token.address as `0x${string}` | undefined,
          userAddress: resolvedAddress as `0x${string}`,
          decimals: token.decimals,
        });
        balances[token.name] = balance;
      }

      setTokenBalances(balances);
    };

    fetchBalancesAndPrices();
  }, [isOpen, isConnected, userAddress, wallets]);

  const handleSend = async () => {
    if (!address || parsedAmount <= 0 || isNaN(parsedAmount)) return;
    const context = await sdk.context;
    const sender = context?.user?.username;
    // const privyProvider = await wallets[0]?.getEthereumProvider?.();

    const privyProvider = await wallets[0]?.getEthereumProvider?.();
    if (!privyProvider) throw new Error("Privy provider not found");

    // Force switch to Base if needed
    const currentChainId = await privyProvider.request({
      method: "eth_chainId",
    });
    if (currentChainId !== "0x2105") {
      await privyProvider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }],
      });
    }

    const token = tokenList.find((t) => t.name === selectedToken);
    const decimals = token?.decimals ?? 18;
    const rawAmount = parseUnits(amount, decimals);

    setSending(true);
    try {
      let txHash: `0x${string}`;

      if (isConnected) {
        if (selectedToken === "ETH") {
          txHash = await sendTransactionAsync({
            to: address,
            value: rawAmount,
            chainId: 8453,
          });
        } else {
          if (!token?.address) throw new Error("Token address missing");
          txHash = await writeContractAsync({
            address: token.address as `0x${string}`,
            abi: erc20Abi,
            functionName: "transfer",
            args: [address, rawAmount],
            chainId: 8453,
          });
        }
      } else if (privyProvider) {
        const privyClient = createWalletClient({
          account: wallets[0].address as `0x${string}`,
          chain: base,
          transport: custom(privyProvider),
        });

        if (selectedToken === "ETH") {
          txHash = await privyClient.sendTransaction({
            to: address,
            value: rawAmount,
          });
        } else {
          if (!token?.address) throw new Error("Token address missing");
          txHash = await privyClient.writeContract({
            address: token.address as `0x${string}`,
            abi: erc20Abi,
            functionName: "transfer",
            args: [address, rawAmount],
          });
        }
      } else {
        await connect({ connector: farcasterFrame() });
        return;
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
            senderUsername: sender,
          }),
        });
      }

      setTimeout(() => onOpenChange(false), 100);
    } catch (e) {
      console.error("Send failed", e);
    } finally {
      setSending(false);
    }
  };

  const formatAmount = (value: string) => {
    const num = parseFloat(value);
    return isNaN(num)
      ? "0"
      : num.toLocaleString("en-US", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 4,
        });
  };

  return (
    <>
      <Drawer.Root
        open={isOpen}
        onOpenChange={onOpenChange}
        repositionInputs={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-20" />
          <Drawer.Content className="scroll-smooth z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background p-4 space-y-4 rounded-t-3xl">
            <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10" />
            <Drawer.Title className="hidden text-lg text-center font-medium">
              Send
            </Drawer.Title>
            <div className="text-center">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-purple-100 relative">
                  {farcasterPfp ? (
                    <img
                      src={farcasterPfp}
                      alt={farcasterUsername ?? address}
                      className="w-full h-full rounded-full"
                    />
                  ) : (
                    <ReceiptText className="w-7 h-7 m-auto mt-[14px] text-purple-800" />
                  )}
                  {selectedTokenMeta?.icon && (
                    <img
                      src={selectedTokenMeta.icon}
                      alt={selectedToken}
                      className="absolute bottom-0 -right-2 w-6 h-6 rounded-full border-2 border-background"
                    />
                  )}
                </div>
              </div>
              <span className="hidden">sending 1</span>
              <p className="text-white">
                You're sending{" "}
                <span className="text-primary">
                  {farcasterUsername
                    ? `@${farcasterUsername}`
                    : shortAddress(address)}
                </span>
              </p>
            </div>
            <div className="flex flex-col">
              <NumericFormat
                inputMode="decimal"
                pattern="[0-9]*"
                value={amount}
                onValueChange={(values) => setAmount(values.value)}
                onFocus={() => amount === "0" && setAmount("")}
                thousandSeparator
                allowNegative={false}
                allowLeadingZeros={false}
                decimalScale={4}
                // suffix={` ${selectedToken}`}
                prefix={getTokenSuffix(tokenType)}
                placeholder="0"
                className={`text-5xl text-center font-medium outline-none w-full bg-transparent placeholder-white/20 ${
                  amount === "" || amount === "0"
                    ? "text-white/20"
                    : "text-primary"
                }`}
              />
              <p className="text-center text-sm text-white/30 mt-2">
                {formatAmount(tokenBalances[selectedToken] || "0")}{" "}
                {selectedToken} Available
                {isInsufficient && (
                  <span className="text-red-400 ml-1">
                    Insufficient balance
                  </span>
                )}
              </p>
            </div>
            <div className="w-full hidden">
              <button
                onClick={() => setShowTokenDrawer(true)}
                className="w-full flex items-center justify-between p-4 rounded-lg bg-white/5"
              >
                <div className="flex items-center gap-2">
                  <img
                    src={selectedTokenMeta?.icon}
                    className="w-6 h-6 rounded-full"
                    alt={selectedToken}
                  />
                  <span className="text-white">{selectedToken}</span>
                </div>
                <span className="text-white/20">Change</span>
              </button>
            </div>
            {selectedUser && (
              <div className="relative w-full">
                <textarea
                  rows={2}
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="Add note"
                  className="w-full rounded-2xl bg-white/5 text-white placeholder-white/20 p-4 resize-none"
                />
                <span className="absolute bottom-5 italic left-3 text-xs text-white/30 pointer-events-none">
                  Private message (optional)
                </span>
              </div>
            )}
            <Button
              onClick={handleSend}
              disabled={isDisabled}
              className="w-full bg-primary"
            >
              {sending ? (
                <>
                  <LoaderCircle className="animate-spin w-4 h-4" />
                  Sending...
                </>
              ) : (
                <>Send</>
              )}
            </Button>

            {!insideFrame && (
              <div className="w-full flex">
                <a
                  href="https://warpcast.com/miniapps/VQkdXWdIPV4K/tab"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-white text-black rounded-lg text-center p-4 font-medium"
                >
                  Issues? Pay on Farcaster
                </a>
              </div>
            )}

            {walletAddress && (
              <p className="hidden text-center text-white/30 text-sm mt-2">
                From:{" "}
                <span className="text-white">
                  {shortAddress(walletAddress)}
                </span>
              </p>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <Drawer.Root open={showTokenDrawer} onOpenChange={setShowTokenDrawer}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-50" />
          <Drawer.Content className="scroll-smooth z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background p-0 rounded-t-3xl flex flex-col">
            <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 my-4" />
            <div className="px-4">
              <Drawer.Title className="text-lg text-center font-medium mb-4">
                Select token
              </Drawer.Title>
              <div className="space-y-2">
                {tokenList.map((token) => {
                  const balance = tokenBalances[token.name];
                  const balanceText =
                    balance === undefined
                      ? "..."
                      : `${parseFloat(balance).toFixed(3)} ${token.name}`;

                  return (
                    <button
                      key={token.name}
                      onClick={() => {
                        setSelectedToken(token.name as "ETH" | "USDC" | "TAB");
                        setShowTokenDrawer(false);
                        setTokenType(token.name);
                      }}
                      className="w-full flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={token.icon}
                          className="w-8 h-8 rounded-full"
                          alt={token.name}
                        />
                        <p className="text-white font-medium">{token.name}</p>
                      </div>
                      <span className="text-sm text-white/40">
                        {balanceText}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
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
