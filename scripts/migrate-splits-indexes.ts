import "dotenv/config";
import { MongoClient } from "mongodb";

const run = async () => {
  const mongo = await MongoClient.connect(process.env.MONGODB_URI!);
  const db = mongo.db();
  const collection = db.collection("a-split-bill");

  console.log("📦 Starting index migration for a-split-bill");

  /* =========================
     Unique identifiers
  ========================= */
  await collection.createIndex(
    { splitId: 1 },
    { unique: true, name: "splitId_unique" }
  );

  await collection.createIndex(
    { code: 1 },
    { unique: true, name: "code_unique", sparse: true }
  );

  /* =========================
     Actor lookups
  ========================= */
  await collection.createIndex(
    { "creator.address": 1 },
    { name: "creator_address" }
  );

  await collection.createIndex(
    { "recipient.address": 1 },
    { name: "recipient_address" }
  );

  /* =========================
     Participation
  ========================= */
  await collection.createIndex(
    { "participants.fid": 1 },
    { name: "participants_fid", sparse: true }
  );

  await collection.createIndex(
    { "paid.fid": 1 },
    { name: "paid_fid", sparse: true }
  );

  /* =========================
     Split metadata
  ========================= */
  await collection.createIndex(
    { joinMode: 1 },
    { name: "join_mode" }
  );

  await collection.createIndex(
    { createdAt: -1 },
    { name: "created_at_desc" }
  );

  console.log("✅ Index migration complete");
  process.exit();
};

run();
