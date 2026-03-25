import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { writeActivity } from "@/lib/writeActivity";

/* =========================
   POST — log jackpot entry
========================= */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, amount, fid, ticketCount, txHash } = body;

    if (!address || !fid || isNaN(Number(amount)) || Number(amount) <= 0) {
      return Response.json(
        { error: "Missing or invalid address, fid, or amount" },
        { status: 400 }
      );
    }

    const lowerAddress = address.toLowerCase();
    const client = await clientPromise;
    const db = client.db();

    const depositedAt = new Date();

    // 1️⃣ Log jackpot deposit
    await db.collection("a-jackpot-deposit").insertOne({
      fid,
      address: lowerAddress,
      amount: Number(amount),
      ticketCount: Number(ticketCount) || 0,
      txHash: typeof txHash === "string" ? txHash.toLowerCase() : null,
      timestamp: depositedAt,
    });

    // 2️⃣ Activity entry
    writeActivity({
      address: lowerAddress,
      type: "jackpot_deposit",
      refType: "jackpot",
      refId: "daily",
      amount: Number(amount),
      token: "USDC",
      ticketCount: Number(ticketCount) || 0,
      txHash: typeof txHash === "string" ? txHash.toLowerCase() : undefined,
      timestamp: depositedAt,
    });

    return Response.json({ success: true });
  } catch (err) {
    console.error("[jackpot POST] failed", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

/* =========================
   GET — recent jackpot users
========================= */
export async function GET() {
  try {
    const client = await clientPromise;
    const db = client.db();

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const users = await db
      .collection("a-jackpot-deposit")
      .aggregate([
        { $match: { timestamp: { $gte: cutoff } } },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: "$fid",
            address: { $first: "$address" },
            timestamp: { $first: "$timestamp" },
          },
        },
        { $limit: 5 },
      ])
      .toArray();

    return Response.json({ users });
  } catch (err) {
    console.error("[jackpot GET] failed", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
