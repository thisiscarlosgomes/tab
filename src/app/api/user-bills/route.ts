// /app/api/user-bills/route.ts
import { NextRequest } from "next/server";
import { Collection } from "mongodb";
import clientPromise from "@/lib/mongodb";

interface Participant {
  name: string;
  address: string;
  pfp?: string;
}

interface Payment {
  address: string;
  name?: string;
  txHash: string;
  status?: string;
  token?: string;
}

interface Bill {
  splitId: string;
  code: string;
  description: string;
  creator: { address: string };
  participants: Participant[];
  invited?: Participant[];
  paid?: Payment[];
  totalAmount: number;
  numPeople: number;
  createdAt: Date;
  token: string;
}

const DEFAULT_LIMIT = 50;
let ensureBillsIndexesPromise: Promise<void> | null = null;

function ensureBillsIndexes(collection: Collection<Bill>) {
  if (!ensureBillsIndexesPromise) {
    ensureBillsIndexesPromise = (async () => {
      await collection.createIndexes([
        { key: { "creator.address": 1, createdAt: -1 } },
        { key: { "participants.address": 1, createdAt: -1 } },
        { key: { "invited.address": 1, createdAt: -1 } },
      ]);
    })().catch(() => {
      ensureBillsIndexesPromise = null;
    });
  }
  return ensureBillsIndexesPromise;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawAddress = searchParams.get("address");

  const limit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const before = searchParams.get("before");

  if (!rawAddress) {
    return Response.json({ error: "Missing address" }, { status: 400 });
  }

  const address = rawAddress.toLowerCase();

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<Bill>("a-split-bill");
  await ensureBillsIndexes(collection);

  const query: {
    $or: Array<Record<string, string>>;
    createdAt?: { $lt: Date };
  } = {
    $or: [
      { "creator.address": address },
      { "participants.address": address },
      { "invited.address": address },
    ],
  };

  if (before) {
    query.createdAt = { $lt: new Date(before) };
  }
  const bills = await collection
    .find(query)
    .project({
      splitId: 1,
      code: 1,
      description: 1,
      creator: 1,
      participants: 1,
      invited: 1,
      paid: 1,
      totalAmount: 1,
      numPeople: 1,
      createdAt: 1,
      token: 1,
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  if (!bills.length) {
    return Response.json({ bills: [], nextCursor: null });
  }

  const formattedBills = bills.map((bill) => {
    const addr = address.toLowerCase();

    const isCreator = bill.creator.address.toLowerCase() === addr;

    const isParticipant =
      bill.participants?.some((p: Participant) => p.address?.toLowerCase() === addr) ??
      false;

    const isInvited =
      bill.invited?.some((i: Participant) => i.address?.toLowerCase() === addr) ??
      false;

    const userStatus: "creator" | "participant" | "invited" | null = isCreator
      ? "creator"
      : isParticipant
        ? "participant"
        : isInvited
          ? "invited"
          : null;

    const hasPaid = isCreator
      ? true // creator already paid IRL
      : (bill.paid?.some((p: Payment) => p.address?.toLowerCase() === addr) ??
        false);

    const debtorCount = bill.invited?.length ?? 0;
    const perPersonAmount =
      debtorCount > 0 ? bill.totalAmount / debtorCount : 0;

    const paidCount = bill.paid?.length ?? 0;
    const remaining =
      debtorCount > 0
        ? Math.max(bill.totalAmount - paidCount * perPersonAmount, 0)
        : 0;

        const isSettled = debtorCount > 0 && paidCount >= debtorCount;


    return {
      // identifiers
      splitId: bill.splitId,
      code: bill.code,

      // meta
      description: bill.description,
      token: bill.token || "ETH",
      createdAt: bill.createdAt,
      isSettled,

      // amounts
      totalAmount: bill.totalAmount,
      perPersonAmount,
      remaining,

      // participation
      debtors: debtorCount,
      paidCount: bill.paid?.length ?? 0,

      // role & state
      userStatus,
      hasPaid,

      // people
      creator: bill.creator.address,

      participants: (bill.participants || []).map((p: Participant) => ({
        name: p.name,
        pfp:
          p.pfp ||
          `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(
            p.name
          )}`,
      })),

      invited: (bill.invited || []).map((p: Participant) => ({
        name: p.name,
        pfp:
          p.pfp ||
          `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(
            p.name
          )}`,
      })),

      paid: bill.paid || [],
    };
  });

  return Response.json({
    bills: formattedBills,
    nextCursor:
      bills.length === limit ? bills[bills.length - 1].createdAt : null,
  });
}
