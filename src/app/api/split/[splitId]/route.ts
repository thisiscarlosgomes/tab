import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

// Utility to generate a readable short code
function generateCode() {
  const words = ["pizza", "lunch", "bill", "tab", "night", "trip", "meal"];
  const randomWord = words[Math.floor(Math.random() * words.length)];
  const randomSuffix = Math.random().toString(36).substring(2, 6); // e.g. "fq2k"
  return `${randomWord}-${randomSuffix}`;
}

export async function GET(req: NextRequest) {
  const splitId = req.nextUrl.pathname.split("/").pop()?.toLowerCase();
  if (!splitId)
    return Response.json({ error: "Missing splitId" }, { status: 400 });

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-split-bill");

  const bill = await collection.findOne(
    { splitId },
    { collation: { locale: "en", strength: 2 } }
  );
  if (!bill) return Response.json({ error: "Bill not found" }, { status: 404 });

  bill.participants ??= [];
  bill.paid ??= [];

  return Response.json(bill);
}

export async function POST(req: NextRequest) {
  const splitId = req.nextUrl.pathname.split("/").pop()?.toLowerCase();
  if (!splitId)
    return Response.json({ error: "Missing splitId" }, { status: 400 });

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-split-bill");

  const body = await req.json();
  const { creator, description, totalAmount, numPeople } = body;

  if (!creator || !description || !totalAmount || !numPeople) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const existing = await collection.findOne(
    { splitId },
    { collation: { locale: "en", strength: 2 } }
  );
  if (existing)
    return Response.json({ error: "Split already exists" }, { status: 409 });

  // Ensure a unique short code
  let code = generateCode();
  while (await collection.findOne({ code })) {
    code = generateCode();
  }

  const doc = {
    splitId,
    code,
    creator,
    description,
    totalAmount: parseFloat(totalAmount),
    numPeople: parseInt(numPeople, 10),
    participants: [],
    paid: [],
    createdAt: new Date(),
  };

  await collection.insertOne(doc);
  return Response.json(doc);
}

export async function PATCH(req: NextRequest) {
  const splitId = req.nextUrl.pathname.split("/").pop()?.toLowerCase();
  if (!splitId)
    return Response.json({ error: "Missing splitId" }, { status: 400 });

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-split-bill");

  const body = await req.json();
  const { participant, payment } = body;

  const updateOps: {
    $addToSet?: {
      participants?: {
        address: string;
        name: string;
        pfp?: string;
        fid?: string;
      };
      paid?: {
        address: string;
        name: string;
        txHash: string;
        status: string; // Add status here
      };
    };
  } = {};

  if (participant?.address) {
    updateOps.$addToSet = { participants: participant };
  }

  // Ensure the status is set correctly in the 'paid' array
  if (payment?.address) {
    updateOps.$addToSet = {
      ...updateOps.$addToSet,
      paid: {
        address: payment.address,
        name: payment.name,
        txHash: payment.txHash,
        status: payment.status || "paid", // Default to "paid" if no status is provided
      },
    };
  }
  if (!Object.keys(updateOps).length) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  await collection.updateOne({ splitId }, updateOps);

  const updated = await collection.findOne(
    { splitId },
    { collation: { locale: "en", strength: 2 } }
  );
  return Response.json(updated);
}
