import clientPromise from "@/lib/mongodb";
import { NextRequest } from "next/server";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await context.params;

  if (!groupId) {
    return Response.json({ error: "Missing groupId" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-claim-drops");

  const drops = await collection
    .find(
      { groupId: groupId.toLowerCase() },
      {
        projection: {
          dropId: 1,
          token: 1,
          amount: 1,
          claimed: 1,
          claimedBy: 1,
          claimedByFid: 1,
          creator: 1,
          createdAt: 1,
          txHash:1,
        },
      }
    )
    .sort({ createdAt: 1 })
    .toArray();

  return Response.json({ drops });
}
