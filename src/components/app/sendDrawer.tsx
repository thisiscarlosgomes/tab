"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useSendDrawer } from "@/providers/SendDrawerProvider";
import { useAccount, useConnect, useSendTransaction } from "wagmi";

import { Button } from "../ui/button";
import { shortAddress } from "@/lib/shortAddress";
import { PaymentSuccessDrawer } from "@/components/app/PaymentSuccessDrawer";
import sdk from "@farcaster/frame-sdk";
import { NumericFormat } from "react-number-format";
import { getTokenBalance } from "@/lib/getTokenBalance";
import { tokenList } from "@/lib/tokens"; // or define inline
import { getTokenPrices } from "@/lib/getTokenPrices"; // or define inline
import { useWriteContract } from "wagmi";
import { createPublicClient, erc20Abi, http, isAddress, parseUnits } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { usePrivy, useWallets } from "@privy-io/react-auth";

import { LoaderCircle } from "lucide-react";
// import { useAddPoints } from "@/lib/useAddPoints";

import { getTokenBalances } from "@/hooks/getTokenBalances";
import { useTabIdentity } from "@/lib/useTabIdentity";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

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

type EnrichedCast = {
  hash: string;
  timestamp: string;
  channelKey?: string;
  author: {
    username: string;
    fid: number;
    pfp_url?: string;
  };
};

type SendStatus = "idle" | "confirming" | "sending";
type RecipientResolutionSource = "address" | "ens" | "tab" | "farcaster";

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

export function GlobalSendDrawer() {
  // const { isOpen, close, query, setQuery, scannedUsername } = useSendDrawer();

  const {
    isOpen,
    close,
    query,
    setQuery,
    scannedUsername,
    setSelectedUser,
    selectedUser,
    selectedToken,
    setSelectedToken,
    tokenType,
    setTokenType,
  } = useSendDrawer();

  const { isConnected, address } = useAccount();
  const { user } = usePrivy();
  const {
    fid: identityFid,
    username: identityUsername,
    pfp: identityPfp,
    address: identityAddress,
  } = useTabIdentity();
  const { connect, connectors } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();

  const inputRef = useRef<HTMLInputElement>(null);

  const [results, setResults] = useState<FarcasterUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // const [selectedUser, setSelectedUser] = useState<FarcasterUser | null>(null);
  const [amount, setAmount] = useState("0");
  const [sendDrawerOpen, setSendDrawerOpen] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastSentAmount, setLastSentAmount] = useState(0.01);
  const [customMessage, setCustomMessage] = useState("💸");
  const [lastMessage, setLastMessage] = useState("");

  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  // const [tokenType, setTokenType] = useState(tokenList[2]?.name ?? "ETH");
  // const [ethPriceUsd, setEthPriceUsd] = useState<number | null>(null);

  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);

  const [successAmount, setSuccessAmount] = useState<number | null>(null);
  const [successToken, setSuccessToken] = useState<string | null>(null);
  const [successRecipient, setSuccessRecipient] = useState<string | null>(null);

  const { wallets } = useWallets();
  const linkedFarcasterFid = user?.farcaster?.fid ?? null;
  const linkedFarcasterUsername = user?.farcaster?.username ?? null;
  const walletAddress = useMemo(() => {
    return isConnected && address ? address : (wallets[0]?.address ?? null);
  }, [isConnected, address, wallets]);

  // const [selectedToken, setSelectedToken] = useState<
  //   "ETH" | "USDC" | "TAB" | null
  // >(null);

  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [mode, setMode] = useState<"search" | "token">("search");
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>(
    {}
  );

  const { writeContractAsync } = useWriteContract();
  const [sharedCast, setSharedCast] = useState<EnrichedCast | null>(null);
  const [resolvedRecipientAddress, setResolvedRecipientAddress] = useState<
    `0x${string}` | null
  >(null);
  const [recipientResolutionSource, setRecipientResolutionSource] =
    useState<RecipientResolutionSource>("farcaster");

  useEffect(() => {
    const detectShareContext = async () => {
      let context: Awaited<typeof sdk.context> | null = null;
      try {
        context = await sdk.context;
      } catch {
        return;
      }

      if (context?.location?.type === "cast_share") {
        const cast = context.location.cast as unknown as EnrichedCast;
        const sharedUsername = cast.author.username;

        const res = await fetch(
          `/api/neynar/user/by-username?username=${sharedUsername}`
        );
        const data = await res.json();

        if (data?.username) {
          setSelectedUser(data);
          setSelectedToken("USDC");
          setTokenType("USDC");
          setSendDrawerOpen(true);
        }
      }
    };

    detectShareContext();
  }, []);

  useEffect(() => {
    if (!walletAddress || !walletAddress.startsWith("0x")) return;

    (async () => {
      const balances = await getTokenBalances({
        address: walletAddress as `0x${string}`,
        tokens: tokenList,
      });
      setTokenBalances(balances);
    })();
  }, [walletAddress]);

  // 👇 stage data first
  useEffect(() => {
    const fetchScannedUser = async () => {
      if (!isOpen || !scannedUsername || selectedUser || sendDrawerOpen) return;

      try {
        const res = await fetch(
          `/api/neynar/user/by-username?username=${scannedUsername}`
        );
        const data = await res.json();
        if (data?.username) {
          setSelectedUser(data);
          setSelectedToken("USDC");
          setTokenType("USDC");
          setMode("search");
        }
      } catch (e) {
        console.error("error fetching scanned user", e);
      }
    };

    fetchScannedUser();
  }, [isOpen, scannedUsername, selectedUser, sendDrawerOpen]);

  useEffect(() => {
    if (!selectedUser) return;
    if (!walletAddress) return;
    if (Object.keys(tokenBalances).length === 0) return;

    setSendDrawerOpen(true);
  }, [selectedUser, walletAddress, tokenBalances]);

  useEffect(() => {
    if (!selectedUser) {
      setResolvedRecipientAddress(null);
      setRecipientResolutionSource("farcaster");
      return;
    }

    let cancelled = false;
    const fallbackAddress =
      (selectedUser.verified_addresses?.primary?.eth_address as
        | `0x${string}`
        | undefined) ?? null;

    const resolvePreferredRecipient = async () => {
      try {
        const qs = new URLSearchParams();
        if (selectedUser.username) qs.set("username", selectedUser.username);
        if (fallbackAddress) qs.set("address", fallbackAddress);
        const res = await fetch(`/api/recipient-resolve?${qs.toString()}`);
        const data = await res.json().catch(() => null);
        if (cancelled) return;

        if (data?.resolved?.address) {
          setResolvedRecipientAddress(data.resolved.address);
          setRecipientResolutionSource(
            (data.resolved.source as RecipientResolutionSource) ?? "farcaster"
          );
          return;
        }
      } catch {
        // fall through to fallback
      }

      if (!cancelled) {
        setResolvedRecipientAddress(fallbackAddress);
        setRecipientResolutionSource("farcaster");
      }
    };

    void resolvePreferredRecipient();
    return () => {
      cancelled = true;
    };
  }, [selectedUser]);

  useEffect(() => {
    if (!isOpen || mode !== "search" || query.trim() !== "") return;

    const cacheKey =
      (linkedFarcasterFid ? `fid:${linkedFarcasterFid}` : null) ??
      linkedFarcasterUsername ??
      identityUsername ??
      identityAddress;

    if (!cacheKey) return;

    try {
      const cached = localStorage.getItem(`tab_friends_${cacheKey}`);
      if (!cached) return;
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setResults(parsed);
      }
    } catch {
      // ignore bad cache payloads
    }
  }, [
    isOpen,
    mode,
    query,
    linkedFarcasterFid,
    linkedFarcasterUsername,
    identityUsername,
    identityAddress,
  ]);

  useEffect(() => {
    if (!isOpen || mode !== "search") return;

    const delay = setTimeout(async () => {
      try {
        if (query.trim()) {
          setIsSearching(true);
          const trimmedQuery = query.trim();
          const normalizedQuery = trimmedQuery.replace(/^@/, "");

          if (isAddress(trimmedQuery)) {
            try {
              const profileRes = await fetch(
                `/api/neynar/user/by-address/${trimmedQuery}`
              );
              const profile = await profileRes.json().catch(() => null);

              const addressResult: FarcasterUser = {
                fid:
                  typeof profile?.fid === "number" && Number.isFinite(profile.fid)
                    ? profile.fid
                    : 0,
                username:
                  typeof profile?.username === "string" && profile.username
                    ? profile.username
                    : shortAddress(trimmedQuery),
                display_name:
                  typeof profile?.display_name === "string" && profile.display_name
                    ? profile.display_name
                    : shortAddress(trimmedQuery),
                pfp_url:
                  typeof profile?.pfp_url === "string" ? profile.pfp_url : "",
                verified_addresses:
                  profile?.verified_addresses &&
                  typeof profile.verified_addresses === "object"
                    ? profile.verified_addresses
                    : {
                        primary: {
                          eth_address: trimmedQuery,
                        },
                      },
              };

              setResults([addressResult]);
              return;
            } catch {
              setResults([
                {
                  fid: 0,
                  username: shortAddress(trimmedQuery),
                  display_name: shortAddress(trimmedQuery),
                  pfp_url: "",
                  verified_addresses: {
                    primary: {
                      eth_address: trimmedQuery,
                    },
                  },
                },
              ]);
              return;
            }
          }

          if (normalizedQuery.toLowerCase().endsWith(".eth")) {
            try {
              const ensClient = createPublicClient({
                chain: mainnet,
                transport: http(),
              });
              const ensAddress = await ensClient.getEnsAddress({
                name: normalize(normalizedQuery.toLowerCase()),
              });

              if (!ensAddress) {
                setResults([]);
                return;
              }

              const profileRes = await fetch(
                `/api/neynar/user/by-address/${ensAddress}`
              );
              const profile = await profileRes.json().catch(() => null);

              const ensResult: FarcasterUser = {
                fid:
                  typeof profile?.fid === "number" && Number.isFinite(profile.fid)
                    ? profile.fid
                    : 0,
                username:
                  typeof profile?.username === "string" && profile.username
                    ? profile.username
                    : normalizedQuery,
                display_name:
                  typeof profile?.display_name === "string" &&
                  profile.display_name
                    ? profile.display_name
                    : normalizedQuery,
                pfp_url:
                  typeof profile?.pfp_url === "string" ? profile.pfp_url : "",
                verified_addresses:
                  profile?.verified_addresses && typeof profile.verified_addresses === "object"
                    ? profile.verified_addresses
                    : {
                        primary: {
                          eth_address: ensAddress,
                        },
                      },
              };

              setResults([ensResult]);
              return;
            } catch {
              setResults([]);
              return;
            }
          }

          const res = await fetch(
            `/api/neynar/user/search?q=${encodeURIComponent(query)}`
          );
          const data = await res.json();
          const searchResults = data.users?.slice(0, 10) || [];
          setResults(searchResults);
        } else {
          const followingQuery = linkedFarcasterFid
            ? `fid=${encodeURIComponent(String(linkedFarcasterFid))}`
            : linkedFarcasterUsername
              ? `username=${encodeURIComponent(linkedFarcasterUsername)}`
              : identityFid
                ? `fid=${encodeURIComponent(String(identityFid))}`
            : identityUsername
              ? `username=${encodeURIComponent(identityUsername)}`
                : identityAddress
                ? `address=${encodeURIComponent(identityAddress)}`
                : null;

          if (!followingQuery) {
            setResults([]);
            return;
          }

          const res = await fetch(`/api/neynar/user/following?${followingQuery}`);
          const data = await res.json();

          if (Array.isArray(data)) {
            const next = data
              .slice(0, 20)
              .map((entry) => entry?.user ?? entry)
              .filter(Boolean);
            setResults(next);

            const cacheKey =
              (linkedFarcasterFid ? `fid:${linkedFarcasterFid}` : null) ??
              linkedFarcasterUsername ??
              identityUsername ??
              identityAddress;
            if (cacheKey) {
              localStorage.setItem(`tab_friends_${cacheKey}`, JSON.stringify(next));
            }
          } else {
            setResults([]);
          }
        }
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(delay);
  }, [
    query,
    isOpen,
    mode,
    linkedFarcasterFid,
    linkedFarcasterUsername,
    identityFid,
    identityUsername,
    identityAddress,
  ]);

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
      : "0";

  const handleSend = async () => {
    const parsedAmount = parseFloat(amount);
    const fallbackAddress = selectedUser?.verified_addresses?.primary
      ?.eth_address as `0x${string}` | undefined;
    const recipient = resolvedRecipientAddress ?? fallbackAddress ?? null;
    if (!recipient) return;
    if (!isConnected) {
      const connector = connectors[0];
      if (!connector) return;
      await connect({ connector });
    }
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    // ✅ Add this check here
    if (!selectedToken) {
      setSendStatus("idle");
      alert("Please select a token.");
      return;
    }

    setSendStatus("confirming");

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

      // snapshot success data
      setSuccessAmount(parsedAmount);
      setSuccessToken(selectedToken);
      setSuccessRecipient(selectedUser?.username ?? null);

      // optional message
      setLastMessage(customMessage?.trim() || "");

      // UI cleanup
      setCustomMessage("");
      setAmount("0");
      setSendDrawerOpen(false);
      setShowSuccess(true);
      close();

      if (walletAddress) {
        void fetch("/api/activity/client-transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderAddress: walletAddress,
            recipientAddress: recipient,
            amount: parsedAmount,
            token: selectedToken,
            txHash,
            note: customMessage?.trim() || null,
            recipientUsername: selectedUser?.username ?? null,
            recipientPfp: selectedUser?.pfp_url ?? null,
            senderUsername: identityUsername ?? null,
            senderPfp: identityPfp ?? null,
            recipientResolutionSource,
          }),
        }).catch(() => {});
      }

      // Incoming payment notifications are sent by the Moralis webhook to avoid duplicates.
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSendStatus("idle");
    }
  };

  const formatAmount = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return "0";

    // Preserve small balances (e.g. 0.001 ETH) instead of rounding to 0.
    if (num > 0 && num < 0.01) {
      return num.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
      });
    }

    return num.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
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
    amountNumber > balance ||
    !(resolvedRecipientAddress ?? selectedUser?.verified_addresses?.primary?.eth_address);
  const displayedRecipientAddress =
    resolvedRecipientAddress ??
    (selectedUser?.verified_addresses?.primary?.eth_address as
      | `0x${string}`
      | undefined) ??
    null;

  return (
    <>
      <ResponsiveDialog
        open={isOpen}
        onOpenChange={(v) => {
          if (!v) close();
        }}
      >
        <ResponsiveDialogContent className="scroll-smooth top-[80px] bottom-0 p-4 flex flex-col md:top-1/2 md:bottom-auto md:w-full md:max-w-md md:max-h-[85vh] md:overflow-hidden">
          <ResponsiveDialogTitle className="sr-only">Send</ResponsiveDialogTitle>

            {!scannedUsername && !sendDrawerOpen && (
              <>
                {/* Fixed top section */}
                <div className="pt-2 sticky top-0 bg-background z-10">
                  <ResponsiveDialogTitle className="text-lg text-center font-medium">
                    Send
                  </ResponsiveDialogTitle>
                  <div className="relative w-full mt-4">
                    
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder="farcaster @, ens, or 0x..."
                      value={query}
                      onFocus={() => {
                        if (mode === "token") {
                          setMode("search");
                          setQuery(""); // optional: reset input
                        }
                      }}
                      onChange={(e) => setQuery(e.target.value)}
                      className="w-full p-4 pl-6 pr-20 rounded-lg bg-white/5 text-white placeholder-white/20"
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
                <div className="flex-1 min-h-0 overflow-y-auto pb-8 space-y-2">
                  {mode === "search" && query.trim() !== "" && isSearching &&
                    Array.from({ length: 4 }).map((_, idx) => (
                      <div
                        key={`send-search-skeleton-${idx}`}
                        className="flex items-center p-3 rounded-lg bg-white/5 w-full"
                      >
                        <Skeleton className="w-8 h-8 rounded-full mr-3 shrink-0 border-0 bg-white/10" />
                        <div className="flex-1 min-w-0">
                          <Skeleton className="h-4 w-28 rounded-md border-0 bg-white/10" />
                          <Skeleton className="h-3 w-24 rounded-md border-0 bg-white/10 mt-2" />
                        </div>
                      </div>
                    ))}

                  {mode === "search" &&
                    !(query.trim() !== "" && isSearching) &&
                    results.map((user) => (
                      <button
                        key={user.fid}
                        onClick={() => {
                          setSelectedUser(user);
                          setSelectedToken("USDC"); // or default
                          setTokenType("USDC");
                          setSendDrawerOpen(true); // ✅ open send screen
                        }}
                        className="flex items-center p-3 rounded-lg bg-white/5 hover:bg-white/10 w-full"
                      >
                        <UserAvatar
                          src={user.pfp_url}
                          seed={user.username ?? user.fid}
                          width={32}
                          className="w-8 h-8 rounded-full object-cover mr-3 shrink-0"
                        />
                        <div className="text-left">
                          <p className="text-white font-medium">
                            @{user.username}
                          </p>
                        </div>
                      </button>
                    ))}

                  {mode === "search" &&
                    query.trim() !== "" &&
                    !isSearching &&
                    results.length === 0 && (
                      <div className="py-8 text-center text-white/40 text-sm">
                        No results
                      </div>
                    )}

                  {/* {mode === "token" && (
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
                                setTokenType(token.name);
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
                  )} */}
                </div>
              </>
            )}

            <ResponsiveDialog
              open={sendDrawerOpen}
              onOpenChange={(v) => {
                if (!v) {
                  setSendDrawerOpen(false);

                  // reset only UI-specific fields
                  setAmount("0");
                  setCustomMessage("");
                  setSendStatus("idle");

                  // Close the parent search dialog too, so it doesn't reappear
                  // when the send details dialog is dismissed.
                  close();

                  // Provider state (selected user/query/etc.) is reset by close().
                }
              }}
            >
              <ResponsiveDialogContent className="top-[80px] bottom-0 bg-background p-4 space-y-2 rounded-t-3xl h-[100dvh] md:top-1/2 md:bottom-auto md:w-full md:max-w-md md:h-auto md:max-h-[85vh] md:rounded-2xl">
                  <ResponsiveDialogTitle className="text-lg text-center font-medium">
                    <div className="p-4 flex flex-col items-center space-y-1">
                      <div className="relative w-16 h-16 rounded-full bg-purple-100 text-purple-800 flex items-center justify-center">
                        <UserAvatar
                          src={selectedUser?.pfp_url}
                          seed={selectedUser?.username ?? selectedUser?.fid}
                          width={64}
                          alt={selectedUser?.username ?? "Recipient"}
                          className="w-16 h-16 rounded-full object-cover"
                        />
                        <img
                          src={
                            tokenList.find((t) => t.name === selectedToken)
                              ?.icon!
                          }
                          alt={selectedToken!}
                          className="absolute bottom-0 -right-2 w-6 h-6 rounded-full border-2 border-card mb-2"
                        />
                      </div>

                      <ResponsiveDialogTitle className="text-lg font-medium text-center mt-4 pt-4">
                        You're sending {""}
                        <span className="text-primary mt-2">
                          @{selectedUser?.username}
                        </span>
                      </ResponsiveDialogTitle>

                      <p className="text-white/30 text-sm break-all text-center">
                        {displayedRecipientAddress ? (
                          shortAddress(displayedRecipientAddress)
                        ) : (
                          <span className="text-red-400 text-sm">
                            This user has no connected wallet
                          </span>
                        )}
                      </p>
                    </div>
                  </ResponsiveDialogTitle>
                  <div className="w-full text-center text-primary bg-transparent outline-none flex justify-center items-baseline">
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
                        // suffix={` ${selectedToken || ""}`}
                        prefix={getTokenSuffix(tokenType)}
                        placeholder={`${getTokenSuffix(tokenType)}0`}
                        className={`leading-none text-5xl bg-transparent text-center font-medium outline-none w-full placeholder-white/20 ${
                          amount === "" || amount === "0"
                            ? "text-white/20"
                            : "text-primary"
                        }`}
                      />

                      <p className="text-center text-white/30 text-sm mb-2">
                        {selectedToken && (
                          <>
                            <span className="text-center text-white/30 mt-2">
                              {tokenBalances[selectedToken] === undefined
                                ? "Loading balance..."
                                : `Balance: ${formatAmount(tokenBalances[selectedToken])} ${selectedToken}`}
                            </span>
                            <span
                              className="ml-1 text-primary"
                              onClick={() => {
                                setTokenDrawerOpen(true);
                              }}
                            >
                              Change
                            </span>
                          </>
                        )}

                        {selectedToken &&
                          parseFloat(amount) >
                            parseFloat(tokenBalances[selectedToken] || "0") && (
                            <span className="text-red-400 ml-1">
                              Insufficient balance
                            </span>
                          )}
                      </p>
                    </div>
                  </div>

                  <div className="w-full hidden">
                    <button
                      onClick={() => setTokenDrawerOpen(true)}
                      className="w-full flex items-center justify-between p-4 rounded-lg bg-white/5"
                    >
                      <div className="flex items-center gap-2">
                        <img
                          src={
                            tokenList.find((t) => t.name === selectedToken)
                              ?.icon
                          }
                          className="w-6 h-6 rounded-full"
                          alt={selectedToken ?? ""}
                        />
                        <span className="text-white">{selectedToken}</span>
                      </div>
                      <span className="text-white/20">Change</span>
                    </button>
                  </div>

                  <div className="space-y-1">
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

                    <Button
                      onClick={handleSend}
                      disabled={isDisabled}
                      className="w-full bg-primary"
                    >
                      {sendStatus === "confirming" ? (
                        <>
                          <LoaderCircle className="animate-spin w-4 h-4" />
                          Confirming...
                        </>
                      ) : sendStatus === "sending" ? (
                        "Sending..."
                      ) : (
                        `Send`
                      )}
                    </Button>
                    {/* {selectedToken && (
                      <p className="text-center text-sm text-white/30 mt-2">
                        Balance:{" "}
                        {formatAmount(tokenBalances[selectedToken] || "0")}{" "}
                        {selectedToken}
                      </p>
                    )} */}
                  </div>
                </ResponsiveDialogContent>
            </ResponsiveDialog>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog open={tokenDrawerOpen} onOpenChange={setTokenDrawerOpen}>
        <ResponsiveDialogContent className="scroll-smooth top-[200px] bottom-0 bg-background p-4 rounded-t-3xl flex flex-col md:top-1/2 md:bottom-auto md:w-full md:max-w-md md:max-h-[85vh] md:rounded-2xl">
            <div className="px-0 pt-2">
              <ResponsiveDialogTitle className="text-md text-center font-medium mb-3">
                Select payment token
              </ResponsiveDialogTitle>

              <div className="space-y-2">
                {/* {tokenList.map((token) => (
                  <button
                    key={token.name}
                    onClick={() => {
                      setSelectedToken(token.name as "ETH" | "USDC" | "TAB");
                      setTokenType(token.name);
                      setTokenDrawerOpen(false);
                    }}
                    className="w-full flex items-center p-3 rounded-lg bg-white/5 hover:bg-white/10"
                  >
                    <img
                      src={token.icon}
                      className="w-8 h-8 rounded-full mr-4"
                      alt={token.name}
                    />
                    <div className="text-left">
                      <p className="text-white font-medium">{token.name}</p>
                    </div>
                  </button>
                ))} */}

                {tokenList.map((token) => {
                  const balance = tokenBalances[token.name];
                  const balanceText =
                    balance === undefined
                      ? "..."
                      : `${parseFloat(balance).toFixed(3)} ${token.name}`;
                  const numericBalance = Number.parseFloat(balance ?? "0");
                  const canSelectToken = Number.isFinite(numericBalance) && numericBalance > 0;

                  return (
                    <button
                      key={token.name}
                      onClick={() => {
                        if (!canSelectToken) return;
                        setSelectedToken(token.name as "ETH" | "USDC" | "TAB");
                        setTokenType(token.name);
                        setTokenDrawerOpen(false);
                      }}
                      disabled={!canSelectToken}
                      className={`w-full flex items-center justify-between p-4 rounded-xl bg-white/5 ${
                        canSelectToken ? "hover:bg-white/10" : "opacity-50 cursor-not-allowed"
                      }`}
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
          </ResponsiveDialogContent>
      </ResponsiveDialog>

      <PaymentSuccessDrawer
        isOpen={showSuccess}
        setIsOpen={(v) => {
          setShowSuccess(v);
          if (!v) {
            setLastTxHash(null);
            setSuccessAmount(null);
            setSuccessToken(null);
            setSuccessRecipient(null);
          }
        }}
        name="Payment Sent"
        description={
          successAmount && successToken
            ? `You paid ${successAmount} ${successToken}${
                lastMessage ? ` — ${lastMessage}` : ""
              }`
            : undefined
        }
        recipientUsername={successRecipient ?? undefined}
        txHash={lastTxHash ?? undefined}
      />
    </>
  );
}
