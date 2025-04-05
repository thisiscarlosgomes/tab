import { erc20Abi, formatUnits } from "viem";
import { createPublicClient, http, isAddress } from "viem";
import { base } from "viem/chains"; // change to your target chain if needed

const client = createPublicClient({
  chain: base,
  transport: http(),
});

export async function getTokenBalance({
  tokenAddress,
  userAddress,
  decimals,
}: {
  tokenAddress?: `0x${string}`; // if undefined, assume ETH
  userAddress: `0x${string}`;
  decimals?: number;
}) {
  if (!isAddress(userAddress)) return "0";

  try {
    if (!tokenAddress) {
      const balance = await client.getBalance({ address: userAddress });
      return formatUnits(balance, 18);
    } else {
      const balance = await client.readContract({
        abi: erc20Abi,
        address: tokenAddress,
        functionName: "balanceOf",
        args: [userAddress],
      });
      return formatUnits(balance, decimals || 18);
    }
  } catch {
    return "0";
  }
}
