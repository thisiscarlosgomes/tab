import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { decrypt } from "@/lib/encryption";
import { isAddress } from "viem";

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
  token: string;
}

interface GameRoom {
  gameId: string;
  participants: Participant[];
  admin: string;
  recipient?: string;
  recentPayment?: {
    txHash: string;
    from: string;
    timestamp: Date;
  };
  createdAt: Date;
  amount?: number;
  paid?: Payment[];
  spinToken?: string; // ✅ Add this line
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
  const billActivities: {
    type:
      | "created"
      | "joined"
      | "paid"
      | "received"
      | "room_created"
      | "room_joined"
      | "room_paid"
      | "room_received";
    description: string;
    splitId?: string;
    roomId?: string;
    counterparty?: string;
    amount?: number;
    txHash?: string;
    timestamp: Date;
    token?: string;
    pfp?: string;
    recipient?: string; // ✅ add this
    recipientUsername?: string; // ✅ add this
  }[] = [];

  for (const bill of bills) {
    const amountPerPerson =
      bill.totalAmount && bill.numPeople
        ? bill.totalAmount / bill.numPeople
        : 0;

    // Created
    if (bill.creator.address.toLowerCase() === address) {
      billActivities.push({
        type: "created",
        description: bill.description,
        splitId: bill.splitId,
        timestamp: bill.createdAt,
      });
    }

    // Joined
    // Only show joined if user is the creator
    const joined = bill.participants?.some(
      (p) => p.address.toLowerCase() === address
    );
    if (joined && bill.creator.address.toLowerCase() === address) {
      for (const p of bill.participants ?? []) {
        if (p.address.toLowerCase() !== address) {
          let pfp: string | undefined = undefined;
          try {
            const res = await fetch(
              `${process.env.PUBLIC_URL}/api/neynar/user/by-address/${p.address}`
            );
            const data = await res.json();
            pfp = data?.pfp_url;
          } catch {}

          billActivities.push({
            type: "joined",
            description: bill.description,
            splitId: bill.splitId,
            timestamp: bill.createdAt,
            counterparty: p.name ?? p.address,
            pfp,
          });
        }
      }
    }

    for (const p of bill.paid ?? []) {
      if (p.address.toLowerCase() === address) {
        let pfp: string | undefined = undefined;
        let recipientUsername: string | undefined = undefined;

        try {
          const res = await fetch(
            `${process.env.PUBLIC_URL}/api/neynar/user/by-address/${bill.creator.address}`
          );
          const data = await res.json();
          pfp = data?.pfp_url;
          recipientUsername = data?.username;
        } catch {}

        billActivities.push({
          type: "paid",
          description: bill.description,
          splitId: bill.splitId,
          counterparty: bill.creator.name,
          amount: amountPerPerson,
          token: bill.token ?? "ETH",
          txHash: p.txHash,
          timestamp: p.timestamp ?? bill.createdAt,
          pfp,
          recipient: bill.creator.address,
          recipientUsername, // ✅ this line is key
        });
      }

      if (
        bill.creator.address.toLowerCase() === address &&
        p.address.toLowerCase() !== address
      ) {
        // You received a payment from someone
        let pfp: string | undefined = undefined;
        try {
          const res = await fetch(
            `${process.env.PUBLIC_URL}/api/neynar/user/by-address/${p.address}`
          );
          const data = await res.json();
          pfp = data?.pfp_url;
        } catch {}

        billActivities.push({
          type: "received",
          description: bill.description,
          splitId: bill.splitId,
          counterparty: p.name ?? p.address,
          amount: amountPerPerson,
          token: bill.token ?? "ETH",
          txHash: p.txHash,
          timestamp: p.timestamp ?? bill.createdAt,
          pfp,
        });
      }
    }
  }

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
      spinToken: 1,
      recipient: 1,
    })

    .collation({ locale: "en", strength: 2 }) // optional: to make address match case-insensitive
    .toArray();

  const roomActivitiesNested = await Promise.all(
    rooms.map(async (room) => {
      const entries: {
        type:
          | "created"
          | "joined"
          | "paid"
          | "room_created"
          | "room_joined"
          | "room_paid"
          | "room_received";
        description: string;
        splitId?: string;
        roomId?: string;
        counterparty?: string;
        recipient?: string;
        recipientUsername?: string;
        amount?: number;
        txHash?: string;
        timestamp: Date;
        token?: string;
        pfp?: string;
      }[] = [];

      const isAdmin = room.admin?.toLowerCase() === address;

      if (isAdmin) {
        entries.push({
          type: "room_created",
          description: `Table #${room.gameId}`,
          roomId: room.gameId,
          timestamp: room.createdAt ?? new Date(),
        });

        for (const p of room.participants ?? []) {
          if (p.address.toLowerCase() !== address) {
            let pfp: string | undefined = undefined;
            try {
              const res = await fetch(
                `${process.env.PUBLIC_URL}/api/neynar/user/by-address/${p.address}`
              );
              const data = await res.json();
              pfp = data?.pfp_url;
            } catch {}

            entries.push({
              type: "room_joined",
              description: `Table #${room.gameId}`,
              roomId: room.gameId,
              timestamp: room.createdAt ?? new Date(),
              counterparty: p.name ?? p.address,
              pfp, // ✅ Add pfp here
            });
          }
        }
      }

      // 🔐 Decrypt
      let decryptedRecipient = room.recipient;
      if (decryptedRecipient) {
        try {
          const maybe = decrypt(decryptedRecipient);
          decryptedRecipient = isAddress(maybe) ? maybe : "Invalid address";
        } catch {
          decryptedRecipient = "Invalid encrypted address";
        }
      }

      // 🟣 Try Neynar for Farcaster username + pfp
      let recipientUsername: string | null = null;
      let recipientPfp: string | undefined = undefined;

      if (isAddress(decryptedRecipient)) {
        try {
          const res = await fetch(
            `${process.env.PUBLIC_URL}/api/neynar/user/by-address/${decryptedRecipient}`
          );
          const data = await res.json();
          if (data?.username) {
            recipientUsername = data.username;
          }
          if (data?.pfp_url) {
            recipientPfp = data.pfp_url;
          }
        } catch (e) {
          console.error("Failed to fetch Farcaster username:", e);
        }
      }

      // ✅ Add payment activities
      // ✅ Add payment activities
      room.paid?.forEach((p: Payment) => {
        if (p.address.toLowerCase() === address) {
          entries.push({
            type: "room_paid",
            description: `Room #${room.gameId}`,
            roomId: room.gameId,
            txHash: p.txHash,
            amount: room.amount,
            token: room.spinToken ?? "ETH",
            recipient: decryptedRecipient,
            recipientUsername: recipientUsername ?? undefined,
            timestamp: p.timestamp ?? room.createdAt ?? new Date(),
            pfp: recipientPfp ?? undefined,
          });
        }
      });

      if (decryptedRecipient?.toLowerCase() === address) {
        room.paid?.forEach((p: Payment) => {
          // only add if the payer is NOT the recipient (avoid duplicate log)
          if (p.address.toLowerCase() !== address) {
            entries.push({
              type: "room_received",
              description: `Room #${room.gameId}`,
              roomId: room.gameId,
              txHash: p.txHash,
              amount: room.amount,
              token: room.spinToken ?? "ETH",
              recipient: decryptedRecipient,
              recipientUsername: recipientUsername ?? undefined,
              counterparty: p.name ?? p.address,
              timestamp: p.timestamp ?? room.createdAt ?? new Date(),
              pfp: recipientPfp ?? undefined,
            });
          }
        });
      }

      return entries;
    })
  );

  // Flatten nested arrays after Promise.all
  const roomActivities = roomActivitiesNested.flat(); // ✅ flatten

  const all = [...billActivities, ...roomActivities];

  const sorted = all.sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
  );

  const summary = {
    billsCreated: billActivities.filter((a) => a.type === "created").length,
    billsJoined: billActivities.filter((a) => a.type === "joined").length,
    billsPaid: billActivities.filter((a) => a.type === "paid").length,
    billsReceived: billActivities.filter((a) => a.type === "received").length, // ✅
    roomsCreated: roomActivities.filter((a) => a.type === "room_created")
      .length,
    roomsJoined: roomActivities.filter((a) => a.type === "room_joined").length,
    roomsPaid: roomActivities.filter((a) => a.type === "room_paid").length,
    roomsReceived: roomActivities.filter((a) => a.type === "room_received")
      .length,
  };

  return Response.json({ activity: sorted, summary });
}
