import clientPromise from "@/lib/mongodb";
import { NextRequest } from "next/server";
import crypto, { randomBytes, createHash } from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;
const IV_LENGTH = 16;

function encrypt(text: string) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY),
    iv
  );
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export async function POST(req: NextRequest) {
  const { creator, token, amount, numRecipients = 1 } = await req.json();
  const baseUrl = process.env.PUBLIC_URL?.trim() || req.nextUrl.origin;

  if (!creator?.address || !token || !amount) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes (256 bits)");
  }

  const parsedAmount = parseFloat(amount);
  const count =
    typeof numRecipients === "string"
      ? parseInt(numRecipients)
      : Number(numRecipients);

  if (isNaN(parsedAmount) || isNaN(count) || count <= 0) {
    return Response.json({ error: "Invalid amount or count" }, { status: 400 });
  }

  const unitAmount = parsedAmount / count;

  if (unitAmount <= 0) {
    return Response.json({ error: "Split amount too small" }, { status: 400 });
  }

  const drops: {
    dropId: string;
    claimToken: string;
    claimUrl: string;
  }[] = [];

  const groupId = `group-${crypto.randomUUID().slice(0, 8)}`; // ✅ Generate once

  const client = await clientPromise;
  const db = client.db();

  for (let i = 0; i < count; i++) {
    const dropId = `tab-${crypto.randomUUID().slice(0, 6)}`;
    const claimToken = randomBytes(16).toString("hex");
    const claimTokenHash = createHash("sha256")
      .update(claimToken)
      .digest("hex");
    const encryptedClaimToken = encrypt(claimToken);

    await db.collection("a-claim-drops").insertOne({
      dropId,
      groupId,
      token,
      amount: unitAmount.toString(),
      creator,
      encryptedClaimToken,
      claimTokenHash,
      claimed: false,
      createdAt: new Date(),
    });

    drops.push({
      dropId,
      claimToken,
      claimUrl: `${baseUrl}/claim/${dropId}?claimToken=${claimToken}`,
    });
  }

  const groupUrl = `${baseUrl}/claims/group/${groupId}`;

  return Response.json({ drops, groupUrl });
}

export async function GET(req: NextRequest) {
  const creator = req.nextUrl.searchParams.get("creator");
  if (!creator) {
    return Response.json({ error: "Missing creator" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-claim-drops");

  const allDrops = await collection
    .find(
      {
        $or: [{ "creator.address": creator }, { creator: creator }],
      },
      { collation: { locale: "en", strength: 2 } }
    )
    .sort({ createdAt: -1 })
    .toArray();

  const grouped: Record<string, unknown[]> = {};

  for (const drop of allDrops) {
    const key = drop.groupId || drop.dropId;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(drop);
  }

  const summarizedDrops = Object.entries(grouped).map(([key, drops]) => {
    const first = drops[0];
    const isGroup = !!first.groupId;

    return {
      dropId: first.dropId,
      groupId: first.groupId ?? null,
      token: first.token,
      amount: (parseFloat(first.amount) * drops.length).toFixed(4),
      claimed: drops.every((d) => d.claimed),
      claimedCount: drops.filter((d) => d.claimed).length,
      totalCount: drops.length,
      claimedBy: !isGroup ? first.claimedBy : null,
      claimedByFid: !isGroup ? first.claimedByFid : null,
      createdAt: first.createdAt,
    };
  });

  return Response.json({ drops: summarizedDrops });
}
