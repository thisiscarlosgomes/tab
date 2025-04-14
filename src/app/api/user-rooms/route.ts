import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

interface Participant {
  name: string;
  address: string;
  pfp?: string;
  fid?: number;
}

interface Paid {
  address: string;
  name: string;
  txHash: string;
}

interface GameRoom {
  gameId: string;
  participants: Participant[];
  admin: string;
  recipient?: string;
  amount?: number;
  spinToken?: string;
  adminOnlySpin?: boolean;
  chosen?: Participant;
  paid?: Paid[];
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
    .toArray()) as unknown as GameRoom[];

  const formattedRooms = rooms.map((room) => ({
    roomId: room.gameId,
    created: room.createdAt,
    admin: room.admin,
    recipient: room.recipient ?? null,
    amount: room.amount ?? null,
    spinToken: room.spinToken ?? "ETH",
    adminOnlySpin: room.adminOnlySpin ?? false,
    chosen: room.chosen ?? null,
    paid: room.paid ?? [],
    // ✅ Keep all original participant data internally
    members: room.participants.map((p) => ({
      name: p.name,
      address: p.address,
      pfp:
        p.pfp ||
        `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(
          p.name || p.address.slice(0, 6)
        )}`,
      fid: p.fid ?? null,
    })),
    // ✅ For the UI (ProfilePage), we use simplified "members"
  }));

  return Response.json({ rooms: formattedRooms });
}
