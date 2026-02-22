import { NextRequest } from "next/server";
import { createWalletClient, http, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { isAddress } from "viem";
import erc20ABI from "@/lib/erc20-abi";
import clientPromise from "@/lib/mongodb";
import { requireTrustedRequest } from "@/lib/security";

const ALCHEMY_URL = process.env.ALCHEMY_URL!;
const RAW_PRIVATE_KEY = process.env.PRIVATE_KEY!;
const PRIVATE_KEY = RAW_PRIVATE_KEY.trim().replace(/^0x/i, "");
const TOKEN_DECIMALS = 18;

const BANNED_ADDRESSES = new Set([
  "0x0000006616620615198f612c9022424df919db98",
  "0x9b8fa6469ad0a1e8dcaeeee2974c2bc23ab7c006",
  "0xdc66a47895d99aa2e1322b5dd2084939bdfa065a",
  "0x96f3a9b16e310ce46f09ee85f5cf5722e6b98870",
]);

if (!/^[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) {
  throw new Error(
    "Invalid PRIVATE_KEY environment variable: expected 32-byte hex (with or without 0x prefix)"
  );
}

const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);
const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(ALCHEMY_URL),
});

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "send",
    limit: 40,
    windowMs: 60_000,
    requireInternalSecret: true,
  });
  if (denied) return denied;

  try {
    const body = await req.json();
    const {
      to,
      amount,
      type = "eth",
      tokenAddress,
      decimals = TOKEN_DECIMALS,
      reason,
    } = body;

    if (!to || !amount) {
      return new Response(
        JSON.stringify({ error: "Missing 'to' or 'amount'" }),
        { status: 400 }
      );
    }

    if (!isAddress(to)) {
      return new Response(JSON.stringify({ error: "Invalid recipient address" }), {
        status: 400,
      });
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid amount" }), {
        status: 400,
      });
    }

    if (type !== "eth" && type !== "erc20") {
      return new Response(JSON.stringify({ error: "Invalid type" }), {
        status: 400,
      });
    }

    const lowerTo = to.toLowerCase();

    if (reason?.startsWith("daily_spin_")) {
      const today = new Date().toISOString().slice(0, 10);
      const db = (await clientPromise).db();
      const tracker = await db
        .collection("a-daily-token-tracker")
        .findOne({ date: today });

      type TrackerTx = {
        to: string;
        reason: string;
        send?: boolean;
      };

      const alreadySent =
        Array.isArray(tracker?.txs) &&
        tracker.txs.some(
          (tx: TrackerTx) =>
            tx.to.toLowerCase() === lowerTo &&
            tx.reason === `daily_spin_${today}` &&
            tx.send === true
        );

      if (alreadySent) {
        return new Response(
          JSON.stringify({ error: "Already received today's spin reward" }),
          { status: 403 }
        );
      }
    }

    if (BANNED_ADDRESSES.has(lowerTo)) {
      return new Response(JSON.stringify({ error: "Blocked address" }), {
        status: 403,
      });
    }

    let hash;

    if (type === "erc20") {
      if (!tokenAddress) {
        return new Response(
          JSON.stringify({ error: "Missing tokenAddress for ERC20 send" }),
          { status: 400 }
        );
      }

      if (!isAddress(tokenAddress)) {
        return new Response(JSON.stringify({ error: "Invalid token address" }), {
          status: 400,
        });
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
