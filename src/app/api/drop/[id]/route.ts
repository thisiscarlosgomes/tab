import clientPromise from "@/lib/mongodb";
import { NextRequest } from "next/server";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;

function decrypt(text: string) {
  try {
    const [ivHex, encryptedHex] = text.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const encryptedText = Buffer.from(encryptedHex, "hex");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(ENCRYPTION_KEY),
      iv
    );
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    console.error("[CLAIM DECRYPTION FAILED]", e);
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const dropId = req.nextUrl.pathname.split("/").at(-1)?.toLowerCase();
    if (!dropId) {
      return Response.json({ error: "Missing dropId" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const collection = db.collection("a-claim-drops");

    const drop = await collection.findOne(
      { dropId },
      {
        projection: {
          dropId: 1,
          groupId: 1, // 🆕 include groupId
          token: 1,
          amount: 1,
          claimed: 1,
          claimedBy: 1,
          claimedByFid: 1, // 🆕 include fid for visibility
          encryptedClaimToken: 1,
          creator: 1,
          txHash: 1,
        },
      }
    );

    if (!drop) {
      return Response.json({ error: "Drop not found" }, { status: 404 });
    }

    const { encryptedClaimToken, ...rest } = drop;

    const claimToken = !drop.claimed ? decrypt(encryptedClaimToken) : undefined;

    if (!drop.claimed && !claimToken) {
      return Response.json(
        { error: "Failed to decrypt token" },
        { status: 500 }
      );
    }

    return Response.json({ drop: { ...rest, claimToken } });
  } catch (e) {
    console.error("[DROP FETCH ERROR]", e);
    return Response.json({ error: "Failed to load drop" }, { status: 500 });
  }
}
