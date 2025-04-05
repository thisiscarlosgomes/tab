import "dotenv/config";
import { MongoClient } from "mongodb";

type HistoryEntry = {
  action: string;
  points: number;
  tabId?: string;
  splitId?: string;
  timestamp: Date;
};

type UserPoints = {
  address: string;
  points: number;
  history: HistoryEntry[];
};

const run = async () => {
  const mongo = await MongoClient.connect(process.env.MONGODB_URI!);
  const db = mongo.db();
  const collection = db.collection<UserPoints>("a-user-points");

  const users = await collection.find({}).toArray();

  for (const user of users) {
    const originalHistory: HistoryEntry[] = user.history || [];

    const tabEntries = originalHistory.filter((h: HistoryEntry) => h.action === "create_tab");
    const keptTabEntries = tabEntries.slice(0, 3);
    const removedTabEntries = tabEntries.slice(3);

    const inviteEntries = originalHistory.filter((h: HistoryEntry) => h.action === "invite");

    const otherEntries = originalHistory.filter(
      (h: HistoryEntry) => h.action !== "create_tab" && h.action !== "invite"
    );

    const updatedHistory = [...keptTabEntries, ...otherEntries];

    const newTotalPoints = updatedHistory.reduce((sum, h: HistoryEntry) => sum + h.points, 0);

    await collection.updateOne(
      { address: user.address },
      {
        $set: {
          history: updatedHistory,
          points: newTotalPoints,
        },
      }
    );

    const removedTabCount = removedTabEntries.length;
    const removedInviteCount = inviteEntries.length;

    if (removedTabCount > 0 || removedInviteCount > 0) {
      console.log(
        `✅ Cleaned ${user.address}: -${removedTabCount} tab(s), -${removedInviteCount} invite(s)`
      );
    }
  }

  console.log("🏁 Cleanup complete.");
  process.exit();
};

run();
