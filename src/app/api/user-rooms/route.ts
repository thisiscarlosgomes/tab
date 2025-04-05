import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

interface Participant {
  name: string;
  address: string;
  pfp?: string; // ✅ add this
}

interface GameRoom {
  gameId: string;
  participants: Participant[];
  admin: string;
  createdAt: Date;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");

  if (!address) {
    return new Response(JSON.stringify({ error: "Missing address" }), {
      status: 400,
    });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-split-game");

  const rooms = (await collection
    .find({ "participants.address": address })
    .project({ gameId: 1, participants: 1, admin: 1, createdAt: 1 }) // 👈 include admin
    .toArray()) as GameRoom[];

  const formattedRooms = rooms.map((room) => ({
    roomId: room.gameId,
    created: room.createdAt,
    members: room.participants.map((p) => ({
      name: p.name,
      pfp: p.pfp || `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${p.name}`,
    })),
    admin: room.admin, // 👈 pass through admin
  }));

  return Response.json({ rooms: formattedRooms });
}
