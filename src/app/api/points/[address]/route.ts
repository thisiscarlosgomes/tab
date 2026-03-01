// app/api/points/[address]/route.ts
import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

type HistoryEntry = {
  action: string;
  points: number;
  tabId?: string;
  splitId?: string;
  timestamp: Date;
};

type UserPoints = {
  address: string;
  points: number;
  history: HistoryEntry[];
};

const POINTS_MAP: Record<string, number> = {
  create_tab: 100,
  pay: 100,
  spin_win: 100,
  send_token: 200,
  join_tab: 100,
  top_10_week: 500,
  share_frame: 50,
  add_frame: 50,
  earn_deposit: 200,
};

export async function GET(req: NextRequest) {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const address = parts.slice(-1)[0]?.toLowerCase();

  if (!address) {
    return new Response(JSON.stringify({ error: "Missing address" }), {
      status: 400,
    });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<UserPoints>("a-user-points");

  const userPoints = await collection.findOne(
    { address },
    { collation: { locale: "en", strength: 2 } }
  );

  if (!userPoints) {
    return new Response(
      JSON.stringify({ error: "No points found for this address" }),
      { status: 404 }
    );
  }

  // Breakdown of points
  const breakdown: Record<string, number> = {};
  for (const h of userPoints.history || []) {
    if (h.action === "invite") continue; // hide deprecated
    breakdown[h.action] = (breakdown[h.action] || 0) + h.points;
  }

  return Response.json({
    address: userPoints.address,
    points: userPoints.points,
    breakdown,
    history: userPoints.history.filter((h) => h.action !== "invite"),
  });
}

export async function POST(req: NextRequest) {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const address = parts.slice(-1)[0]?.toLowerCase();

  if (!address) {
    return new Response(JSON.stringify({ error: "Missing address" }), {
      status: 400,
    });
  }

  const body = await req.json();
  const rawAction = body.action;
  const action = rawAction?.toLowerCase();
  const { tabId, splitId, amount } = body;

  if (!action || !POINTS_MAP[action] || action === "invite") {
    return new Response(
      JSON.stringify({ error: "Invalid or disallowed action" }),
      { status: 400 }
    );
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<UserPoints>("a-user-points");

  const user = await collection.findOne(
    { address },
    { collation: { locale: "en", strength: 2 } }
  );

  // 🛑 1-time only actions
  if (action === "add_frame" || action === "share_frame") {
    const alreadyRewarded = user?.history?.some((h) => h.action === action);
    if (alreadyRewarded) {
      return Response.json({ success: true, skipped: true });
    }
  }

  // 🛑 Limit tab creation rewards to 3
  if (action === "create_tab") {
    const existing =
      user?.history?.filter((h) => h.action === "create_tab").length ?? 0;
    if (existing >= 3) {
      return Response.json({
        success: true,
        skipped: true,
        reason: "Already rewarded for 3 tabs",
      });
    }
  }

  // const points = POINTS_MAP[action];
  // const points = typeof body.amount === "number" ? body.amount : POINTS_MAP[action];
  const points = typeof amount === "number" ? amount : POINTS_MAP[action];

  await collection.updateOne(
    { address },
    {
      $inc: { points },
      $push: {
        history: {
          action,
          points,
          tabId,
          splitId,
          timestamp: new Date(),
        },
      },
    },
    { upsert: true }
  );

  const updated = await collection.findOne(
    { address },
    { collation: { locale: "en", strength: 2 } }
  );

  return Response.json({ success: true, updated });
}
