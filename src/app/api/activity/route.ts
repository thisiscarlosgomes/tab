import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

interface Participant {
  address: string;
  name: string;
  pfp?: string;
  fid?: string;
}

interface Payment {
  address: string;
  name: string;
  txHash: string;
  status?: string;
  timestamp?: Date;
}

interface Bill {
  splitId: string;
  description: string;
  creator: {
    address: string;
    name: string;
  };
  participants?: Participant[];
  paid?: Payment[];
  totalAmount: number;
  numPeople: number;
  createdAt: Date;
}

interface GameRoom {
  gameId: string;
  participants: Participant[];
  admin: string;
  recentPayment?: {
    txHash: string;
    from: string;
    timestamp: Date;
  };
  createdAt: Date;
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.toLowerCase();
  if (!address) {
    return Response.json({ error: "Missing address" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();

  // ---- Fetch Bill Activities ----
  const billCollection = db.collection<Bill>("a-split-bill");
  const bills = await billCollection
    .find({
      $or: [
        { "creator.address": address },
        { "participants.address": address },
        { "paid.address": address },
      ],
    })
    .collation({ locale: "en", strength: 2 })
    .toArray();

  const billActivities = bills.flatMap((bill) => {
    const amountPerPerson =
      bill.totalAmount && bill.numPeople
        ? bill.totalAmount / bill.numPeople
        : 0;

    const entries: {
      type:
        | "created"
        | "joined"
        | "paid"
        | "room_created"
        | "room_joined"
        | "room_paid";
      description: string;
      splitId?: string;
      roomId?: string;
      counterparty?: string;
      amount?: number;
      txHash?: string;
      timestamp: Date;
    }[] = [];

    if (bill.creator.address.toLowerCase() === address) {
      entries.push({
        type: "created",
        description: bill.description,
        splitId: bill.splitId,
        timestamp: bill.createdAt,
      });
    }

    const joined = bill.participants?.some(
      (p) => p.address.toLowerCase() === address
    );
    if (joined && bill.creator.address.toLowerCase() !== address) {
      entries.push({
        type: "joined",
        description: bill.description,
        splitId: bill.splitId,
        timestamp: bill.createdAt,
      });
    }

    bill.paid?.forEach((p) => {
      if (p.address.toLowerCase() === address) {
        entries.push({
          type: "paid",
          description: bill.description,
          splitId: bill.splitId,
          counterparty: bill.creator.name,
          amount: amountPerPerson,
          txHash: p.txHash,
          timestamp: p.timestamp ?? bill.createdAt,
        });
      }
    });

    return entries;
  });

  // ---- Fetch Room Activities ----
  const roomCollection = db.collection<GameRoom>("a-split-game");
  const rooms = await roomCollection
    .find({
      $or: [
        { "participants.address": address },
        { admin: address }, // ✅ add this
      ],
    })
    .project({
      gameId: 1,
      participants: 1,
      admin: 1,
      recentPayment: 1,
      createdAt: 1,
      paid: 1,
      amount: 1,
    })

    .collation({ locale: "en", strength: 2 }) // optional: to make address match case-insensitive
    .toArray();

  const roomActivities = rooms.flatMap((room) => {
    const entries: {
      type:
        | "created"
        | "joined"
        | "paid"
        | "room_created"
        | "room_joined"
        | "room_paid";
      description: string;
      splitId?: string;
      roomId?: string;
      counterparty?: string;
      amount?: number;
      txHash?: string;
      timestamp: Date;
    }[] = [];

    const isAdmin = room.admin?.toLowerCase() === address;

    if (isAdmin) {
      entries.push({
        type: "room_created",
        description: `Table #${room.gameId}`,
        roomId: room.gameId,
        timestamp: room.createdAt ?? new Date(),
      });
    } else {
      entries.push({
        type: "room_joined",
        description: `Table #${room.gameId}`,
        roomId: room.gameId,
        timestamp: room.createdAt ?? new Date(),
      });
    }

    // ✅ Iterate over paid[] for payment records
    room.paid?.forEach(
      (p: {
        address: string;
        name: string;
        txHash: string;
        timestamp?: Date;
      }) => {
        if (p.address.toLowerCase() === address) {
          entries.push({
            type: "room_paid",
            description: `Rooms #${room.gameId}`,
            roomId: room.gameId,
            txHash: p.txHash,
            amount: room.amount, // ✅ Add this line
            timestamp: p.timestamp ?? room.createdAt ?? new Date(),
          });
        }
      }
    );

    return entries;
  });

  const all = [...billActivities, ...roomActivities];
  const sorted = all.sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
  );

  const summary = {
    billsCreated: billActivities.filter((a) => a.type === "created").length,
    billsJoined: billActivities.filter((a) => a.type === "joined").length,
    billsPaid: billActivities.filter((a) => a.type === "paid").length,
    roomsCreated: roomActivities.filter((a) => a.type === "room_created").length,
    roomsJoined: roomActivities.filter((a) => a.type === "room_joined").length,
    roomsPaid: roomActivities.filter((a) => a.type === "room_paid").length,
  };
  

  return Response.json({ activity: sorted, summary });
}
