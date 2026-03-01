"use client";

import { useEffect, useState } from "react";
import { Drawer } from "vaul";
import { NumericFormat } from "react-number-format";
import { tokenList } from "@/lib/tokens";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import Link from "next/link";
import { useAccount } from "wagmi";
import { parseEther, parseUnits } from "viem";
import { useSendTransaction, useWriteContract } from "wagmi";
import { erc20Abi } from "viem";
import { getTokenBalance } from "@/lib/getTokenBalance";
import { DropSuccessDrawer } from "@/components/app/DropSuccessDrawer";
import { toast } from "sonner";
import { shortAddress } from "@/lib/shortAddress";
import { LoaderCircle } from "lucide-react";
import { useTabIdentity } from "@/lib/useTabIdentity";

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

type Drop = {
  dropId: string;
  groupId?: string; // 🆕
  token: string;
  amount: string;
  claimed: boolean;
  txHash?: string;
  claimedBy?: string;
  claimedByFid?: number; // 🆕
  claimedCount?: number;
  totalCount?: number;
  creator: {
    name?: string;
    address: string;
  };
};

type DropResponseItem = {
  dropId: string;
  claimToken?: string;
  claimUrl?: string;
};

type GroupDropClaim = {
  claimed?: boolean;
  claimedBy?: string | null;
};

export default function DropCreatePage() {
  const { dismiss } = useFrameSplash();
  const { address } = useAccount();
  const {
    username: identityUsername,
    pfp: identityPfp,
    fid: identityFid,
  } = useTabIdentity();
  const [creator, setCreator] = useState<{
    address: string;
    name?: string;
    fid?: number;
    pfp?: string;
  } | null>(null);

  const [amount, setAmount] = useState("");
  const [tokenType, setTokenType] = useState("USDC");
  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);
  const [claimUrl, setClaimUrl] = useState<string[] | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const [numRecipients, setNumRecipients] = useState("1");
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>(
    {}
  );

  const TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;
  const maxAllowed = tokenType === "ETH" ? 0.05 : 100;

  const parsed = isNaN(Number(amount)) ? 0 : parseFloat(amount);
  const count = parseInt(numRecipients || "1");
  const isValidCount = count > 0 && count <= 50;
  const splitAmount = parsed / count;
  const hasBalance = parseFloat(tokenBalances[tokenType] || "0") >= parsed;
  const isValidAmount = parsed > 0 && parsed <= maxAllowed;

  const [myDrops, setMyDrops] = useState<Drop[]>([]);
  const [copiedDropId, setCopiedDropId] = useState<string | null>(null);
  const [resolvedClaimNames, setResolvedClaimNames] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    const resolveClaimedAddresses = async () => {
      const addresses = myDrops
        .filter((d) => d.claimed && d.claimedBy)
        .map((d) => d.claimedBy?.toLowerCase());

      const unique = [...new Set(addresses)].filter(Boolean);

      const results: Record<string, string> = {};
      await Promise.all(
        unique.map(async (addr) => {
          try {
            const [tabRes, neynarRes] = await Promise.all([
              fetch(`/api/user/by-address/${addr}`),
              fetch(`/api/neynar/user/by-address/${addr}`),
            ]);
            const tabData = await tabRes.json().catch(() => null);
            const neynarData = await neynarRes.json().catch(() => null);
            const username =
              (typeof tabData?.username === "string" && tabData.username.trim()) ||
              (typeof neynarData?.username === "string" && neynarData.username.trim()) ||
              null;
            results[addr!] = username ? `@${username}` : addr!;
          } catch {
            results[addr!] = addr!;
          }
        })
      );
      setResolvedClaimNames(results);
    };

    if (myDrops.some((d) => d.claimed && d.claimedBy)) {
      resolveClaimedAddresses();
    }
  }, [myDrops]);

  useEffect(() => {
    if (!address) {
      setCreator(null);
      return;
    }

    setCreator({
      address,
      name: identityUsername ?? address.slice(0, 6),
      fid: identityFid ?? undefined,
      pfp: identityPfp ?? "",
    });
  }, [address, identityFid, identityPfp, identityUsername]);

  useEffect(() => {
    const fetchMyDrops = async () => {
      if (!creator) return;
      const res = await fetch(`/api/drop?creator=${creator.address}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.drops)) {
        setMyDrops(data.drops);
      }
    };

    fetchMyDrops();
  }, [creator]);

  useEffect(() => {
    if (!creator) return;

    const fetchBalances = async () => {
      const balances = await Promise.all(
        tokenList.map(async (token) => {
          const balance = await getTokenBalance({
            tokenAddress: token.address as `0x${string}` | undefined,
            userAddress: creator.address as `0x${string}`,
            decimals: token.decimals,
          });
          return [token.name, balance] as const;
        })
      );
      setTokenBalances(Object.fromEntries(balances));
    };

    fetchBalances();
  }, [creator]);

  useEffect(() => {
    dismiss();
  }, [dismiss]);

  const handleCreateDrop = async () => {
    if (!TREASURY_ADDRESS) {
      console.error("Missing TREASURY_ADDRESS in env");
      return;
    }
    if (!creator?.address || !amount || isNaN(Number(amount))) return;

    const parsedAmount = parseFloat(amount);
    const count = parseInt(numRecipients || "1");
    const tokenMeta = tokenList.find((t) => t.name === tokenType);
    if (!tokenMeta) return;

    const treasury = TREASURY_ADDRESS as `0x${string}`;
    const decimals = tokenMeta.decimals;
    const value =
      tokenType === "ETH" ? parseEther(amount) : parseUnits(amount, decimals);

    setIsLoading(true);

    try {
      // 1. Send full amount to treasury
      let txHash: `0x${string}`;
      if (tokenType === "ETH") {
        txHash = await sendTransactionAsync({
          to: treasury,
          value,
          chainId: 8453,
        });
      } else {
        if (!tokenMeta.address) throw new Error("Missing token address");
        txHash = await writeContractAsync({
          address: tokenMeta.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "transfer",
          args: [treasury, value],
          chainId: 8453,
        });
      }

      // 2. POST to backend
      const res = await fetch("/api/drop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creator,
          token: tokenType,
          amount,
          numRecipients: count,
        }),
      });

      const data = await res.json();

      if (res.ok && Array.isArray(data.drops)) {
        data.drops.forEach(({ dropId, claimToken }: DropResponseItem) => {
          localStorage.setItem(`claimToken:${dropId}`, claimToken);
        });

        if (data.groupUrl) {
          setClaimUrl([data.groupUrl]); // ✅ only this
        } else {
          setClaimUrl(data.drops.map((d: DropResponseItem) => d.claimUrl ?? ""));
        }
      } else {
        alert("Drop creation failed");
      }
    } catch (e) {
      console.error("Error creating drop", e);
      alert("Transaction failed or rejected");
    } finally {
      setIsLoading(false);
    }
  };

  const getShareUrl = (drop: Drop): string => {
    if (drop.groupId) {
      return `${window.location.origin}/claims/group/${drop.groupId}`;
    }
    const token = localStorage.getItem(`claimToken:${drop.dropId}`);
    return `${window.location.origin}/claim/${drop.dropId}${token ? `?claimToken=${token}` : ""}`;
  };

  function GroupClaimers({
    groupId,
    resolvedClaimNames,
  }: {
    groupId: string;
    resolvedClaimNames: Record<string, string>;
  }) {
    const [claimers, setClaimers] = useState<string[]>([]);

    useEffect(() => {
      const fetchGroup = async () => {
        const res = await fetch(`/api/drop/group/${groupId}`);
        const data = await res.json();
        const claimedAddresses = (data.drops || [])
          .filter((d: GroupDropClaim) => d.claimed && d.claimedBy)
          .map((d: GroupDropClaim) => d.claimedBy?.toLowerCase());
        setClaimers([...new Set(claimedAddresses)] as string[]);
      };
      fetchGroup();
    }, [groupId]);

    if (claimers.length === 0) return null;

    return (
      <div className="text-white/30 text-base mt-1">
        <div className="flex flex-wrap gap-1 mt-1">
          {claimers.map((addr) => (
            <span
              key={addr}
              className="px-3 py-1 bg-white/10 rounded-2xl text-white/80 text-sm whitespace-nowrap"
            >
              {resolvedClaimNames[addr] ?? shortAddress(addr)}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-12 mt-[calc(4rem+env(safe-area-inset-top))] relative">
      <div className="max-w-sm w-full mx-auto space-y-4">
        <div className="max-w-[80%] mx-auto text-center font-medium text-md mb-4 pb-2">
          Send a cash link.
          <br /> Anyone can claim in one tap.
        </div>
        <div className="w-full text-center bg-transparent outline-none flex justify-center items-baseline gap-2">
          <div className="rounded-xl p-[2px] bg-gradient-to-br from-violet-400/90 via-purple-500/60 to-fuchsia-500/30 mt-2">
            <div className="bg-background rounded-xl p-6 flex flex-col items-center">
              <div className="flex flex-col">
                <NumericFormat
                  inputMode="decimal"
                  pattern="[0-9]*"
                  value={amount}
                  onValueChange={(values) => setAmount(values.value)}
                  thousandSeparator
                  allowNegative={false}
                  decimalScale={4}
                  prefix={getTokenSuffix(tokenType)}
                  placeholder={`${getTokenSuffix(tokenType)}0`}
                  className={`text-primary text-5xl bg-transparent text-center font-medium outline-none w-full placeholder-white/20 ${
                    !amount ? "text-white/20" : "text-white"
                  }`}
                />

                <p className="hidden text-sm opacity-30">Amount to send</p>
                <p className="text-sm text-white/30 text-center">
                  Balance: {(+tokenBalances[tokenType] || 0).toFixed(2)}{" "}
                  {tokenType}{" "}
                  <span
                    className="text-primary ml-2"
                    onClick={() => setTokenDrawerOpen(true)}
                  >
                    Change
                  </span>
                </p>
                {!hasBalance && parsed > 0 && (
                  <p className="text-red-400 text-sm text-center mt-1">
                    Insufficient balance
                  </p>
                )}

                {parsed > maxAllowed && (
                  <p className="text-red-400 text-sm mt-1">
                    Max: {tokenType === "ETH" ? "0.05 ETH" : "$100"}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="relative w-full">
          <label className="absolute left-4 top-1/2 -translate-y-1/2 text-white pointer-events-none">
            Recipients
          </label>
          <NumericFormat
            inputMode="decimal"
            pattern="[0-9]*"
            value={numRecipients}
            onChange={(e) => setNumRecipients(e.target.value)}
            thousandSeparator
            allowNegative={false}
            decimalScale={3}
            placeholder="Min 1"
            className="w-full p-4 pr-4 pl-32 rounded-lg text-white text-right bg-white/5 placeholder-white/20"
          />
        </div>

        <div className="hidden flex flex-col space-y-2 mt-3 pt-4">
          <button
            onClick={() => setTokenDrawerOpen(true)}
            className="w-full flex items-center justify-between p-4 rounded-lg bg-white/5"
          >
            <div className="flex items-center gap-2">
              <img
                src={tokenList.find((t) => t.name === tokenType)?.icon}
                className="w-6 h-6 rounded-full"
                alt={tokenType}
              />
              <span className="text-white">{tokenType}</span>
            </div>
            <span className="text-white/20">Change</span>
          </button>
        </div>

        <Button
          onClick={handleCreateDrop}
          disabled={
            !creator ||
            !parsed ||
            isNaN(parsed) ||
            !hasBalance ||
            !isValidAmount ||
            isLoading
          }
          className="w-full p-4 rounded-lg bg-white text-black font-medium transition active:scale-95"
        >
          {isLoading ? (
            <>
              <LoaderCircle className="animate-spin w-4 h-4" />
              Creating...
            </>
          ) : (
            <>Create</>
          )}
        </Button>

        <p className="text-white/30 text-sm text-center mt-1">
          {count > 1
            ? `Each person gets ${splitAmount.toFixed(1)} ${tokenType}`
            : ""}
        </p>

        <p className="hidden text-white/50 text-center text-sm mt-2">
          Anyone with the link can claim
        </p>

        {(claimUrl?.length ?? 0) > 0 && (
          <div className="mt-4 space-y-2 text-center">
            <p className="text-sm text-white/50">Drop created:</p>
            {claimUrl!.map((url, idx) => (
              <a
                key={idx}
                href={url}
                className="text-white text-sm underline break-words"
                target="_blank"
                rel="noopener noreferrer"
              >
                {url}
              </a>
            ))}
          </div>
        )}
      </div>

      {myDrops.length > 0 && (
        <div className="max-w-sm w-full mx-auto space-y-2">
          <p className="mb-4 mt-12 text-base ml-2 font-medium opacity-30">
            Your cash Links
          </p>

          {/* 🆕 Grouped rendering */}
          {Object.values(
            myDrops.reduce(
              (acc, drop) => {
                const key = drop.groupId || drop.dropId;
                if (!acc[key]) acc[key] = drop;
                return acc;
              },
              {} as Record<string, Drop>
            )
          ).map((drop) => {
            const isGroup = !!drop.groupId;
            const shareUrl = getShareUrl(drop);

            return (
              <div
                key={drop.groupId || drop.dropId}
                className="p-4 bg-white/5 rounded-lg text-white text-base space-y-1"
              >
                <div className="flex justify-between items-center">
                  <span className="text-2xl text-primary font-medium">
                    {parseFloat(drop.amount).toFixed(1)} {drop.token}
                  </span>

                  <span className="text-sm font-medium text-white/40">
                    {drop.groupId
                      ? `${drop.claimedCount ?? 0} / ${drop.totalCount ?? 0} claimed`
                      : drop.claimed
                        ? "Claimed"
                        : "Unclaimed"}
                  </span>
                </div>

                {isGroup && drop.groupId && (
                  <GroupClaimers
                    groupId={drop.groupId}
                    resolvedClaimNames={resolvedClaimNames}
                  />
                )}

                {drop.claimed ? (
                  <>
                    {!isGroup && drop.claimed && (
                      <p className="text-white opacity-30 text-base">
                        Claimed by:{" "}
                        {resolvedClaimNames[
                          drop.claimedBy?.toLowerCase() ?? ""
                        ] ?? drop.claimedBy}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(shareUrl);
                        toast.success("Link copied to clipboard!");
                        setCopiedDropId(drop.groupId || drop.dropId);
                        setTimeout(() => setCopiedDropId(null), 1500);
                      }}
                      className="text-base text-white bg-white/5 p-3 w-full rounded-lg hover:bg-white/10 transition"
                    >
                      {copiedDropId === (drop.groupId || drop.dropId)
                        ? "Copied!"
                        : isGroup
                          ? "Copy Group Link"
                          : "Copy"}
                    </button>
                    {isGroup && (
                      <p className="text-xs text-white/30 mt-1 text-center">
                        One link, claimable by multiple people
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Drawer.Root open={tokenDrawerOpen} onOpenChange={setTokenDrawerOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-20" />
          <Drawer.Content className="fixed top-[110px] left-0 right-0 bottom-0 bg-background rounded-t-3xl z-50">
            <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 my-4" />
            <div className="px-4">
              <Drawer.Title className="text-lg text-center font-medium">
                Select token
              </Drawer.Title>
              <div className="space-y-2 mt-4">
                {tokenList.map((token) => (
                  <button
                    key={token.name}
                    onClick={() => {
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
                ))}
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <div className="bg-background text-center fixed top-0 inset-x-0 pt-4 pb-6 flex justify-around z-1">
        <Link
          href="/"
          className="active:transform active:scale-90 transition-all"
        >
          <Image
            src="/newnewnewapp.png"
            alt="logo"
            width={40}
            height={40}
            className="object-cover animate-pulse"
            priority
          />
        </Link>
      </div>
      <DropSuccessDrawer
        isOpen={!!claimUrl}
        setIsOpen={(v) => {
          if (!v) setClaimUrl(null);
        }}
        claimUrl={claimUrl?.[0] || ""} // still pass one
        amount={amount}
        token={tokenType}
      />
    </div>
  );
}
