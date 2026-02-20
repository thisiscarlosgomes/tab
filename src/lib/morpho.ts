import { MarketParams } from "@morpho-org/blue-sdk";
import type { MarketId } from "@morpho-org/blue-sdk";
import "@morpho-org/blue-sdk-viem/lib/augment/MarketParams";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

// USDC/wstETH market ID on Base
const MARKET_ID = "0xd63070114470f685b75B74D60EEc7c1113d33a3D" as MarketId;

const client = createPublicClient({
  chain: base,
  transport: http(),
});

export async function getUsdcMarketParams() {
  try {
    const marketParams = await MarketParams.fetch(MARKET_ID, client);
    return marketParams;
  } catch (err) {
    console.error("Failed to fetch market params", err);
    throw err;
  }
}
