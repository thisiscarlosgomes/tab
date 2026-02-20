import { erc20Abi, formatUnits } from "viem";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_ALCHEMY_URL!),
});

export async function getTokenBalances({
  address,
  tokens,
}: {
  address: `0x${string}`;
  tokens: {
    name: string;
    address?: string; // ← make address optional to allow ETH
    decimals: number;
  }[];
}): Promise<Record<string, string>> {
  const balances: Record<string, string> = {};

  for (const token of tokens) {
    try {
      if (token.name === "ETH" || !token.address) {
        // Native ETH
        const raw = await client.getBalance({ address });
        balances[token.name] = formatUnits(raw, token.decimals);
      } else {
        // ERC-20
        const raw = await client.readContract({
          address: token.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });

        balances[token.name] = formatUnits(raw, token.decimals);
      }
    } catch (err) {
      console.error(`❌ Failed to fetch ${token.name}`, err);
      balances[token.name] = "0";
    }
  }

  return balances;
}
