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
// const RETRO_DATE = "2025-03-30";

// const EXCLUDED_ADDRESSES = [
//   "0x52E9d56406AA3b5cac4cB4F46D7a774f40010fb2",
//   "0xDA9169A7981d24Df11F6249F31E0f4533d51eD51",
//   "0x3774CaEA9293120514f46dB8e86d0d59FB85C557",
//   "0x2C0e91766b2D02A45582B8a6349c97c91606F4f9",
//   "0x04363Bc17667727484fb5369B97ba56C07229B20",
//   "0xa4E2c9a087ae95E6668c32a8080348a6D32602F4",
//   "0xB2d74B0FdCE518FbfBCF9605b34dc3BBFf928eb0",
//   "0xaE8D39EE506b332564Ba7540AEDC139cfF3e7Bb8",
//   "0xBC3Df567956C910E1377581898e2E4B981248690",
//   "0x5b50130b9B91FEb83f369A438a1781bAc462933f",
//   "0x3b86EB8b0cb13bd4B37f51929340b43609CcF3a2",
//   "0x7e80C2CAdbA27F6aC5f7f7BA6c676A5333b9C452",
//   "0x48aCB1057bed8E881813fA1177AbD61B6B8D77dF",
//   "0x1494FE694582ADDAdaA4901110824d955F7e6005",
//   "0xf10883c62152d1DD289Cb1ae51c5b3203b2A409C",
//   "0x51C9A6880eef01c639231145512df83113711c40",
//   "0xD9812b046E0f6Cb0AC2c7eb7D32b10f4f793C251",
//   "0xb988753269B84180A0D4BAD0548BAC35f516cd4D",
//   "0x8eC98D09F8af7612Fe8f86d28fF4d18dA2E39c0a",
//   "0x04b7b37e558c88F791e481eE8cA978CCB9a650Be",
//   "0x3Aa04819D17B319F1aD01ba65BE7fe6fa01bdcb0",
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

//   const rewards = await db.collection("a-daily-rewards").find({
//     type: "erc20",
//     timestamp: { $regex: `^${RETRO_DATE}` },
//   }).toArray();

//   const spins = await db.collection("a-daily-spins").find({}).toArray();
//   const fidToAddress: Record<number, string> = {};
//   for (const user of spins) {
//     if (user.address) fidToAddress[user.fid] = user.address;
//   }

//   let totalSent = 0;
//   let nonce = await publicClient.getTransactionCount({ address: account.address });

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

//       console.log(`✅ Sent ${reward.amount} $TAB to ${address} (fid ${fid}) - ${hash}`);

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
