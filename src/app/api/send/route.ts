// import { NextRequest } from "next/server";
// import {
//   //   createPublicClient,
//   createWalletClient,
//   http,
//   parseEther,
//   parseUnits,
// } from "viem";
// import { privateKeyToAccount } from "viem/accounts";
// import { base } from "viem/chains";
// import erc20ABI from "@/lib/erc20-abi"; // you’ll need to add this

// const ALCHEMY_URL = process.env.ALCHEMY_URL!;
// const PRIVATE_KEY = process.env.PRIVATE_KEY!;

// const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);

// const walletClient = createWalletClient({
//   account,
//   chain: base,
//   transport: http(ALCHEMY_URL),
// });

// export async function POST(req: NextRequest) {
//   try {
//     const body = await req.json();
//     const {
//       to,
//       amount,
//       type = "eth",
//       tokenAddress,
//       decimals = 18,
//       reason,
//     } = body;

//     if (!to || !amount) {
//       return new Response(
//         JSON.stringify({ error: "Missing 'to' or 'amount'" }),
//         { status: 400 }
//       );
//     }

    
//     let hash;

//     if (type === "erc20") {
//       if (!tokenAddress) {
//         return new Response(
//           JSON.stringify({ error: "Missing tokenAddress for ERC20 send" }),
//           { status: 400 }
//         );
//       }

//       const value = parseUnits(amount.toString(), decimals);

//       hash = await walletClient.writeContract({
//         address: tokenAddress,
//         abi: erc20ABI,
//         functionName: "transfer",
//         args: [to, value],
//       });
      

//       console.log(
//         `[SEND] Sent ${amount} tokens to ${to} (${reason}) — tx: ${hash}`
//       );
//     } else {
//       const value = parseEther(amount.toString());

//       hash = await walletClient.sendTransaction({
//         to,
//         value,
//       });

//       console.log(
//         `[SEND] Sent ${amount} ETH to ${to} (${reason}) — tx: ${hash}`
//       );
//     }

//     return new Response(JSON.stringify({ success: true, hash }));
//   } catch (e) {
//     console.error("[SEND] Error:", e);
//     return new Response(JSON.stringify({ error: "Send failed" }), {
//       status: 500,
//     });
//   }
// }


import { NextRequest } from "next/server";
import {
  createWalletClient,
  http,
  parseEther,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import erc20ABI from "@/lib/erc20-abi";
import clientPromise from "@/lib/mongodb";

const ALCHEMY_URL = process.env.ALCHEMY_URL!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const TOKEN_DECIMALS = 18;

const BANNED_ADDRESS = "0x0000006616620615198f612C9022424DF919dB98".toLowerCase();

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
      decimals = TOKEN_DECIMALS,
      reason,
    } = body;

    if (!to || !amount) {
      return new Response(
        JSON.stringify({ error: "Missing 'to' or 'amount'" }),
        { status: 400 }
      );
    }

    const lowerTo = to.toLowerCase();

    // 🚫 Blocklisted address check
    if (lowerTo === BANNED_ADDRESS) {
      return new Response(
        JSON.stringify({ error: "Blocked address" }),
        { status: 403 }
      );
    }

    const now = new Date();
    const isSpinReward = reason?.startsWith("daily_spin_");

    // 🛡️ Cooldown check (8h)
    if (isSpinReward) {
      const db = (await clientPromise).db();
      const spins = db.collection("a-daily-spins");
      const today = new Date().toISOString().slice(0, 10);

      const recentSpin = await spins.findOne({
        address: lowerTo,
        [`spins.${today}`]: {
          $elemMatch: {
            reward: { $ne: "Nothing today" },
            timestamp: {
              $gt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
            },
          },
        },
      });

      if (recentSpin) {
        return new Response(
          JSON.stringify({
            error: "User already received a spin reward in the last 8 hours",
          }),
          { status: 403 }
        );
      }
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

      console.log(`[SEND] Sent ${amount} tokens to ${to} (${reason}) — tx: ${hash}`);
    } else {
      const value = parseEther(amount.toString());

      hash = await walletClient.sendTransaction({
        to,
        value,
      });

      console.log(`[SEND] Sent ${amount} ETH to ${to} (${reason}) — tx: ${hash}`);
    }

    return new Response(JSON.stringify({ success: true, hash }));
  } catch (e) {
    console.error("[SEND] Error:", e);
    return new Response(JSON.stringify({ error: "Send failed" }), {
      status: 500,
    });
  }
}
