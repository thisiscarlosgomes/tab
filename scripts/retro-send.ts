// import "dotenv/config";
// import { MongoClient } from "mongodb";
// import { parseUnits } from "viem";
// import { privateKeyToAccount } from "viem/accounts";
// import { createWalletClient, createPublicClient, http } from "viem";
// import { base } from "viem/chains";
// import erc20ABI from "@/lib/erc20-abi";

// const ALCHEMY_URL = process.env.ALCHEMY_URL!; 
// const PRIVATE_KEY = process.env.PRIVATE_KEY!;
// const TOKEN_ADDRESS = "0x154af0cc4df0c1744edc0b4b916f6aa028d009b0"; // $TAB
// const DECIMALS = 18;
// const RETRO_DATE = "2025-04-15";

// const EXCLUDED_ADDRESSES = [
//   "0x0000006616620615198f612c9022424df919db98",
//   "0x9b8fa6469ad0a1e8dcaeeee2974c2bc23ab7c006",
//   "0xdc66a47895d99aa2e1322b5dd2084939bdfa065a",
//   "0x96f3a9b16e310ce46f09ee85f5cf5722e6b98870",
//   "0x87c3215370EF8475418BD7775295C4DB2752212C",
// ].map((a) => a.toLowerCase());

// const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);
// const walletClient = createWalletClient({
//   account,
//   chain: base,
//   transport: http(ALCHEMY_URL),
// });
// const publicClient = createPublicClient({
//   chain: base,
//   transport: http(ALCHEMY_URL),
// });

// const run = async () => {
//   const mongo = await MongoClient.connect(process.env.MONGODB_URI!);
//   const db = mongo.db();

//   const rewards = await db
//     .collection("a-daily-rewards")
//     .find({
//       type: "erc20",
//       timestamp: { $regex: `^${RETRO_DATE}` },
//     })
//     .toArray();

//   const spins = await db.collection("a-daily-spins").find({}).toArray();
//   const fidToAddress: Record<number, string> = {};
//   for (const user of spins) {
//     if (user.address) fidToAddress[user.fid] = user.address;
//   }

//   let totalSent = 0;
//   let nonce = await publicClient.getTransactionCount({
//     address: account.address,
//   });

//   for (const reward of rewards) {
//     const fid = reward.fid;
//     const address = fidToAddress[fid];
//     if (!address) {
//       console.log(`❌ Missing address for fid ${fid}`);
//       continue;
//     }

//     if (EXCLUDED_ADDRESSES.includes(address.toLowerCase())) {
//       console.log(`⏩ Skipping already paid ${address}`);
//       continue;
//     }

//     try {
//       const value = parseUnits(reward.amount.toString(), DECIMALS);
//       const hash = await walletClient.writeContract({
//         address: TOKEN_ADDRESS,
//         abi: erc20ABI,
//         functionName: "transfer",
//         args: [address, value],
//         nonce,
//       });

//       nonce++; // increment for next tx

//       console.log(
//         `✅ Sent ${reward.amount} $TAB to ${address} (fid ${fid}) - ${hash}`
//       );

//       await db.collection("a-daily-token-tracker").updateOne(
//         { date: RETRO_DATE },
//         {
//           $inc: { total: reward.amount },
//           $push: {
//             txs: {
//               $each: [
//                 {
//                   hash,
//                   to: address,
//                   amount: reward.amount,
//                   reason: `retro_daily_spin_${RETRO_DATE}`,
//                   timestamp: new Date().toISOString(),
//                 },
//               ],
//             },
//           } as any, // 👈 Fixes the TS error
//         },
//         { upsert: true }
//       );

//       totalSent += reward.amount;
//     } catch (e) {
//       console.error(`❌ Failed for ${address} (${fid})`, e);
//     }
//   }

//   console.log(`\n🎯 Done. Total $TAB sent: ${totalSent}`);
//   process.exit();
// };

// run();



import "dotenv/config";
import { MongoClient } from "mongodb";
import { parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import erc20ABI from "@/lib/erc20-abi";

const ALCHEMY_URL = process.env.ALCHEMY_URL!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const MONGODB_URI = process.env.MONGODB_URI!;

const TAB_TOKEN_ADDRESS = "0x154af0cc4df0c1744edc0b4b916f6aa028d009b0";
const TAB_DECIMALS = 18;

const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);
const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(ALCHEMY_URL),
});
const publicClient = createPublicClient({
  chain: base,
  transport: http(ALCHEMY_URL),
});

const run = async () => {
  const mongo = await MongoClient.connect(MONGODB_URI);
  const db = mongo.db();

  const rewards = await db
    .collection("a-jackpot-rewards")
    .find({ txHash: null })
    .toArray();

  let totalSent = 0;
  let nonce = await publicClient.getTransactionCount({
    address: account.address,
  });

  for (const reward of rewards) {
    const address = reward.address;
    const amount = reward.amount;
    const fid = reward.fid;

    if (!address || typeof amount !== "number") {
      console.log(`❌ Invalid data for reward (fid ${fid}):`, reward);
      continue;
    }

    try {
      const value = parseUnits(amount.toString(), TAB_DECIMALS);
      const hash = await walletClient.writeContract({
        address: TAB_TOKEN_ADDRESS,
        abi: erc20ABI,
        functionName: "transfer",
        args: [address, value],
        nonce,
      });

      nonce++;

      console.log(`✅ Sent ${amount} $TAB to ${address} (fid ${fid}) — ${hash}`);

      await db.collection("a-jackpot-rewards").updateOne(
        { _id: reward._id },
        { $set: { txHash: hash } }
      );

      totalSent += amount;
    } catch (e) {
      console.error(`❌ Failed to send to ${address} (fid ${fid})`, e);
    }
  }

  console.log(`\n🎯 Done. Total $TAB sent: ${totalSent}`);
  process.exit();
};

run();
