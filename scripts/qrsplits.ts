import "dotenv/config";
import { MongoClient } from "mongodb";

const run = async () => {
  const mongo = await MongoClient.connect(process.env.MONGODB_URI!);
  const db = mongo.db();
  const collection = db.collection("a-split-bill");

  const cursor = collection.find({});
  let updatedCount = 0;

  for await (const bill of cursor) {
    const update: any = {};

    /* =========================
       joinMode
    ========================= */
    if (!bill.joinMode) {
      update.joinMode = "invite"; // default for all existing splits
    }

    /* =========================
       Normalize arrays
    ========================= */
    if (!Array.isArray(bill.participants)) {
      update.participants = [];
    }

    if (!Array.isArray(bill.paid)) {
      update.paid = [];
    }

    if (!Array.isArray(bill.invited)) {
      update.invited = [];
    }

    /* =========================
       Remove deprecated fields
    ========================= */
    if (bill.invitedOnly !== undefined) {
      update.$unset = {
        ...(update.$unset ?? {}),
        invitedOnly: "",
      };
    }

    if (Object.keys(update).length === 0) continue;

    await collection.updateOne(
      { _id: bill._id },
      {
        ...(update.$unset ? { $unset: update.$unset } : {}),
        $set: {
          joinMode: update.joinMode ?? bill.joinMode,
          participants: update.participants ?? bill.participants,
          paid: update.paid ?? bill.paid,
          invited: update.invited ?? bill.invited,
        },
      }
    );

    updatedCount++;
  }

  console.log(`✅ Migration complete`);
  console.log(`🔁 Updated ${updatedCount} split documents`);

  process.exit();
};

run();
