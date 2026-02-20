import "dotenv/config";
import { MongoClient } from "mongodb";

const run = async () => {
  const mongo = await MongoClient.connect(process.env.MONGODB_URI!);
  const db = mongo.db();
  const collection = db.collection("a-claim-drops");

  const brokenDocs = await collection
    .find({
      $and: [
        { claimedBy: { $exists: true } },
        { $or: [{ "creator": { $type: "string" } }, { "creator.address": { $exists: false } }] },
      ],
    })
    .toArray();

  let updatedCount = 0;

  for (const doc of brokenDocs) {
    const claimedBy = doc.claimedBy;
    if (!claimedBy) continue;

    // If creator is just a string, convert it to object
    const newCreator =
      typeof doc.creator === "string"
        ? { address: doc.creator }
        : { ...doc.creator, address: claimedBy };

    await collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          creator: newCreator,
        },
      }
    );

    console.log(`✅ Fixed creator field for drop ${doc.dropId}`);
    updatedCount++;
  }

  console.log(`🏁 Done. Patched ${updatedCount} drops.`);
  process.exit();
};

run();
