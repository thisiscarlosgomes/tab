import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { creator, participants, amount, description } = body;

    if (!creator || !Array.isArray(participants) || participants.length === 0) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const splitId = crypto.randomBytes(4).toString("hex");

    const doc = {
      splitId,
      creator,
      participants: participants.map((p) => ({
        address: p,
        name: p,
        pfp: null,
        fid: null,
        amount: amount ? amount / participants.length : 0,
      })),
      description,
      totalAmount: amount ?? 0,
      numPeople: participants.length,
      token: "USDC",
      invited: [],
      paid: [],
      createdAt: new Date(),
    };

    const client = await clientPromise;
    const db = client.db();
    const col = db.collection("a-split-bill");

    await col.insertOne(doc);

    return Response.json({ splitId });
  } catch (err) {
    console.error("XMTP create-split API error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}


export function GET() {
  return Response.json({ ok: true });
}