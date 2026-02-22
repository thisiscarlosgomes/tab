import { createPublicClient, fallback, http } from "viem";
import { base } from "viem/chains";

const ALCHEMY_URL = process.env.NEXT_PUBLIC_ALCHEMY_URL;

const transports = [
  ALCHEMY_URL ? http(ALCHEMY_URL, { timeout: 8_000, retryCount: 1 }) : null,
  http("https://mainnet.base.org", { timeout: 8_000, retryCount: 1 }),
  http("https://base.llamarpc.com", { timeout: 8_000, retryCount: 1 }),
  http("https://base-rpc.publicnode.com", { timeout: 8_000, retryCount: 1 }),
  http("https://base.drpc.org", { timeout: 8_000, retryCount: 1 }),
].filter(Boolean);

const client = createPublicClient({
  chain: base,
  transport: fallback(transports, {
    rank: true,
    retryCount: 0,
  }),
});

if (!client) {
  throw new Error("Failed to create viem client");
}

export default client;
