import { isAddress } from "viem";
import { tokenList } from "@/lib/tokens";
import { getMoralisBalanceForSymbol } from "@/lib/moralis-portfolio-client";

export async function getTokenBalance({
  tokenAddress,
  userAddress,
  decimals: _decimals,
  force = false,
}: {
  tokenAddress?: `0x${string}`; // if undefined, assume ETH
  userAddress: `0x${string}`;
  decimals?: number;
  force?: boolean;
}) {
  if (!isAddress(userAddress)) return "0";

  const symbol = !tokenAddress
    ? "ETH"
    : (tokenList.find(
        (token) =>
          typeof token.address === "string" &&
          token.address.toLowerCase() === tokenAddress.toLowerCase()
      )?.name ?? null);

  if (!symbol) return "0";

  try {
    return await getMoralisBalanceForSymbol(userAddress, symbol, {
      baseOnly: true,
      force,
    });
  } catch {
    return "0";
  }
}
