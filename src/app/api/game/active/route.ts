// app/api/game/active/route.ts
import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const conversationId = searchParams.get("conversationId");
  const address = searchParams.get("address")?.toLowerCase();

  if (!address) {
    return Response.json({ error: "Missing address" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();
  const games = db.collection("a-split-game");

  const query: any = {
    chosen: { $ne: null },
    "paid.address": { $ne: address },
  };

  // GROUP roulette
  if (conversationId) {
    query.conversationId = conversationId;
  } 
  // NON-GROUP roulette
  else {
    query.$or = [
      { admin: address },
      { "chosen.address": address },
    ];
  }

  const game = await games.findOne(query, {
    sort: { createdAt: -1 },
    projection: { gameId: 1 },
  });

  if (!game) {
    return Response.json({ gameId: null });
  }

  return Response.json({ gameId: game.gameId });
}
