"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import sdk from "@farcaster/frame-sdk";
import { NumericFormat } from "react-number-format";
import { tokenList } from "@/lib/tokens";
import { useTabIdentity } from "@/lib/useTabIdentity";
import { PaymentTokenPickerDialog } from "@/components/app/PaymentTokenPickerDialog";

import { LoaderCircle } from "lucide-react";

export default function SplitPage() {
  const { address, isConnected } = useAccount();
  const {
    username: tabUsername,
    pfp: tabPfp,
    fid: tabFid,
  } = useTabIdentity();
  const router = useRouter();

  const [roomName, setRoomName] = useState("");
  const [amount, setAmount] = useState("");
  const [tokenType, setTokenType] = useState("USDC");

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);

  const selectedToken = tokenList.find((t) => t.name === tokenType);
  const [showHowItWorks, setShowHowItWorks] = useState(true);

  const buildPlayer = async () => {
    let context: Awaited<typeof sdk.context> | null = null;

    try {
      context = await sdk.context;
    } catch {
      context = null;
    }

    const frameUser = context?.user;

    return {
      address: address!.toLowerCase(),
      name: frameUser?.username ?? tabUsername ?? address?.slice(0, 6),
      pfp: frameUser?.pfpUrl ?? tabPfp ?? null,
      fid: frameUser?.fid ?? tabFid ?? null,
    };
  };

  const handleCreateRoom = async () => {
    if (!isConnected || !address) return;
    if (!roomName.trim() || !amount) return;

    setCreating(true);
    setError(null);

    try {
      const player = await buildPlayer();

      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: roomName.trim(),
          amount: Number(amount),
          spinToken: tokenType,
          player,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create room");
      if (!data?.gameId) throw new Error("Room created but no gameId returned");

      const nextUrl = `/game/${data.gameId}`;
      router.push(nextUrl);

      // Fallback for embedded webviews where Next client navigation can be flaky.
      setTimeout(() => {
        if (typeof window !== "undefined" && window.location.pathname !== nextUrl) {
          window.location.assign(nextUrl);
        }
      }, 150);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setCreating(false);
    }
  };

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

  return (
    <div className="min-h-screen w-full flex flex-col items-center p-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(7rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
      <div className="w-full max-w-md flex flex-col space-y-5">
        {/* Intro */}

        <div className="text-center text-lg font-medium">
          Create a new spin
        </div>

        {/* Amount */}
        <div className="flex flex-col items-center -mt-1">
          <NumericFormat
            inputMode="decimal"
            value={amount}
            onValueChange={(v) => setAmount(v.value)}
            thousandSeparator
            allowNegative={false}
            decimalScale={4}
            prefix={getTokenSuffix(tokenType)}
            placeholder={`${getTokenSuffix(tokenType)}0`}
            className={`leading-none text-5xl bg-transparent text-center font-medium outline-none placeholder-white/20 ${
              !amount ? "text-white/20" : "text-primary"
            }`}
          />
          <p className="text-sm text-white/30">Amount at stake</p>
        </div>

        <div className="w-full max-w-md flex flex-col space-y-3 mt-6">
          {/* Room name */}
          <input
            type="text"
            placeholder="name"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            className="placeholder-white/30 w-full p-4 rounded-lg text-white bg-white/5"
          />

          {/* Token selector */}
          <button
            onClick={() => setTokenDialogOpen(true)}
            className="w-full flex items-center justify-between p-4 rounded-lg bg-white/5"
          >
            <div className="flex items-center gap-2">
              <img src={selectedToken?.icon} className="w-7 h-7 rounded-full" />
              <span className="text-white">{tokenType}</span>
            </div>
            <span className="text-primary">Change</span>
          </button>

          {/* CTA */}
          <Button
            onClick={handleCreateRoom}
            disabled={creating || !roomName || !amount}
            className="w-full bg-primary"
          >
            {creating ? (
              <>
                <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                Creating…
              </>
            ) : (
              <>Create</>
            )}
          </Button>

          {error && <p className="text-sm text-red-400 text-center">{error}</p>}

          <div className="rounded-[16px] bg-card p-4 text-left">
            <button
              onClick={() => setShowHowItWorks(!showHowItWorks)}
              className="w-full flex items-center justify-between text-white/40"
            >
              <span className="text-md ml-2">How it works</span>
              <span className="hidden text-white/60">
                {showHowItWorks ? "−" : "+"}
              </span>
            </button>

            {showHowItWorks && (
              <div className="mt-2 space-y-1 text-white/50 text-sm">
                <p>• Everyone joins the group</p>
                <p>• One spin randomly picks who pays</p>
                <p>• The chosen person covers the full tab</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <PaymentTokenPickerDialog
        open={tokenDialogOpen}
        onOpenChange={setTokenDialogOpen}
        selectedToken={tokenType}
        onSelect={setTokenType}
      />
    </div>
  );
}
