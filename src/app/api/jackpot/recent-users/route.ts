// /app/api/jackpot/recent-users/route.ts
export const runtime = "nodejs";

import clientPromise from "@/lib/mongodb";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  const client = await clientPromise;
  const db = client.db();

  const deposits = db.collection("a-jackpot-deposit");

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 1. Get last 5 unique addresses based on most recent deposit
  const raw = await deposits
    .aggregate([
      { $match: { timestamp: { $gte: since30d } } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$address",
          address: { $first: "$address" },
          timestamp: { $first: "$timestamp" },
        },
      },
      { $sort: { timestamp: -1 } },
      { $limit: 5 },
    ])
    .toArray();

  const enriched = [];

  // 2. For each recent jackpot user → fetch Farcaster profile
  for (const u of raw) {
    let username = null;
    let pfp_url = null;

    try {
      const res = await fetch(
        `${origin}/api/neynar/user/by-address/${u.address}`
      );
      const data = await res.json();

      // Your endpoint response shape:
      // { username, pfp_url, ... }
      username = data?.username ?? null;
      pfp_url = data?.pfp_url ?? null;
    } catch (err) {
      console.error("NEYNAR lookup failed:", err);
    }

    enriched.push({
      address: u.address,
      timestamp: u.timestamp,
      username,
      pfp_url,
    });
  }

  return NextResponse.json({ users: enriched });
}
