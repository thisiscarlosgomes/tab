"use client";

import { Drawer } from "vaul";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useSendTransaction } from "wagmi";
import { shortAddress } from "@/lib/shortAddress";
import { Button } from "../ui/button";
import { PaymentSuccessDrawer } from "./PaymentSuccessDrawer";
import sdk from "@farcaster/frame-sdk";
// import { useAddPoints } from "@/lib/useAddPoints";
import { ReceiptText, LoaderCircle } from "lucide-react";
import { tokenList } from "@/lib/tokens";
import { erc20Abi, parseUnits, createWalletClient, custom } from "viem";
import { useWriteContract } from "wagmi";
import NumberFlow from "@number-flow/react";

import { useWallets } from "@privy-io/react-auth";
import { base } from "viem/chains";

import { toast } from "sonner";
import { useTabIdentity } from "@/lib/useTabIdentity";

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

type Participant = {
  address: string;
  name: string;
  pfp?: string;
  fid?: string;
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
  const { connect, connectors } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();
  const { wallets } = useWallets();
  const {
    fid: identityFid,
    username: identityUsername,
    pfp: identityPfp,
    address: identityAddress,
  } = useTabIdentity();

  const [sending, setSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const { writeContractAsync } = useWriteContract();
  const tokenInfo = tokenList.find((t) => t.name === token);
  const fallbackToken = tokenList.find((t) => t.name === "ETH");
  const effectiveTokenInfo = tokenInfo ?? fallbackToken;
  const effectiveToken = effectiveTokenInfo?.name ?? "ETH";
  const [farcasterUsername, setFarcasterUsername] = useState<string | null>(
    null
  );
  const [farcasterPfp, setFarcasterPfp] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<FarcasterUser | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);

  const [invitedOnly, setInvitedOnly] = useState(false);
  const [invited, setInvited] = useState<Participant[]>([]);
  const [creator, setCreator] = useState<string | null>(null);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [verifiedEthAddresses, setVerifiedEthAddresses] = useState<string[]>(
    []
  );

  const tokenIcon = effectiveTokenInfo?.icon ? (
    <img
      src={effectiveTokenInfo.icon}
      alt={effectiveTokenInfo.name}
      className="absolute bottom-0 -right-2 w-7 h-7 rounded-full border-2 border-background"
    />
  ) : null;

  const [insideFrame, setInsideFrame] = useState(false);

  useEffect(() => {
    const checkFrame = async () => {
      try {
        const context = await sdk.context;
        setInsideFrame(!!context);
      } catch {
        setInsideFrame(false);
      }
    };

    checkFrame();
  }, []);

  useEffect(() => {
    if (!splitId) return;

    const fetchParticipants = async () => {
      try {
        const res = await fetch(`/api/split/${splitId}`);
        const data = await res.json();
        setParticipants(data?.participants || []);
        setInvitedOnly(data?.invitedOnly ?? false);
        setInvited(data?.invited || []);
        setCreator(data?.creator?.address?.toLowerCase() || null);
      } catch (err) {
        console.warn("Could not fetch participants", err);
      }
    };

    fetchParticipants();
  }, [splitId]);

  useEffect(() => {
    if (!address) return;
    const checkFarcaster = async () => {
      try {
        const res = await fetch(`/api/neynar/user/by-address/${address}`);
        const data = await res.json();
        const user = data?.result?.user;

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
    const resolveAddress = async () => {
      let username = identityUsername;
      if (!username) {
        try {
          const context = await sdk.context;
          username = context?.user?.username ?? null;
        } catch {
          username = null;
        }
      }

      if (username) {
        const res = await fetch(
          `/api/neynar/user/by-username?username=${username}`
        );
        const data = await res.json();
        const verified = data?.verified_addresses?.primary?.eth_address;
        const allEth = data?.verified_addresses?.eth_addresses || [];

        if (verified) {
          setUserAddress(verified.toLowerCase());
        }
        setVerifiedEthAddresses(allEth.map((a: string) => a.toLowerCase()));
        return;
      }

      if (identityAddress) {
        setUserAddress(identityAddress.toLowerCase());
        setVerifiedEthAddresses([identityAddress.toLowerCase()]);
      }
    };

    resolveAddress();
  }, [identityAddress, identityUsername]);

  useEffect(() => {
    if (!invitedOnly || verifiedEthAddresses.length === 0) {
      setIsBlocked(false);
      return;
    }

    const isInvited = invited.some((i) =>
      verifiedEthAddresses.includes(i.address.toLowerCase())
    );

    const isCreator = creator && verifiedEthAddresses.includes(creator);
    const alreadyJoined = participants.some((p) =>
      verifiedEthAddresses.includes(p.address.toLowerCase())
    );

    setIsBlocked(!(isInvited || isCreator || alreadyJoined));
  }, [invitedOnly, invited, participants, creator, verifiedEthAddresses]);

  // useEffect(() => {
  //   if (!isOpen) {
  //     setSending(false);
  //     setLastTxHash(null);
  //   }
  // }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSending(false);
      // ❌ DO NOT clear lastTxHash here
    }
  }, [isOpen]);

  const handleSend = async () => {
    if (!address || !amount || amount <= 0) return;

    let context: Awaited<typeof sdk.context> | null = null;
    try {
      context = await sdk.context;
    } catch {
      context = null;
    }
    const fid = context?.user?.fid ?? identityFid ?? undefined;
    const username = context?.user?.username ?? identityUsername ?? null;
    const senderPfp = context?.user?.pfpUrl ?? identityPfp ?? "";

    const privyProvider = await wallets[0]?.getEthereumProvider?.();

    // --- ensure Base ---
    if (privyProvider) {
      const currentChainId = await privyProvider.request({
        method: "eth_chainId",
      });

      if (currentChainId !== "0x2105") {
        await privyProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x2105" }],
        });
      }
    }

    const decimals = effectiveTokenInfo?.decimals ?? 18;
    const rawAmount = parseUnits(amount.toString(), decimals);

    setSending(true);

    try {
      let txHash: `0x${string}`;

      // --- SEND TX ---
      if (isConnected) {
        // Farcaster frame wallet
        if (!effectiveTokenInfo?.address) {
          txHash = await sendTransactionAsync({
            to: address,
            value: rawAmount,
            chainId: 8453,
          });
        } else {
          txHash = await writeContractAsync({
            address: effectiveTokenInfo.address as `0x${string}`,
            abi: erc20Abi,
            functionName: "transfer",
            args: [address, rawAmount],
            chainId: 8453,
          });
        }
      } else if (privyProvider) {
        // Privy wallet
        const privyClient = createWalletClient({
          account: wallets[0].address as `0x${string}`,
          chain: base,
          transport: custom(privyProvider),
        });

        if (!effectiveTokenInfo?.address) {
          txHash = await privyClient.sendTransaction({
            to: address,
            value: rawAmount,
          });
        } else {
          txHash = await privyClient.writeContract({
            address: effectiveTokenInfo.address as `0x${string}`,
            abi: erc20Abi,
            functionName: "transfer",
            args: [address, rawAmount],
          });
        }
      } else {
        const connector = connectors[0];
        if (!connector) {
          setSending(false);
          return;
        }
        await connect({ connector });
        setSending(false);
        return;
      }

      // --- SUCCESS UI ---
      setLastTxHash(txHash);
      setShowSuccess(true);
      setTimeout(() => onOpenChange(false), 300);
      setSuccessMessage(
        splitId
          ? `Paid ${amount.toFixed(2)} ${effectiveToken}`
          : `Sent ${amount.toFixed(2)} ${effectiveToken}`
      );

      if (!splitId) {
        const senderAddress =
          (userAddress ?? identityAddress ?? wallets[0]?.address ?? null)?.toLowerCase() ?? null;
        if (senderAddress) {
          void fetch("/api/activity/client-transfer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              senderAddress,
              recipientAddress: address,
              amount,
              token: effectiveToken,
              txHash,
              recipientUsername: farcasterUsername ?? null,
              recipientPfp: farcasterPfp ?? null,
              senderUsername: username ?? null,
              senderPfp: senderPfp || null,
              recipientResolutionSource: farcasterUsername ? "farcaster" : "address",
            }),
          }).catch(() => {});
        }
      }

      // --- UPDATE SPLIT (CRITICAL FIX) ---
      if (splitId) {
        let senderAddress = (
          userAddress ??
          identityAddress ??
          wallets[0]?.address ??
          address
        ).toLowerCase();

        // Resolve verified address (authoritative)
        if (username) {
          try {
            const res = await fetch(
              `/api/neynar/user/by-username?username=${username}`
            );
            const data = await res.json();
            const verified = data?.verified_addresses?.primary?.eth_address;
            if (verified) senderAddress = verified.toLowerCase();
          } catch {}
        }

        const participant = {
          fid, // ✅ CANONICAL
          address: senderAddress,
          name: username ?? senderAddress.slice(0, 6),
          pfp: senderPfp,
        };

        // 🔥 ALWAYS PATCH — backend handles dedupe
        await fetch(`/api/split/${splitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participant,
            payment: {
              fid, // ✅ REQUIRED
              address: senderAddress,
              name: participant.name,
              txHash,
              token: effectiveToken,
              amount, // ✅ REQUIRED
              pfp: senderPfp,
            },
          }),
        });
      }

      setTimeout(() => onOpenChange(false), 150);
    } catch (err) {
      console.error("Send failed", err);
      toast.error("Payment failed. Try again.");
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
          <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-20" />
          <Drawer.Content className="space-y-4 p-4 z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background rounded-t-3xl flex flex-col">
            <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-1" />

            <Drawer.Title className="text-lg text-center font-medium flex flex-col items-center justify-center">
              <div className="relative w-16 h-16 rounded-full mb-4 bg-purple-100 text-purple-800 flex items-center justify-center">
                <ReceiptText className="w-7 h-7" />
                {tokenIcon}
              </div>
              {billName && (
                <p className="text-white text-xl">Group Bill: {billName}</p>
              )}
            </Drawer.Title>

            <div className="text-center">
              {participants.length > 0 && (
                <div className="flex justify-center -space-x-3 mt-1">
                  {participants.slice(0, 8).map((p) => (
                    <img
                      key={p.address}
                      src={
                        p.pfp ||
                        `https://api.dicebear.com/9.x/glass/svg?seed=${p.address || p.address}`
                      }
                      alt={p.address}
                      className="w-8 h-8 rounded-full border-2 border-white object-cover"
                    />
                  ))}
                  {participants.length > 8 && (
                    <span className="w-8 h-8 flex items-center justify-center bg-card text-white text-xs font-medium rounded-full border-2 border-white">
                      +{participants.length - 8}
                    </span>
                  )}
                </div>
              )}
              <p className="text-white text-lg">
                <span className="hidden">sending 2</span>
                You're sending {""}
                <span className="text-primary">
                  {farcasterUsername
                    ? `@${farcasterUsername}`
                    : shortAddress(address)}
                </span>
              </p>
              <NumberFlow
                value={amount}
                format={{
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }}
                prefix={getTokenSuffix(effectiveToken)}
                className={`text-5xl font-medium ${
                  amount > 0 ? "text-primary" : "text-white/30"
                }`}
              />
            </div>

            <Button
              onClick={handleSend}
              disabled={sending || isBlocked}
              className="w-full bg-primary mt-4"
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

            {isBlocked && (
              <p className="text-center text-red-400 text-sm mt-2">
                Only invited users can pay this group bill.
              </p>
            )}

            {/* <div className="text-center">
              <p className="text-white text-base">
                You're sending {""}
                <span className="text-primary">
                  {farcasterUsername
                    ? `@${farcasterUsername}`
                    : shortAddress(address)}
                </span>
              </p>
            </div> */}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <PaymentSuccessDrawer
        isOpen={showSuccess}
        setIsOpen={(v) => {
          setShowSuccess(v);
          if (!v) {
            setLastTxHash(null); // ✅ reset ONLY when success drawer closes
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
