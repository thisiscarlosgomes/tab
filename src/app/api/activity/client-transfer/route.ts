import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

type ClientTransferBody = {
  senderAddress?: string;
  recipientAddress?: string;
  amount?: number | string;
  token?: string;
  txHash?: string;
  note?: string | null;
  recipientUsername?: string | null;
  recipientPfp?: string | null;
  senderUsername?: string | null;
  senderPfp?: string | null;
  recipientResolutionSource?: "address" | "ens" | "tab" | "farcaster" | null;
  timestamp?: string;
};

function normalizeAddress(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(normalized) ? normalized : null;
}

function normalizeTxHash(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^0x[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeAmount(value: unknown) {
  const amount = typeof value === "string" ? Number(value) : Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function normalizeToken(value: unknown) {
  if (typeof value !== "string") return null;
  const token = value.trim().toUpperCase();
  if (!token || token.length > 24) return null;
  return token;
}

function normalizeNote(value: unknown) {
  if (typeof value !== "string") return null;
  const note = value.trim();
  if (!note) return null;
  return note.slice(0, 280);
}

export async function POST(req: NextRequest) {
  let body: ClientTransferBody | null = null;

  try {
    body = (await req.json()) as ClientTransferBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const senderAddress = normalizeAddress(body?.senderAddress);
  const recipientAddress = normalizeAddress(body?.recipientAddress);
  const txHash = normalizeTxHash(body?.txHash);
  const amount = normalizeAmount(body?.amount);
  const token = normalizeToken(body?.token);
  const note = normalizeNote(body?.note);

  if (!senderAddress || !recipientAddress || !txHash || amount === null || !token) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const timestamp =
    typeof body?.timestamp === "string" && !Number.isNaN(new Date(body.timestamp).getTime())
      ? new Date(body.timestamp)
      : new Date();

  const recipientResolutionSource =
    body?.recipientResolutionSource === "address" ||
    body?.recipientResolutionSource === "ens" ||
    body?.recipientResolutionSource === "tab" ||
    body?.recipientResolutionSource === "farcaster"
      ? body.recipientResolutionSource
      : null;

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-activity");

  try {
    await Promise.all([
      collection.updateOne(
        {
          address: senderAddress,
          type: "bill_paid",
          refType: "transfer",
          refId: txHash,
        },
        {
          $setOnInsert: {
            address: senderAddress,
            type: "bill_paid",
            refType: "transfer",
            refId: txHash,
            amount,
            token,
            txHash,
            note: note ?? undefined,
            executionMode: "user_session",
            recipientResolutionSource,
            counterparty: {
              address: recipientAddress,
              name: body?.recipientUsername ?? undefined,
              pfp: body?.recipientPfp ?? undefined,
            },
            timestamp,
            createdAt: new Date(),
          },
        },
        { upsert: true }
      ),
      collection.updateOne(
        {
          address: recipientAddress,
          type: "bill_received",
          refType: "transfer",
          refId: txHash,
        },
        {
          $setOnInsert: {
            address: recipientAddress,
            type: "bill_received",
            refType: "transfer",
            refId: txHash,
            amount,
            token,
            txHash,
            note: note ?? undefined,
            executionMode: "user_session",
            counterparty: {
              address: senderAddress,
              name: body?.senderUsername ?? undefined,
              pfp: body?.senderPfp ?? undefined,
            },
            timestamp,
            createdAt: new Date(),
          },
        },
        { upsert: true }
      ),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[activity/client-transfer] failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
