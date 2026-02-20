import { neynarApi } from "@/lib/neynar";
import { createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import erc20ABI from "@/lib/erc20-abi";
import clientPromise from "@/lib/mongodb";

// For compatibility with SDK type
type CastParamType = "hash" | "url";

const ALCHEMY_URL = process.env.ALCHEMY_URL!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const TOKEN_ADDRESS = "0x154af0cc4df0c1744edc0b4b916f6aa028d009b0"; // $TAB
const TOKEN_AMOUNT = "10"; // Tokens to send per quote
const TOKEN_DECIMALS = 18;

const BANNED_ADDRESSES = new Set([
  "0x0000006616620615198f612c9022424df919db98",
  "0x9b8fa6469ad0a1e8dcaeeee2974c2bc23ab7c006",
  "0xdc66a47895d99aa2e1322b5dd2084939bdfa065a",
  "0x96f3a9b16e310ce46f09ee85f5cf5722e6b98870",
]);
const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);
const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(ALCHEMY_URL),
});

async function hasBeenSent(fid: number, castHash: string) {
  const db = (await clientPromise).db();
  const record = await db
    .collection("a-distributed-quote-users")
    .findOne({ fid, castHash });
  return !!record;
}

async function markAsSent(fid: number, castHash: string, txHash: string) {
  const db = (await clientPromise).db();
  await db.collection("a-distributed-quote-users").insertOne({
    fid,
    castHash,
    txHash,
    timestamp: new Date(),
  });
}

export async function distributeToQuotes(castUrl: string) {
  console.log(`🚀 Checking quotes for ${castUrl}`);

  // Force-cast response to known structure since SDK type is incomplete
  const conversation = (await neynarApi.lookupCastConversation({
    identifier: castUrl,
    type: "url" as CastParamType,
    replyDepth: 1,
  })) as unknown as { parent: any; casts: any[] };

  const originalHash = conversation.parent.hash;

  const quotes = conversation.casts.filter(
    (cast) => cast.parent_hash === originalHash && cast.parent_author?.fid
  );

  console.log(`🧾 Found ${quotes.length} quote casts`);

  for (const quote of quotes) {
    const fid = quote.author.fid;
    const username = quote.author.username;

    let user;
    try {
      const result = await neynarApi.lookupUserByUsername(username);
      user = result.user;
    } catch (err) {
      console.error(`⚠️ Failed to fetch user for @${username}`, err);
      continue;
    }

    const to = user?.verified_addresses?.primary?.eth_address?.toLowerCase();

    if (!to) {
      console.log(`⚠️ Skipping @${username} — no verified ETH address`);
      continue;
    }

    if (BANNED_ADDRESSES.has(to)) {
      console.log(`⛔ Skipping banned address: ${to}`);
      continue;
    }

    const alreadySent = await hasBeenSent(fid, originalHash);
    if (alreadySent) {
      console.log(`⏩ Already sent to fid ${fid}`);
      continue;
    }

    try {
      const value = parseUnits(TOKEN_AMOUNT, TOKEN_DECIMALS);
      const hash = await walletClient.writeContract({
        address: TOKEN_ADDRESS as `0x${string}`,
        abi: erc20ABI,
        functionName: "transfer",
        args: [to as `0x${string}`, value],
      });

      await markAsSent(fid, originalHash, hash);
      console.log(
        `✅ Sent ${TOKEN_AMOUNT} tokens to @${username} (${to}) — tx: ${hash}`
      );
    } catch (err) {
      console.error(`❌ Failed to send to @${username}:`, err);
    }
  }

  console.log("✅ Distribution complete");
}
