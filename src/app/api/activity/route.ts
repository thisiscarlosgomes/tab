import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { mapActivity } from "@/lib/mapActivity";
import { fetchMoralisTransferActivity } from "@/lib/moralis";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams
    .get("address")
    ?.toLowerCase();
  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 100);
  const skipExternal = req.nextUrl.searchParams.get("skipExternal") === "1";
  const beforeParam = req.nextUrl.searchParams.get("before");
  const beforeDate =
    beforeParam && !Number.isNaN(new Date(beforeParam).getTime())
      ? new Date(beforeParam)
      : null;

  if (!address) {
    return NextResponse.json(
      { error: "Missing address" },
      { status: 400 }
    );
  }

  try {
    const client = await clientPromise;
    const db = client.db();

    const [rawActivity, rawAgentTransfers] = await Promise.all([
      db
        .collection("a-activity")
        .find(beforeDate ? { address, timestamp: { $lt: beforeDate } } : { address })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray(),
      db
        .collection("a-agent-transfer")
        .find({
          status: "success",
          $or: [{ sourceWalletAddress: address }, { recipientAddress: address }],
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray(),
    ]);

    const syntheticFromAgentTransfers = rawAgentTransfers
      .map((doc) => {
        const isSender = String(doc.sourceWalletAddress ?? "").toLowerCase() === address;
        return {
          address,
          type: isSender ? "bill_paid" : "bill_received",
          refType: "transfer",
          refId: String(doc.requestId ?? doc.txHash ?? doc._id ?? ""),
          amount: doc.amount,
          token: doc.token,
          txHash: doc.txHash,
          executionMode: doc.executionMode ?? null,
          agentId: doc.agentId ?? null,
          recipientResolutionSource: doc.recipientResolutionSource ?? null,
          note: typeof doc.note === "string" ? doc.note : null,
          counterparty: isSender
            ? {
                address: doc.recipientAddress,
                name: doc.recipientUsername ?? undefined,
              }
            : {
                address: doc.sourceWalletAddress,
              },
          timestamp: doc.createdAt ?? doc.updatedAt ?? new Date(),
        };
      })
      .filter((doc) => {
        if (!beforeDate) return true;
        const ts = new Date(doc.timestamp ?? 0);
        return !Number.isNaN(ts.getTime()) && ts < beforeDate;
      });

    const knownTxHashes = new Set(
      [...rawActivity, ...syntheticFromAgentTransfers]
        .map((doc) => String(doc.txHash ?? "").toLowerCase().trim())
        .filter(Boolean)
    );

    const shouldFetchMoralis =
      !skipExternal &&
      (beforeDate !== null || rawActivity.length + syntheticFromAgentTransfers.length < limit);

    const syntheticFromMoralis = shouldFetchMoralis
      ? (await fetchMoralisTransferActivity(address, {
          limit: Math.min(limit, 30),
          direction: "all",
        }))
          .filter((doc) => {
            if (!beforeDate) return true;
            const ts = new Date(doc.timestamp ?? 0);
            return !Number.isNaN(ts.getTime()) && ts < beforeDate;
          })
          .filter((doc) => {
            const txHash = String(doc.txHash ?? "").toLowerCase().trim();
            return txHash ? !knownTxHashes.has(txHash) : true;
          })
      : [];

    const raw = [...rawActivity, ...syntheticFromAgentTransfers, ...syntheticFromMoralis];
    raw.sort(
      (a, b) =>
        new Date(b.timestamp ?? b.createdAt ?? 0).getTime() -
        new Date(a.timestamp ?? a.createdAt ?? 0).getTime()
    );

    const activity: Array<
      { timestamp?: string | Date; note?: string | null } & Record<string, unknown>
    > = [];
    const seenIndexByKey = new Map<string, number>();

    for (const doc of raw) {
      try {
        const key = `${String(doc.type ?? "")}:${String(doc.refId ?? "")}`;
        const mapped = mapActivity(doc);
        if (!mapped) continue;

        const existingIndex = seenIndexByKey.get(key);
        if (existingIndex !== undefined) {
          const existing = activity[existingIndex] as { note?: string | null } | undefined;
          if ((!existing?.note || !String(existing.note).trim()) && "note" in mapped) {
            const candidateNote =
              typeof (mapped as { note?: unknown }).note === "string"
                ? (mapped as { note?: string }).note?.trim()
                : "";
            if (candidateNote) {
              activity[existingIndex] = mapped as unknown as (typeof activity)[number];
            }
          }
          continue;
        }

        seenIndexByKey.set(key, activity.length);
        activity.push(mapped as unknown as (typeof activity)[number]);
        if (activity.length >= limit) break;
      } catch (err) {
        console.error("[mapActivity failed]", {
          doc,
          err,
        });
      }
    }

    let nextCursor: string | null = null;
    if (activity.length === limit) {
      const lastTs = new Date(activity[activity.length - 1]?.timestamp ?? "");
      if (!Number.isNaN(lastTs.getTime())) {
        nextCursor = lastTs.toISOString();
      }
    }

    return NextResponse.json({ activity, nextCursor });
  } catch (err) {
    console.error("[activity api fatal]", err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
