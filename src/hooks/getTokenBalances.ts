import { getMoralisTokenBalances } from "@/lib/moralis-portfolio-client";

export async function getTokenBalances({
  address,
  tokens,
  force = false,
}: {
  address: `0x${string}`;
  tokens: {
    name: string;
    address?: string; // ← make address optional to allow ETH
    decimals: number;
  }[];
  force?: boolean;
}): Promise<Record<string, string>> {
  const balancesBySymbol = await getMoralisTokenBalances(address, {
    baseOnly: true,
    force,
  });

  const balances: Record<string, string> = {};
  for (const token of tokens) {
    const key = token.name.trim().toUpperCase();
    let value = balancesBySymbol[key];

    // Moralis/Base portfolios often expose wrapped native balance as WETH.
    // Let the send UI show an ETH balance using WETH as a fallback.
    if ((value === undefined || value === null) && key === "ETH") {
      value = balancesBySymbol.WETH;
    }

    balances[token.name] = value ?? "0";
  }

  return balances;
}
