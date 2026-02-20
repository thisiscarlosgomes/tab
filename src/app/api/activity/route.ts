import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { mapActivity } from "@/lib/mapActivity";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams
    .get("address")
    ?.toLowerCase();

  if (!address) {
    return NextResponse.json(
      { error: "Missing address" },
      { status: 400 }
    );
  }

  try {
    const client = await clientPromise;
    const db = client.db();

    const raw = await db
      .collection("a-activity")
      .find({ address })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();

    const activity = [];

    for (const doc of raw) {
      try {
        const mapped = mapActivity(doc);
        if (mapped) activity.push(mapped);
      } catch (err) {
        console.error("[mapActivity failed]", {
          doc,
          err,
        });
      }
    }

    return NextResponse.json({ activity });
  } catch (err) {
    console.error("[activity api fatal]", err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
