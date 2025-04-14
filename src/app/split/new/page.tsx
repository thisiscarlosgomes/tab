"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import sdk from "@farcaster/frame-sdk";
import { nanoid } from "nanoid";
import { Drawer } from "vaul";
import NumberFlow from "@number-flow/react";

import { Button } from "@/components/ui/button";
import { useAddPoints } from "@/lib/useAddPoints";
import { tokenList } from "@/lib/tokens"; // or define inline
import { getTokenPrices } from "@/lib/getTokenPrices";
import { NumericFormat } from "react-number-format";

export default function SplitNewPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();

  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [numPeople, setNumPeople] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [tokenType, setTokenType] = useState(tokenList[0].name); // default to "ETH"
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);
  const selectedTokenInfo = tokenList.find((t) => t.name === tokenType);

  const getTokenSuffix = (token: string) => {
    switch (token) {
      case "USDC":
      case "TAB":
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

  useEffect(() => {
    const fetchPrices = async () => {
      const prices = await getTokenPrices();
      setTokenPrices(prices);
    };
    fetchPrices();
  }, []);

  const people = Math.max(1, parseInt(numPeople, 10) || 1);
  const total = parseFloat(totalAmount) || 0;

  const averagePerPerson =
    total > 0 ? (total / people).toFixed(6).replace(/\.?0+$/, "") : "0";

  const priceUsd = tokenPrices[tokenType];

  const averageUsd =
    priceUsd && parseFloat(averagePerPerson) > 0
      ? (parseFloat(averagePerPerson) * priceUsd).toFixed(2)
      : null;

  const handleCreate = async () => {
    if (!isConnected) {
      await connect({ connector: farcasterFrame() });
    }
    if (!address) return;

    const context = await sdk.context;
    const splitId = nanoid();

    const user = {
      address,
      name: context.user?.username ?? address.slice(0, 6),
      pfp: context.user?.pfpUrl ?? "",
      fid: context.user?.fid ?? "",
    };

    const payload = {
      splitId,
      creator: user,
      description,
      totalAmount: parseFloat(totalAmount),
      numPeople: parseInt(numPeople, 10),
      token: tokenType, // ✅ Add this
    };

    setIsCreating(true);

    // 🔥 Post and get full response
    const res = await fetch(`/api/split/${splitId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    const code = data?.code;

    if (!code) {
      console.error("Missing split code");
      return;
    }

    // 🪙 Add points
    await useAddPoints(address, "create_tab", undefined, splitId);

    // ✅ Redirect to /split with all QR details (or pass via state if needed)
    router.push(`/split/${splitId}`);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-16 pb-32 overflow-y-auto scrollbar-hide">
      <div className="w-full max-w-md p-2 flex flex-col space-y-2 rounded-lg">
        <h1 className="text-2xl font-bold text-center hidden">
          Split The Bill
        </h1>

        <div className="w-full relative">
          <button
            onClick={() => setTokenDrawerOpen(true)}
            className="w-full p-4 pl-12 rounded-lg bg-white/5 text-white flex items-center relative"
          >
            <div>
              <img
                src={selectedTokenInfo?.icon}
                className="rounded-full w-6 h-6 absolute left-4 top-1/2 -translate-y-1/2"
                alt={tokenType}
              />
              <span className="mx-auto">{tokenType}</span>
            </div>
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-primary">
              Select token
            </span>
          </button>
        </div>

        <div className="relative w-full">
          <label className="absolute left-4 top-1/2 -translate-y-1/2 text-white pointer-events-none">
            Total Amount
          </label>

          {/* Currency Symbol */}
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30">
            {getTokenSuffix(tokenType)}
          </span>

          <NumericFormat
            inputMode="decimal"
            pattern="[0-9]*"
            value={totalAmount}
            onValueChange={(values) => {
              setTotalAmount(values.value);
            }}
            thousandSeparator
            allowNegative={false}
            decimalScale={3}
            placeholder={tokenType}
            className="w-full p-4 pr-8 pl-32 rounded-lg text-white text-right bg-white/5 placeholder-white/20"
          />
        </div>

        <div className="relative w-full">
          <label className="absolute left-4 top-1/2 -translate-y-1/2 text-white pointer-events-none">
            # of people
          </label>
          <NumericFormat
            inputMode="decimal"
            pattern="[0-9]*"
            value={numPeople}
            onValueChange={(values) => {
              setNumPeople(values.value);
            }}
            allowNegative={false}
            decimalScale={0}
            placeholder="1"
            className="w-full p-4 pr-4 pl-28 rounded-lg text-white text-right bg-white/5 placeholder-white/20"
          />
        </div>

        <div className="relative w-full">
          <label className="absolute left-4 top-1/2 -translate-y-1/2 text-white pointer-events-none">
            Name
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full p-4 pr-4 pl-28 rounded-lg text-white text-right bg-white/5 placeholder-white/20"
            placeholder="e.g. Pizza night"
          />
        </div>

        <div className="text-center pt-2 p-2">
          <p className="text-white/30 text-sm mt-4">Average per person</p>
          <div>
            <NumberFlow
              value={parseFloat(averagePerPerson)}
              format={{
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
                // style: "currency",
                currencyDisplay: "narrowSymbol",
                currency: "USD", // fallback for formatting
              }}
              prefix={getTokenSuffix(tokenType)}
              className={`text-5xl font-medium ${
                parseFloat(totalAmount) > 0 ? "text-primary" : "text-white/30"
              }`}
            />
            {averageUsd && (
              <p className="text-white/30 text-sm">≈ ${averageUsd}</p>
            )}
          </div>
        </div>

        <Button
          onClick={handleCreate}
          disabled={
            isCreating ||
            !description ||
            parseFloat(totalAmount) <= 0 ||
            parseInt(numPeople, 10) < 2 // 👈 enforce minimum of 2 people
          }
          className="w-full bg-primary"
        >
          {isCreating ? "Creating..." : "Create Split"}
        </Button>
      </div>
      <Drawer.Root open={tokenDrawerOpen} onOpenChange={setTokenDrawerOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
          <Drawer.Content className="pb-16 fixed bottom-0 left-0 right-0 bg-background p-4 rounded-t-3xl max-h-[80vh] overflow-y-auto z-50">
            <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-4" />

            <p className="text-center text-white/30 mb-2">Select token</p>
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
                  <div className="text-left">
                    <p className="text-white font-medium">{token.name}</p>
                  </div>
                </button>
              ))}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
