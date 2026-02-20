"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import sdk from "@farcaster/frame-sdk";
import { nanoid } from "nanoid";
import { Drawer } from "vaul";
import NumberFlow from "@number-flow/react";
import { NumericFormat } from "react-number-format";
import { Check, ClipboardCopy } from "lucide-react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { tokenList } from "@/lib/tokens";
import { getTokenPrices } from "@/lib/getTokenPrices";

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

type SplitType = "invited" | "pay_other" | "receipt_open";

// Receipt Upload Component
function ReceiptUploader({ onParsed }: { onParsed: (data: any) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const toBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const base64 = await toBase64(file);
      const res = await fetch("/api/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("Receipt API error:", text);
        throw new Error("Receipt parse failed");
      }

      const data = await res.json();
      onParsed(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <input
        accept="image/*"
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      {file && (
        <div className="w-full flex justify-center">
          <img
            src={URL.createObjectURL(file)}
            alt="Receipt preview"
            className="h-32 w-auto max-w-[200px] rounded-md object-contain"
          />
        </div>
      )}

      <Button
        variant="outline"
        className="w-full"
        onClick={() => inputRef.current?.click()}
      >
        {file ? "Upload new" : "Choose receipt image"}
      </Button>

      <Button
        disabled={!file || loading}
        onClick={handleUpload}
        className="w-full bg-primary"
      >
        {loading ? (
          <>
            <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
            Reading…
          </>
        ) : (
          "Confirm"
        )}
      </Button>

      {error && <p className="text-sm text-red-400 text-center">{error}</p>}
    </div>
  );
}

export default function SplitNewPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();

  // ----------------------------
  // DEFAULT TOKEN = USDC
  // ----------------------------
  const [tokenType, setTokenType] = useState<"USDC" | string>("USDC");
  const selectedTokenInfo = tokenList.find((t) => t.name === tokenType);

  // UI state
  const [splitType, setSplitType] = useState<SplitType>("invited");

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [recipientAddress, setRecipientAddress] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Drawers
  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);
  const [followerDrawerOpen, setFollowerDrawerOpen] = useState(false);

  const [showHowItWorks, setShowHowItWorks] = useState(true);

  // Followers
  const [followers, setFollowers] = useState<FarcasterUser[]>([]);
  const [filteredFollowers, setFilteredFollowers] = useState<FarcasterUser[]>(
    []
  );
  const [selectedFollowers, setSelectedFollowers] = useState<FarcasterUser[]>(
    []
  );
  const invitedCount = selectedFollowers.length;

  const [query, setQuery] = useState("");

  const [debtorCount, setDebtorCount] = useState<number | string>("");

  // Pricing
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});

  const total = parseFloat(totalAmount) || 0;

  const debtors = invitedCount;

  const [receiptDrawerOpen, setReceiptDrawerOpen] = useState(false);
  const [isParsingReceipt, setIsParsingReceipt] = useState(false);

  const [parsedReceipt, setParsedReceipt] = useState<any | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);

  // Pricing state

  const debtorCountResolved =
    splitType === "receipt_open"
      ? Number(debtorCount)
      : selectedFollowers.length;

  const perPerson =
    debtorCountResolved > 0
      ? (total / debtorCountResolved).toFixed(3)
      : "0.000";

  const getTokenSuffix = (token: string) => {
    switch (token) {
      case "USDC":
        return "$";
      case "EURC":
        return "€";
      case "ETH":
      case "WETH":
        return "Ξ";
      default:
        return "$";
    }
  };

  // --------------------------
  // Fetch token prices
  // --------------------------
  useEffect(() => {
    (async () => {
      const prices = await getTokenPrices();
      setTokenPrices(prices);
    })();
  }, []);

  // --------------------------
  // Follower search
  // --------------------------
  useEffect(() => {
    const delay = setTimeout(async () => {
      if (!query.trim()) {
        setFilteredFollowers(followers);
        return;
      }

      const res = await fetch(
        `/api/neynar/user/search?q=${encodeURIComponent(query)}`
      );
      const data = await res.json();

      setFilteredFollowers(
        (data.users || [])
          .filter(
            (u: FarcasterUser) => u.verified_addresses?.primary?.eth_address
          )
          .slice(0, 20)
      );
    }, 250);

    return () => clearTimeout(delay);
  }, [query, followers]);

  // --------------------------
  // Load followers (AUTO POPULATE)
  // --------------------------
  useEffect(() => {
    (async () => {
      const context = await sdk.context;
      const username = context.user?.username;
      if (!username) return;

      const res = await fetch(
        `/api/neynar/user/following?username=${username}`
      );
      const data = await res.json();

      if (Array.isArray(data)) {
        const top = data
          .slice(0, 50)
          .map((e) => e.user)
          .filter(
            (u: FarcasterUser) => u.verified_addresses?.primary?.eth_address
          );

        setFollowers(top);
        setFilteredFollowers(top);
      }
    })();
  }, []);

  // --------------------------
  // Create split
  // --------------------------

  const handleCreate = async () => {
    if (isCreating) return;
    setIsCreating(true);

    try {
      if (!isConnected) {
        await connect({ connector: farcasterFrame() });
      }
      if (!address) throw new Error("No wallet address");

      const context = await sdk.context;
      if (!context.user?.fid) throw new Error("Missing FID");

      const splitId = nanoid();
      const finalTotalAmount = parseFloat(totalAmount);

      if (!description || !finalTotalAmount) {
        throw new Error("Missing description or amount");
      }

      const creator = {
        fid: context.user.fid, // ✅ number
        address,
        name: context.user.username ?? address.slice(0, 6),
        pfp: context.user.pfpUrl ?? "",
      };

      const recipient =
        splitType === "pay_other"
          ? {
              address: recipientAddress,
              fid: null,
              name: "Recipient",
            }
          : creator;

      let payload: any = {
        splitId,
        creator,
        recipient,
        description,
        totalAmount: finalTotalAmount,
        token: tokenType,
        splitType,
      };

      // -----------------------------
      // RECEIPT OPEN SPLIT
      // -----------------------------
      if (splitType === "receipt_open") {
        if (!debtorCount || Number(debtorCount) <= 0) {
          throw new Error("Invalid number of people");
        }

        payload.numPeople = Number(debtorCount);
      }

      // -----------------------------
      // INVITED SPLITS
      // -----------------------------
      if (splitType !== "receipt_open") {
        payload.invited = selectedFollowers.map((f) => ({
          fid: f.fid, // ✅ number
          address: f.verified_addresses.primary!.eth_address,
          name: f.username,
          pfp: f.pfp_url,
        }));
      }

      const res = await fetch(`/api/split/${splitId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("Create split failed:", text);
        throw new Error("Failed to create split");
      }

      router.push(`/split/${splitId}`);
    } catch (err) {
      console.error("handleCreate error:", err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center p-4 pt-20 pb-28 overflow-y-auto scrollbar-hide">
      {step === 0 && (
        <div className="w-full max-w-md flex flex-col space-y-3">
          <h2 className="text-center text-lg font-medium mb-3">
            Start a bill split
          </h2>

          {/* DEFAULT: I paid */}
          <button
            onClick={() => {
              setSplitType("invited");
              setStep(1);
            }}
            className="border-2 border-white/10 p-4 rounded-lg text-left"
          >
            <p className="text-white font-medium">I paid upfront</p>
            <p className="text-md text-white/40">
              Enter the total and invite people
            </p>
          </button>

          {/* HELPER: Receipt */}
          <button
            onClick={() => {
              setSplitType("receipt_open");
              setReceiptDrawerOpen(true);
            }}
            className="w-full p-4 rounded-lg bg-white/5 text-left flex items-center justify-between"
          >
            <div>
              <p className="text-white font-medium">AI Upload receipt</p>
              <p className="text-md text-white/40">
                Auto-fill total amount and description
              </p>
            </div>
          </button>

          {/* ADVANCED TOGGLE */}
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-sm text-white/40 text-center mt-8 pt-4"
          >
            {showAdvanced ? "Hide advanced" : "Advanced"}
          </button>

          {/* ADVANCED OPTION */}
          {showAdvanced && (
            <button
              onClick={() => {
                setSplitType("pay_other");
                setStep(1);
              }}
              className="border-2 border-white/10 p-4 rounded-lg text-left"
            >
              <p className="text-white font-medium">Someone else paid</p>
              <p className="text-md text-white/40">
                Send payments to another wallet
              </p>
            </button>
          )}
        </div>
      )}

      {/* STEP 1 */}
      {step === 1 && (
        <div className="w-full max-w-md flex flex-col space-y-5">
          <div className="text-center text-lg font-medium">
            Create, Split, and settle fast
          </div>

          <div className="flex flex-col items-center -mt-2 mb-4">
            <NumericFormat
              inputMode="decimal"
              pattern="[0-9]*"
              value={totalAmount}
              onValueChange={(v) => setTotalAmount(v.value)}
              thousandSeparator
              allowNegative={false}
              decimalScale={4}
              prefix={getTokenSuffix(tokenType)}
              placeholder={`${getTokenSuffix(tokenType)}0`}
              className={`w-full leading-none text-5xl bg-transparent text-center font-medium outline-none placeholder-white/20 ${
                !totalAmount ? "text-white/20" : "text-primary"
              }`}
            />
            <p className="text-sm text-white/30">Total bill amount</p>
          </div>

          <div className="w-full max-w-md flex flex-col space-y-3 mt-6">
            {/* Split name */}
            <input
              type="text"
              placeholder="Name"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="placeholder-white/30 w-full p-4 rounded-lg text-white bg-white/5"
            />

            <button
              onClick={() => setTokenDrawerOpen(true)}
              className="flex items-center justify-between w-full p-4 bg-white/5 rounded-lg"
            >
              <div className="flex items-center gap-2">
                <img
                  src={selectedTokenInfo?.icon}
                  className="w-7 h-7 rounded-full"
                />
                <span className="text-white">{tokenType}</span>
              </div>
              <span className="text-primary">Change</span>
            </button>

            {splitType === "pay_other" && (
              <div className="relative w-full mt-4">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                  To:
                </span>
                <input
                  type="text"
                  placeholder="Recipient address (0x...)"
                  value={recipientAddress ?? ""}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  className="pl-10 pr-20  placeholder-white/30 w-full p-4 rounded-lg text-white bg-white/5"
                />
                <button
                  onClick={async () => {
                    const text = await navigator.clipboard.readText();
                    setQuery(text);
                  }}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-white"
                >
                  <ClipboardCopy className="w-5 h-5 text-white/50" />
                </button>
              </div>
            )}

            <Button
              disabled={
                !description ||
                !totalAmount ||
                (splitType === "pay_other" && !recipientAddress)
              }
              onClick={() => {
                if (splitType === "receipt_open") {
                  setStep(3); // skip invites
                } else {
                  setStep(2);
                }
              }}
              className="w-full bg-primary mt-4"
            >
              Continue
            </Button>

            <div className="rounded-[16px] bg-white/[3%] p-4 text-left">
              <button
                onClick={() => setShowHowItWorks(!showHowItWorks)}
                className="w-full flex items-center justify-between text-white/40"
              >
                <span className="text-sm ml-2">How it works</span>
                <span className="hidden text-white/60">
                  {showHowItWorks ? "−" : "+"}
                </span>
              </button>

              {showHowItWorks && (
                <div className="mt-2 space-y-1 text-white/50 text-sm">
                  <p>• Set the total amount and currency</p>
                  <p>• Invite who should pay their share</p>
                  <p>• Everyone pays directly, once</p>
                  <p>• The split closes when all are paid</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && splitType !== "receipt_open" && (
        <div className="w-full max-w-md flex flex-col space-y-5">
          <div className="text-center text-lg font-medium">
            Add friends to this split
          </div>

          <div className="flex items-center justify-center -space-x-3">
            {selectedFollowers.slice(0, 6).map((f) => (
              <img
                key={f.fid}
                src={f.pfp_url}
                className="w-10 h-10 rounded-full border-2 border-white object-cover"
              />
            ))}
            {selectedFollowers.length > 6 && (
              <div className="w-10 h-10 rounded-full bg-white/10 border-2 border-white flex items-center justify-center text-xs text-white/60">
                +{selectedFollowers.length - 6}
              </div>
            )}
          </div>

          <button
            onClick={() => setFollowerDrawerOpen(true)}
            className="w-full p-4 bg-white/5 rounded-lg text-center text-primary"
          >
            {selectedFollowers.length === 0 ? "Add friends" : "Edit friends"}
          </button>

          <Button
            onClick={() => setStep(3)}
            disabled={selectedFollowers.length === 0}
            className="w-full bg-primary disabled:opacity-20 disabled:cursor-not-allowed"
          >
            Continue
          </Button>

          <p className="text-sm text-white/40 text-center">
            {splitType === "invited"
              ? "You paid upfront. Friends will pay you back."
              : splitType === "pay_other"
                ? "Friends will pay the selected recipient."
                : "Anyone can join until all spots are filled."}
          </p>
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && (
        <div className="w-full max-w-md flex flex-col space-y-5">
          <div className="text-center text-lg font-medium">
            Review your split
          </div>

          <div className="p-5 bg-white/5 rounded-lg space-y-3">
            <div className="flex justify-between text-white/70">
              <span>Bill name</span>
              <span className="text-white">{description}</span>
            </div>

            <div className="flex justify-between text-white/70">
              <span>Total paid by you</span>
              <span className="text-white">
                {getTokenSuffix(tokenType)}
                {totalAmount || "0"}
              </span>
            </div>

            <div className="flex justify-between text-white/70">
              <span>
                {splitType === "receipt_open"
                  ? "People paying"
                  : "Friends invited"}
              </span>
              <span className="text-white">
                {splitType === "receipt_open"
                  ? debtorCountResolved
                  : invitedCount}
              </span>
            </div>

            <div className="flex justify-between text-white/70">
              <span>
                {splitType === "receipt_open"
                  ? "Each person owes"
                  : "Each friend owes"}
              </span>

              <span className="text-primary">
                {getTokenSuffix(tokenType)}
                {perPerson}
              </span>
            </div>
          </div>

          <Button
            disabled={isCreating}
            onClick={() => handleCreate()}
            className="w-full bg-primary"
          >
            {isCreating ? (
              <>
                <LoaderCircle className="w-4 h-4 animate-spin mr-1" />
                Creating…
              </>
            ) : (
              "Create split"
            )}
          </Button>
          <p className="text-sm text-white/40 text-center">
            {splitType === "invited"
              ? "You paid upfront. Friends will pay you back."
              : splitType === "pay_other"
                ? "Friends will pay the selected recipient."
                : "Anyone can join until all spots are filled."}
          </p>
        </div>
      )}

      <Drawer.Root open={tokenDrawerOpen} onOpenChange={setTokenDrawerOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-50" />
          <Drawer.Content className="pb-16 fixed bottom-0 left-0 right-0 bg-background p-4 rounded-t-3xl max-h-[80vh] overflow-y-auto z-50">
            {/* Top Handle */}
            <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-4" />

            <p className="text-center text-white mb-4">
              Choose a payment token
            </p>

            <div className="space-y-2">
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

                  <p className="text-white font-medium">{token.name}</p>
                </button>
              ))}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <Drawer.Root
        open={followerDrawerOpen}
        onOpenChange={setFollowerDrawerOpen}
        repositionInputs={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-20" />

          <Drawer.Content className=" pb-32 fixed top-[100px] left-0 right-0 bottom-0 bg-background p-0 rounded-t-3xl flex flex-col z-50">
            {/* Handle */}
            <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 my-4" />

            {/* Sticky header */}
            <div className="px-4 sticky top-[80px] bg-background z-10">
              <Drawer.Title className="text-lg text-center font-medium">
                Choose friends
              </Drawer.Title>

              {/* <p className="text-center opacity-30 mb-4">
                They’ll receive a notification to join
              </p> */}

              {/* Search Bar */}
              <div className="relative w-full mb-4 mt-4 pt-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by username"
                  className="w-full p-3 pl-6 pr-16 rounded-lg bg-white/5 text-white placeholder-white/20"
                />

                {query ? (
                  <button
                    onClick={() => setQuery("")}
                    className="font-medium absolute right-4 top-1/2 -translate-y-1/2 text-base mt-1 text-primary hover:text-white transition"
                  >
                    Clear
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      const text = await navigator.clipboard.readText();
                      setQuery(text);
                    }}
                    className="font-medium absolute right-4 top-1/2 -translate-y-1/2 text-base mt-1 text-primary hover:text-white transition"
                  >
                    Paste
                  </button>
                )}
              </div>
            </div>

            {/* Selected chips */}
            {selectedFollowers.length > 0 && (
              <div className="px-4 mb-2">
                <div className="bg-white/5 py-4 px-6 rounded-lg">
                  <div className="flex flex-wrap gap-3">
                    {selectedFollowers.map((f) => (
                      <div key={f.fid} className="relative w-12 h-[72px]">
                        <img
                          src={f.pfp_url}
                          alt={f.username}
                          className="w-12 h-12 rounded-full border-2 border-white/5 object-cover"
                        />

                        <button
                          onClick={() =>
                            setSelectedFollowers((prev) =>
                              prev.filter((x) => x.fid !== f.fid)
                            )
                          }
                          className="absolute -top-1 -right-1 bg-background text-white rounded-full w-5 h-5 flex items-center justify-center"
                        >
                          ×
                        </button>

                        <span className="block text-xs text-center mt-1 text-white truncate w-12">
                          @{f.username}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Followers list */}
            <div className="flex-1 overflow-y-auto px-4 pb-20 space-y-2">
              {filteredFollowers.map((f) => {
                const isSelected = selectedFollowers.some(
                  (x) => x.fid === f.fid
                );

                return (
                  <button
                    key={f.fid}
                    onClick={() => {
                      setSelectedFollowers((prev) =>
                        isSelected
                          ? prev.filter((x) => x.fid !== f.fid)
                          : [...prev, f]
                      );
                    }}
                    className="w-full flex items-center justify-between p-3 bg-white/5 rounded-lg"
                  >
                    <div className="flex items-center">
                      <img
                        src={
                          f.pfp_url ||
                          `https://api.dicebear.com/9.x/glass/svg?seed=${f.fid}`
                        }
                        className="w-8 h-8 rounded-full mr-4 object-cover"
                        alt={f.username}
                      />
                      <span className="text-white">@{f.username}</span>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        isSelected
                          ? "border-primary bg-primary"
                          : "border-white/10"
                      }`}
                    >
                      {isSelected && <Check className="w-4 h-4 text-black" />}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Bottom CTA */}
            <div className="fixed bottom-0 left-0 right-0 px-4 pb-6 bg-background z-50">
              <Button
                onClick={() => setFollowerDrawerOpen(false)}
                className="w-full bg-primary"
              >
                Done
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Receipt Drawer */}
      <Drawer.Root
        open={receiptDrawerOpen}
        onOpenChange={setReceiptDrawerOpen}
        repositionInputs={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-50" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-background p-4 rounded-t-3xl z-50">
            <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-4" />
            <Drawer.Title className="text-lg text-center font-medium mb-4">
              {parsedReceipt ? "Review receipt" : "Upload receipt"}
            </Drawer.Title>

            {!parsedReceipt ? (
              <ReceiptUploader
                onParsed={(data) => {
                  setParsedReceipt(data);
                  if (data.totalAmount) {
                    setTotalAmount(String(data.totalAmount));
                  }
                  if (data.merchant) {
                    setDescription(data.merchant);
                  }
                }}
              />
            ) : (
              <div className="space-y-4">
                {/* Display parsed receipt data */}
                <div className="bg-white/5 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-white/60">Name</span>
                    <span className="text-white">
                      {parsedReceipt.merchant || "—"}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-white/60">Total</span>
                    <span className="text-primary">
                      {parsedReceipt.totalAmount ?? "—"}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-white/60">Currency</span>
                    <span className="text-white">
                      {parsedReceipt.currency || tokenType}
                    </span>
                  </div>

                  <p className="text-sm text-primary text-left mt-4 pt-2">
                    You paid upfront. Others will pay you back.
                  </p>
                </div>

                {/* Number of People field */}
                <div className="space-y-2">
                  <label className="hidden text-white/60">
                    Number of people
                  </label>
                  <input
                    type="number"
                    value={debtorCount}
                    onChange={(e) => setDebtorCount(e.target.value)}
                    placeholder="Add number of payers"
                    className="w-full p-4 rounded-lg text-white bg-white/5"
                    required
                  />
                </div>

                {/* Submit Button */}
                <Button
                  className="w-full bg-primary"
                  disabled={
                    isCreating || !debtorCount || isNaN(Number(debtorCount))
                  }
                  onClick={() => {
                    setReceiptDrawerOpen(false);
                    setStep(3);
                  }}
                >
                  {isCreating ? "Creating…" : "Create split"}
                </Button>

                <Button
                  variant="ghost"
                  className="w-full text-white/50"
                  onClick={() => setParsedReceipt(null)}
                >
                  Upload another
                </Button>
              </div>
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
