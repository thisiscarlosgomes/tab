"use client";

import { useEffect, useState } from "react";
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";
import { erc4626Abi } from "viem";

const VAULT_ADDRESS = "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca";
const USDC_DECIMALS = 6;

// ✅ IMPORTANT: explicit Base RPC
const client = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

export function useMorphoPosition(address?: string) {
  const [earnBalance, setEarnBalance] = useState<number>(0);
  const [monthlyEarn, setMonthlyEarn] = useState<number>(0);

  useEffect(() => {
    if (!address) return;

    let cancelled = false;

    const fetchPosition = async () => {
      try {
        const shares = await client.readContract({
          address: VAULT_ADDRESS,
          abi: erc4626Abi,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        });

        if (shares === 0n) {
          if (!cancelled) {
            setEarnBalance(0);
            setMonthlyEarn(0);
          }
          return;
        }

        const assets = await client.readContract({
          address: VAULT_ADDRESS,
          abi: erc4626Abi,
          functionName: "convertToAssets",
          args: [shares],
        });

        const usdc = parseFloat(formatUnits(assets, USDC_DECIMALS));

        if (!cancelled) {
          setEarnBalance(usdc);

          // SAME logic as old working version
          const NET_APY = 0.065;
          setMonthlyEarn((usdc * NET_APY) / 12);
        }
      } catch (err) {
        console.error("[useMorphoPosition] failed", err);
        // ❗ DO NOT wipe state on error
      }
    };

    fetchPosition();

    const onUpdate = () => fetchPosition();
    window.addEventListener("tab:balance-updated", onUpdate);

    return () => {
      cancelled = true;
      window.removeEventListener("tab:balance-updated", onUpdate);
    };
  }, [address]);

  return { earnBalance, monthlyEarn };
}
