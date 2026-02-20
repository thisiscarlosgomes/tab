import clientPromise from "@/lib/mongodb";
import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { tokenList } from "@/lib/tokens";

function getTokenAddress(name: string) {
  return tokenList.find((t) => t.name === name)?.address ?? undefined;
}

function getTokenDecimals(name: string) {
  return tokenList.find((t) => t.name === name)?.decimals ?? 18;
}

export async function POST(req: NextRequest) {
  try {
    const urlParts = req.nextUrl.pathname.split("/");
    const dropId = urlParts[urlParts.length - 2];

    const { address, claimToken, fid } = await req.json();

    if (!address || !claimToken || !fid) {
      return Response.json(
        { error: "Missing address, fid or token" },
        { status: 400 }
      );
    }

    const claimTokenHash = createHash("sha256")
      .update(claimToken)
      .digest("hex");

    const client = await clientPromise;
    const db = client.db();
    const collection = db.collection("a-claim-drops");

    // 1. Find drop by ID + tokenHash
    const drop = await collection.findOne({
      dropId,
      claimed: false,
      claimTokenHash,
    });

    if (!drop) {
      return Response.json(
        { error: "Invalid or already claimed" },
        { status: 400 }
      );
    }

    // 2. Enforce one claim per fid per group
    const groupId = drop.groupId;
    if (!groupId) {
      console.warn(`[DROP ${dropId}] missing groupId — skipping fid enforcement`);
    } else {
      const alreadyClaimed = await collection.findOne({
        groupId,
        claimedByFid: fid,
      });

      if (alreadyClaimed) {
        return Response.json(
          { error: "You already claimed from this drop group" },
          { status: 403 }
        );
      }
    }

    // 3. Validate token info
    if (!drop.token || (drop.token !== "ETH" && !getTokenAddress(drop.token))) {
      return Response.json(
        { error: "Missing token address for ERC20" },
        { status: 500 }
      );
    }

    // 4. Send tokens via your send API
    const sendRes = await fetch(`${process.env.PUBLIC_URL}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: address,
        amount: drop.amount,
        type: drop.token === "ETH" ? "eth" : "erc20",
        tokenAddress: getTokenAddress(drop.token),
        decimals: getTokenDecimals(drop.token),
        reason: `claim_drop_${dropId}`,
      }),
    });

    const sendResult = await sendRes.json();

    if (!sendRes.ok || !sendResult.hash) {
      console.error("[DROP CLAIM SEND FAILED]", sendResult);
      return Response.json(
        { error: sendResult.error || "Send failed" },
        { status: 500 }
      );
    }

    // 5. Mark drop as claimed
    await collection.updateOne(
      { dropId, claimTokenHash, claimed: false },
      {
        $set: {
          claimed: true,
          claimedBy: address,
          claimedByFid: fid, // ✅ record the claiming user
          claimedAt: new Date(),
          txHash: sendResult.hash,
          txTo: address,
          txAmount: drop.amount,
          txTimestamp: new Date().toISOString(),
        },
      }
    );

    return Response.json({ success: true, txHash: sendResult.hash });
  } catch (e) {
    console.error("[DROP CLAIM ERROR]", e);
    return Response.json({ error: "Claim failed" }, { status: 500 });
  }
}
