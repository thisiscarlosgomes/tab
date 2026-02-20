import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { writeActivity } from "@/lib/writeActivity";

const DEFAULT_LIMIT = 50;

export async function GET(req: NextRequest) {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const address = parts.slice(-1)[0]?.toLowerCase();

  if (!address) {
    return Response.json({ error: "Missing address" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const before = searchParams.get("before");

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-earn-deposit");

  const query: any = { address };
  if (before) {
    query.timestamp = { $lt: new Date(before) };
  }

  const deposits = await collection
    .find(query)
    .project({
      _id: 0,
      amount: 1,
      timestamp: 1,
      txHash: 1,
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  const totalAgg = await collection
    .aggregate([
      { $match: { address } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();

  const total = totalAgg[0]?.total ?? 0;

  return Response.json({
    address,
    total,
    deposits,
    nextCursor:
      deposits.length === limit
        ? deposits[deposits.length - 1].timestamp
        : null,
  });
}

export async function POST(req: NextRequest) {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const address = parts.slice(-1)[0]?.toLowerCase();

  if (!address) {
    return Response.json({ error: "Missing address" }, { status: 400 });
  }

  const body = await req.json();
  const { amount, txHash, fid } = body;

  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-earn-deposit");

  const timestamp = new Date();

  await collection.insertOne({
    fid,
    address,
    amount: Number(amount),
    txHash: txHash ?? null,
    timestamp,
  });

  // ✅ ACTIVITY: Earn deposit
  writeActivity({
    address,
    type: "earn_deposit",
    refType: "earn",
    refId: txHash ?? timestamp.toISOString(),
    amount: Number(amount),
    token: "USDC",
    timestamp,
  });

  return Response.json({
    success: true,
    address,
    amount: Number(amount),
    txHash: txHash ?? null,
    timestamp,
  });
}
