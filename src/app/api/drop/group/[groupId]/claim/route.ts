// /api/drop/group/[groupId]/claim
import clientPromise from "@/lib/mongodb";
import { NextRequest } from "next/server";
import { getAddress } from "viem";
import { tokenList } from "@/lib/tokens";

function getTokenAddress(name: string) {
  return tokenList.find((t) => t.name === name)?.address ?? undefined;
}

function getTokenDecimals(name: string) {
  return tokenList.find((t) => t.name === name)?.decimals ?? 18;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const groupId = params.groupId?.toLowerCase();
    const { address, fid } = await req.json();

    if (!groupId || !address) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const normalizedAddress = getAddress(address);
    const client = await clientPromise;
    const db = client.db();
    const collection = db.collection("a-claim-drops");

    const existingClaimFilters: Record<string, unknown>[] = [
      { claimedBy: normalizedAddress },
    ];
    if (typeof fid === "number" && Number.isFinite(fid) && fid > 0) {
      existingClaimFilters.push({ claimedByFid: fid });
    }

    const existingClaim = await collection.findOne({
      groupId,
      $or: existingClaimFilters,
    });

    if (existingClaim) {
      return Response.json(
        { error: "You’ve already claimed a drop in this group." },
        { status: 403 }
      );
    }

    // ✅ Find an unclaimed drop in the group
    const drop = await collection.findOne({
      groupId,
      claimed: false,
    });

    if (!drop) {
      return Response.json({ error: "No available drops" }, { status: 404 });
    }

    // ✅ Send tokens to user
    const tokenAddress =
      drop.token === "ETH" ? undefined : getTokenAddress(drop.token);
    const decimals = getTokenDecimals(drop.token);

    const sendRes = await fetch(`${process.env.PUBLIC_URL}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: normalizedAddress,
        amount: drop.amount,
        type: drop.token === "ETH" ? "eth" : "erc20",
        tokenAddress,
        decimals,
        reason: `group_claim_${groupId}`,
      }),
    });

    const sendResult = await sendRes.json();

    if (!sendRes.ok || !sendResult.hash) {
      console.error("[GROUP CLAIM SEND FAILED]", sendResult);
      return Response.json(
        { error: sendResult.error || "Send failed" },
        { status: 500 }
      );
    }

    // ✅ Mark as claimed and store tx info
    await collection.updateOne(
      { _id: drop._id },
      {
        $set: {
          claimed: true,
          claimedBy: normalizedAddress,
          claimedAt: new Date(),
          txHash: sendResult.hash,
          txTo: normalizedAddress,
          txAmount: drop.amount,
          txTimestamp: new Date().toISOString(),
          ...(typeof fid === "number" && Number.isFinite(fid) && fid > 0
            ? { claimedByFid: fid }
            : {}),
        },
      }
    );

    return Response.json({
      success: true,
      dropId: drop.dropId,
      txHash: sendResult.hash,
    });
  } catch (e) {
    console.error("[GROUP CLAIM ERROR]", e);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
