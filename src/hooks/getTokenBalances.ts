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
    balances[token.name] = balancesBySymbol[key] ?? "0";
  }

  return balances;
}
