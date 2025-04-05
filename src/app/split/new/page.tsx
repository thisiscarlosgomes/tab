"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import sdk from "@farcaster/frame-sdk";
import { nanoid } from "nanoid";

import { Button } from "@/components/ui/button";
import { useAddPoints } from "@/lib/useAddPoints";

export default function SplitNewPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();

  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [numPeople, setNumPeople] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [ethPriceUsd, setEthPriceUsd] = useState<number | null>(null);

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
        );
        const data = await res.json();
        setEthPriceUsd(data.ethereum.usd);
      } catch (e) {
        console.error("Failed to fetch ETH price", e);
      }
    };

    fetchPrice();
  }, []);

  const averagePerPerson =
    parseFloat(totalAmount) > 0 && parseInt(numPeople) > 0
      ? (parseFloat(totalAmount) / parseInt(numPeople))
          .toFixed(6)
          .replace(/\.?0+$/, "")
      : "0.00";

  const totalUsd =
    ethPriceUsd && parseFloat(totalAmount) > 0
      ? (parseFloat(totalAmount) * ethPriceUsd).toFixed(2)
      : null;

  const averageUsd =
    ethPriceUsd && parseFloat(averagePerPerson) > 0
      ? (parseFloat(averagePerPerson) * ethPriceUsd).toFixed(2)
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
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-16 pb-32 overflow-y-auto hide-scrollbar">
      <div className="w-full max-w-md p-6 flex flex-col space-y-2 rounded-lg">
        <h1 className="text-2xl font-bold text-center hidden">
          Split The Bill
        </h1>

        <input
          type="text"
          placeholder="tab name (e.g. Pizza night)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="placeholder-white/20 w-full p-4 rounded-lg text-white bg-white/5"
        />

        <div className="relative w-full">
          <input
            type="number"
            placeholder="total amount (ETH)"
            min={0}
            step={0.001}
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            className="placeholder-white/20 w-full p-4 rounded-lg text-white bg-white/5"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center space-x-1 text-white/70 text-base pointer-events-none">
            <span className="text-white/30">
              ≈ ${totalUsd && parseFloat(totalUsd) > 0 ? totalUsd : "0.00"}
            </span>
            {/* <span>ETH</span> */}
          </span>
        </div>

        <input
          type="number"
          placeholder="number of people"
          min={1}
          value={numPeople}
          onChange={(e) => setNumPeople(e.target.value)}
          className="placeholder-white/20 w-full p-4 rounded-lg text-white bg-white/5"
        />

        <div className="text-center space-y-2 p-2">
          <p className="text-white/30 text-sm">Average per person</p>
          <div>
            <p className="text-5xl text-primary font-medium">
              {averagePerPerson}{" "}
              <span className="text-base text-primary font-medium">ETH</span>
            </p>
          </div>
          <p className="text-white/30 text-sm">
            ≈ ${averageUsd && parseFloat(averageUsd) > 0 ? averageUsd : "0.00"}{" "}
          </p>
        </div>
        <Button
          onClick={handleCreate}
          disabled={
            isCreating ||
            !description ||
            parseFloat(totalAmount) <= 0 ||
            parseInt(numPeople, 10) <= 0
          }
          className="w-full bg-primary"
        >
          {isCreating ? "Creating..." : "Create Split"}
        </Button>
      </div>
    </div>
  );
}
