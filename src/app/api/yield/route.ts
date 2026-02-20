// /api/yield/route.ts
import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, amount, fid } = body;

    if (!address || !fid || isNaN(Number(amount)) || Number(amount) <= 0) {
      return Response.json(
        { error: "Missing or invalid address, fid, or amount" },
        { status: 400 }
      );
    }

    const lowerAddress = address.toLowerCase();
    const numericAmount = Number(amount);

    const client = await clientPromise;
    const db = client.db();

    const timestamp = new Date();

    /* ------------------------------------------------------
     * LEDGER: Earn deposits
     * ----------------------------------------------------*/
    await db.collection("a-earn-deposit").insertOne({
      fid,
      address: lowerAddress,
      amount: numericAmount,
      timestamp,
    });

    /* ------------------------------------------------------
     * ACTIVITY FEED
     * ----------------------------------------------------*/
    await db.collection("a-activity").insertOne({
      address: lowerAddress,
      type: "earn_deposit",
      amount: numericAmount,
      timestamp,
    });

    return Response.json({
      success: true,
    });
  } catch (err) {
    console.error("[yield api error]", err);
    return Response.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
