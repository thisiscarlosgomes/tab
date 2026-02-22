import { NextRequest } from "next/server";
import { Collection } from "mongodb";
import clientPromise from "@/lib/mongodb";

/* =========================
   Types
========================= */
interface Participant {
  name?: string;
  address: string;
  pfp?: string;
  fid?: number;
}

interface Paid {
  address: string;
  name?: string;
  txHash: string;
  timestamp: Date;
}

interface GameRoom {
  gameId: string;
  name?: string;
  participants: Participant[];
  admin: string;
  recipient?: string | null;
  amount?: number;
  spinToken?: string;
  adminOnlySpin?: boolean;
  chosen?: Participant | null;
  paid?: Paid[];
  createdAt: Date;
}

const DEFAULT_LIMIT = 50;
let ensureRoomIndexesPromise: Promise<void> | null = null;

function ensureRoomIndexes(collection: Collection<GameRoom>) {
  if (!ensureRoomIndexesPromise) {
    ensureRoomIndexesPromise = (async () => {
      await collection.createIndexes([
        { key: { "participants.address": 1, createdAt: -1 } },
        { key: { admin: 1, createdAt: -1 } },
      ]);
    })().catch(() => {
      ensureRoomIndexesPromise = null;
    });
  }
  return ensureRoomIndexesPromise;
}

/* =========================
   GET user rooms
========================= */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const address = searchParams.get("address")?.toLowerCase();
  const limit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const before = searchParams.get("before");

  if (!address) {
    return Response.json({ error: "Missing address" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();
  const roomsCol = db.collection<GameRoom>("a-split-game");
  await ensureRoomIndexes(roomsCol);

  const query: {
    $or: Array<Record<string, string>>;
    createdAt?: { $lt: Date };
  } = {
    $or: [{ "participants.address": address }, { admin: address }],
  };

  if (before) {
    query.createdAt = { $lt: new Date(before) };
  }

  const rooms = await roomsCol
    .find(query)
    .project({
      gameId: 1,
      name: 1,
      participants: 1,
      admin: 1,
      recipient: 1,
      amount: 1,
      spinToken: 1,
      adminOnlySpin: 1,
      chosen: 1,
      paid: 1,
      createdAt: 1,
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  if (!rooms.length) {
    return Response.json({ rooms: [], nextCursor: null });
  }

  const formattedRooms = rooms.map((room) => ({
    gameId: room.gameId,
    name: room.name ?? null,
    createdAt: room.createdAt,

    admin: room.admin,
    recipient: room.recipient ?? null,

    amount: room.amount ?? null,
    spinToken: room.spinToken ?? "ETH",
    adminOnlySpin: room.adminOnlySpin ?? false,

    chosen: room.chosen ?? null,
    paid: room.paid ?? [],

    members: room.participants.map((p: Participant) => ({
      address: p.address,
      name: p.name ?? null,
      fid: p.fid ?? null,
      pfp:
        p.pfp ??
        `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(
          p.name || p.address.slice(0, 6)
        )}`,
    })),
  }));

  return Response.json({
    rooms: formattedRooms,
    nextCursor:
      rooms.length === limit ? rooms[rooms.length - 1].createdAt : null,
  });
}
