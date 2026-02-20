"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import sdk from "@farcaster/frame-sdk";
import { Drawer } from "vaul";
import { NumericFormat } from "react-number-format";
import { tokenList } from "@/lib/tokens";

import { LoaderCircle } from "lucide-react";

export default function SplitPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();

  const [roomName, setRoomName] = useState("");
  const [amount, setAmount] = useState("");
  const [tokenType, setTokenType] = useState("USDC");

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);

  const selectedToken = tokenList.find((t) => t.name === tokenType);
  const [showHowItWorks, setShowHowItWorks] = useState(true);

  const buildPlayer = async () => {
    const context = await sdk.context;
    return {
      address: address!.toLowerCase(),
      name: context.user?.username ?? address?.slice(0, 6),
      pfp: context.user?.pfpUrl ?? null,
      fid: context.user?.fid ?? null,
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

      router.push(`/game/${data.gameId}`);
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
    <div className="min-h-screen w-full flex flex-col items-center p-4 pt-20 pb-28 overflow-y-auto scrollbar-hide">
      <div className="w-full max-w-md flex flex-col space-y-5">
        {/* Intro */}

        <div className="text-center text-lg font-medium">
          Create a spin to pay group
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
            onClick={() => setTokenDrawerOpen(true)}
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

      {/* Token drawer */}
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
                  className="w-full flex items-center p-3 rounded-lg bg-white/5"
                >
                  <img src={token.icon} className="w-8 h-8 rounded-full mr-4" />
                  <span className="text-white">{token.name}</span>
                </button>
              ))}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
