// app/api/split/by-code/[code]/route.ts
import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.pathname.split("/").pop()?.toLowerCase();
  if (!code) {
    return Response.json({ error: "Missing code" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-split-bill");

  const bill = await collection.findOne({ code });

  if (!bill) {
    return Response.json({ error: "Bill not found" }, { status: 404 });
  }

  return Response.json({ splitId: bill.splitId });
}
