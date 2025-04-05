import { NextRequest } from "next/server";
import {
  //   createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import erc20ABI from "@/lib/erc20-abi"; // you’ll need to add this

const ALCHEMY_URL = process.env.ALCHEMY_URL!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;

const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(ALCHEMY_URL),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      to,
      amount,
      type = "eth",
      tokenAddress,
      decimals = 18,
      reason,
    } = body;

    if (!to || !amount) {
      return new Response(
        JSON.stringify({ error: "Missing 'to' or 'amount'" }),
        { status: 400 }
      );
    }

    let hash;

    if (type === "erc20") {
      if (!tokenAddress) {
        return new Response(
          JSON.stringify({ error: "Missing tokenAddress for ERC20 send" }),
          { status: 400 }
        );
      }

      const value = parseUnits(amount.toString(), decimals);

      hash = await walletClient.writeContract({
        address: tokenAddress,
        abi: erc20ABI,
        functionName: "transfer",
        args: [to, value],
      });

      console.log(
        `[SEND] Sent ${amount} tokens to ${to} (${reason}) — tx: ${hash}`
      );
    } else {
      const value = parseEther(amount.toString());

      hash = await walletClient.sendTransaction({
        to,
        value,
      });

      console.log(
        `[SEND] Sent ${amount} ETH to ${to} (${reason}) — tx: ${hash}`
      );
    }

    return new Response(JSON.stringify({ success: true, hash }));
  } catch (e) {
    console.error("[SEND] Error:", e);
    return new Response(JSON.stringify({ error: "Send failed" }), {
      status: 500,
    });
  }
}
