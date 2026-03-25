import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import viemClient from "@/lib/viem-client";

export const dynamic = "force-dynamic";

function normalizeTxHash(value: string) {
  const txHash = value.trim().toLowerCase();
  return /^0x[a-f0-9]{64}$/.test(txHash) ? txHash : null;
}

function normalizeAddress(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(normalized) ? normalized : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ txHash: string }> }
) {
  const { txHash: rawTxHash } = await params;
  const txHash = normalizeTxHash(rawTxHash);

  if (!txHash) {
    return NextResponse.json({ error: "Invalid tx hash" }, { status: 400 });
  }

  try {
    const client = await clientPromise;
    const db = client.db();

    const [agentTransfer, activityRows] = await Promise.all([
      db.collection("a-agent-transfer").findOne({
        txHash,
        status: "success",
      }),
      db
        .collection("a-activity")
        .find({
          $or: [{ txHash }, { refType: "transfer", refId: txHash }],
          type: {
            $in: [
              "bill_paid",
              "bill_received",
              "room_paid",
              "room_received",
              "jackpot_deposit",
            ],
          },
        })
        .sort({ timestamp: -1, createdAt: -1 })
        .limit(10)
        .toArray(),
    ]);

    const paidRow =
      activityRows.find((r) => r.type === "bill_paid") ??
      activityRows.find((r) => r.type === "room_paid") ??
      null;
    const receivedRow =
      activityRows.find((r) => r.type === "bill_received") ??
      activityRows.find((r) => r.type === "room_received") ??
      null;
    const jackpotRow = activityRows.find((r) => r.type === "jackpot_deposit") ?? null;

    let fromAddress =
      normalizeAddress(agentTransfer?.sourceWalletAddress) ??
      normalizeAddress(paidRow?.address) ??
      normalizeAddress(jackpotRow?.address) ??
      normalizeAddress(receivedRow?.counterparty?.address) ??
      null;

    let toAddress =
      normalizeAddress(agentTransfer?.recipientAddress) ??
      normalizeAddress(paidRow?.counterparty?.address) ??
      normalizeAddress(paidRow?.recipient) ??
      normalizeAddress(receivedRow?.address) ??
      null;

    const amountRaw =
      agentTransfer?.amount ??
      paidRow?.amount ??
      receivedRow?.amount ??
      jackpotRow?.amount ??
      null;
    const amount =
      typeof amountRaw === "number"
        ? amountRaw
        : Number.isFinite(Number(amountRaw))
          ? Number(amountRaw)
          : null;

    const token =
      typeof agentTransfer?.token === "string"
        ? agentTransfer.token
        : typeof paidRow?.token === "string"
          ? paidRow.token
          : typeof receivedRow?.token === "string"
            ? receivedRow.token
            : typeof jackpotRow?.token === "string"
              ? jackpotRow.token
            : null;

    const noteCandidate =
      agentTransfer?.note ??
      paidRow?.note ??
      receivedRow?.note ??
      jackpotRow?.note ??
      null;
    const note =
      typeof noteCandidate === "string" && noteCandidate.trim()
        ? noteCandidate.trim()
        : null;

    const timestampCandidate =
      agentTransfer?.createdAt ??
      paidRow?.timestamp ??
      receivedRow?.timestamp ??
      jackpotRow?.timestamp ??
      null;
    const timestamp =
      timestampCandidate && !Number.isNaN(new Date(timestampCandidate).getTime())
        ? new Date(timestampCandidate).toISOString()
        : null;

    const recipientUsername =
      (typeof agentTransfer?.recipientUsername === "string" &&
        agentTransfer.recipientUsername) ||
      (typeof paidRow?.recipientUsername === "string" && paidRow.recipientUsername) ||
      (typeof paidRow?.counterparty?.name === "string" && paidRow.counterparty.name) ||
      null;
    const senderUsername =
      (typeof receivedRow?.counterparty?.name === "string" &&
        receivedRow.counterparty.name) ||
      null;
    const activityType =
      (typeof jackpotRow?.type === "string" && jackpotRow.type) ||
      (typeof paidRow?.type === "string" && paidRow.type) ||
      (typeof receivedRow?.type === "string" && receivedRow.type) ||
      (agentTransfer ? "bill_paid" : null);
    const ticketCount =
      typeof jackpotRow?.ticketCount === "number" && Number.isFinite(jackpotRow.ticketCount)
        ? jackpotRow.ticketCount
        : Number.isFinite(Number(jackpotRow?.ticketCount))
          ? Number(jackpotRow?.ticketCount)
          : null;

    if (!fromAddress || !toAddress || !timestamp) {
      try {
        const chainTx = await viemClient.getTransaction({
          hash: txHash as `0x${string}`,
        });
        if (!fromAddress) fromAddress = normalizeAddress(chainTx.from);
        if (!toAddress && chainTx.to) toAddress = normalizeAddress(chainTx.to);
      } catch {
        // Ignore chain lookup failures and return best-effort details.
      }
    }

    if (!fromAddress && !toAddress && amount === null && !token) {
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }

    return NextResponse.json({
      tx: {
        txHash,
        amount,
        token,
        fromAddress,
        toAddress,
        note,
        timestamp,
        recipientUsername,
        senderUsername,
        activityType,
        ticketCount,
      },
    });
  } catch (err) {
    console.error("[activity/tx] failed", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
