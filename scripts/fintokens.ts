import "dotenv/config";
import { MongoClient } from "mongodb";

const run = async () => {
  const mongo = await MongoClient.connect(process.env.MONGODB_URI!);
  const db = mongo.db();
  const collection = db.collection("farcaster_index_tokens");

  // Find all tokens
  const tokens = await collection.find({}).toArray();
  console.log(`Found ${tokens.length} tokens.`);

  for (const token of tokens) {
    // Add default category array if missing
    if (!token.category) {
      await collection.updateOne(
        { _id: token._id },
        {
          $set: { category: ["farcaster"] },
        }
      );
      console.log(`✅ Updated token ${token._id} with category ["farcaster"]`);
    }
  }

  console.log("🏁 Update complete.");
  process.exit();
};

run();
