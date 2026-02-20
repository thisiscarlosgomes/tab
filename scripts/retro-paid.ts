import "dotenv/config";
import { MongoClient } from "mongodb";

const run = async () => {
  const mongo = await MongoClient.connect(process.env.MONGODB_URI!);
  const db = mongo.db();
  const collection = db.collection("a-split-bill");

  const allSplits = await collection.find({}).toArray();
  let updatedCount = 0;

  for (const bill of allSplits) {
    const creator = bill.creator;
    const token = bill.token;
    const alreadyPaid = (bill.paid ?? []).some(
      (p: any) => p.address?.toLowerCase() === creator.address?.toLowerCase()
    );

    if (!alreadyPaid) {
      await collection.updateOne(
        { _id: bill._id },
        {
          $addToSet: {
            paid: {
              address: creator.address,
              name: creator.name,
              txHash: "", // or null/placeholder
              status: "paid",
              token,
              timestamp: new Date(),
            },
          },
        }
      );
      console.log(`✅ Marked creator as paid for split ${bill.splitId}`);
      updatedCount++;
    }
  }

  console.log(`🏁 Done. Updated ${updatedCount} splits.`);
  process.exit();
};

run();
