// app/api/user-bills/route.ts
import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

interface Participant {
  name: string;
  address: string;
  pfp?: string;
}

interface Payment {
  address: string;
  name: string;
  txHash: string;
  status: string;
  token?: string;
}

interface Bill {
  splitId: string;
  code: string;
  description: string;
  creator: { address: string };
  participants: Participant[];
  paid?: Payment[];
  totalAmount: number;
  numPeople: number;
  createdAt: Date;
  token: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address")?.toLowerCase();

  if (!address) {
    return new Response(JSON.stringify({ error: "Missing address" }), {
      status: 400,
    });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-split-bill");

  const bills = (await collection
    .find({
      $or: [
        { "creator.address": address },
        { "participants.address": address },
      ],
    })
    .collation({ locale: "en", strength: 2 })
    .project({
      splitId: 1,
      code: 1,
      description: 1,
      creator: 1,
      participants: 1,
      paid: 1,
      totalAmount: 1,
      numPeople: 1,
      createdAt: 1,
      token: 1, // ✅ add this
    })

    .sort({ createdAt: -1 })
    .toArray()) as Bill[];

  const formattedBills = bills.map((bill) => ({
    splitId: bill.splitId,
    code: bill.code,
    description: bill.description,
    amount: bill.totalAmount,
    people: bill.numPeople,
    createdAt: bill.createdAt,
    token: bill.token || "ETH", // ✅ fallback to ETH if missing
    participants: (bill.participants || []).map((p) => ({
      name: p.name,
      pfp: p.pfp || `https://api.dicebear.com/9.x/glass/svg?seed=${p.name}`,
    })),
    creator: bill.creator.address,
    paid: bill.paid || [],
  }));

  return Response.json({ bills: formattedBills });
}
