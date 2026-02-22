export const runtime = "nodejs";

import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { encrypt } from "@/lib/encryption";
import { writeActivity } from "@/lib/writeActivity";
import { requireTrustedRequest } from "@/lib/security";

/* =========================
   Helpers
========================= */
function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* =========================
   POST – Create room
========================= */
export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "game-create",
    limit: 80,
    windowMs: 60_000,
  });
  if (denied) return denied;

  console.log("➡️ POST /api/game");

  /* ---------- parse body ---------- */
  let body: any;
  try {
    body = await req.json();
    console.log("✅ req.json:", body);
  } catch (err) {
    console.error("❌ Invalid JSON body", err);
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, player, amount, spinToken } = body;


  if (!player?.address) {
    return Response.json({ error: "Missing player" }, { status: 400 });
  }

  /* ---------- normalize address ---------- */
  const address = player.address.toLowerCase();

  /* ---------- generate gameId ---------- */
  const base = slugify(name || "room");
  const suffix = Math.random().toString(36).slice(2, 6);
  const gameId = `${base}-${suffix}`;

  console.log("🏷 gameId:", gameId);

  /* ---------- encrypt recipient ---------- */
  let encryptedRecipient: string;
  try {
    encryptedRecipient = encrypt(address);
  } catch (err) {
    console.error("❌ encrypt failed", err);
    return Response.json({ error: "Encryption failed" }, { status: 500 });
  }

  /* ---------- connect DB ---------- */
  let client;
  try {
    client = await clientPromise;
  } catch (err) {
    console.error("❌ Mongo connection failed", err);
    return Response.json({ error: "Database connection failed" }, { status: 500 });
  }

  const db = client.db();
  const games = db.collection("a-split-game");

  const createdAt = new Date();

  /* ---------- create game ---------- */
 const game = {
  gameId,
  name: name || "Untitled room",

  admin: address,
  participants: [{ ...player, address }],

  recipient: encryptedRecipient,
  amount: typeof amount === "number" ? amount : 1,
  spinToken: spinToken || "USDC",

  chosen: null,
  adminOnlySpin: true,
  paid: [],

  createdAt,
  expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
};

  console.log("📦 Inserting game:", game);

  try {
    await games.insertOne(game);
    console.log("✅ Game inserted");
  } catch (err) {
    console.error("❌ insertOne failed", err);
    return Response.json({ error: "Failed to create room" }, { status: 500 });
  }

  /* ---------- activity (non-blocking) ---------- */
  void writeActivity({
    address,
    type: "room_created",
    refType: "room",
    refId: gameId,
    timestamp: createdAt,
  }).catch((err) => {
    console.error("⚠️ Activity write failed", err);
  });

  console.log("🎉 Room created:", gameId);

  return Response.json({ gameId });
}
