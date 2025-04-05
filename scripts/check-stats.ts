import "dotenv/config";
import { MongoClient } from "mongodb";

const run = async () => {
  const mongo = await MongoClient.connect(process.env.MONGODB_URI!);
  const db = mongo.db();

  const today = new Date().toISOString().slice(0, 10);
  const startOfToday = new Date(`${today}T00:00:00Z`);
  const endOfToday = new Date(`${today}T23:59:59Z`);

  let totalSpinsToday = 0;
  let totalWinnersToday = 0;
  let totalSpinsAllTime = 0;
  let totalWinnersAllTime = 0;

  const spinsCursor = await db.collection("a-daily-spins").find({});
  for await (const doc of spinsCursor) {
    const spins = doc.spins || {};
    for (const date in spins) {
      const entries = spins[date];
      totalSpinsAllTime += entries.length;
      totalWinnersAllTime += entries.filter((s: any) => s.reward !== "Nothing today").length;

      if (date === today) {
        totalSpinsToday += entries.length;
        totalWinnersToday += entries.filter((s: any) => s.reward !== "Nothing today").length;
      }
    }
  }

  const tracker = await db.collection("a-daily-token-tracker").findOne({ date: today });
  const allTrackers = await db.collection("a-daily-token-tracker").find({}).toArray();

  const totalDistributedToday = tracker?.total ?? 0;
  const totalDistributedAllTime = allTrackers.reduce((sum, t) => sum + (t.total || 0), 0);

  const splitToday = await db.collection("a-split-game").countDocuments({ createdAt: { $gte: startOfToday, $lte: endOfToday } });
  const splitAll = await db.collection("a-split-game").countDocuments();

  const billToday = await db.collection("a-split-bill").countDocuments({ createdAt: { $gte: startOfToday, $lte: endOfToday } });
  const billAll = await db.collection("a-split-bill").countDocuments();

  const splitNotifs = await db.collection("a-split-notification").distinct("fid");
  const totalNotifFIDs = splitNotifs.length;

  const roomsByUser = await db.collection("a-split-game").aggregate([
    { $group: { _id: "$admin", count: { $sum: 1 } } },
    { $match: { count: { $gt: 3 } } },
  ]).toArray();

  const billsByUser = await db.collection("a-split-bill").aggregate([
    { $group: { _id: "$creator", count: { $sum: 1 } } },
    { $match: { count: { $gt: 3 } } },
  ]).toArray();

  const powerUsers = roomsByUser.filter(roomUser =>
    billsByUser.find(billUser => billUser._id?.toLowerCase?.() === roomUser._id?.toLowerCase?.())
  );

  const leaderboard = await db.collection("a-user-points")
    .find({})
    .sort({ points: -1 })
    .limit(5)
    .toArray();

  // 👇 New metrics: users who shared or added the app
  const userPointsCursor = await db.collection("a-user-points").find({});
  let sharedCount = 0;
  let addedCount = 0;

  for await (const user of userPointsCursor) {
    const actions = user.history || [];
    const hasShared = actions.some((a: any) => a.action === "share_frame");
    const hasAdded = actions.some((a: any) => a.action === "add_frame");
    if (hasShared) sharedCount++;
    if (hasAdded) addedCount++;
  }

  console.log(`-------------`);
  console.log(`\n📅 Daily Stats for ${today}`);
  console.log(`🎯 Spins Today: ${totalSpinsToday}`);
  console.log(`🏆 Winners Today: ${totalWinnersToday}`);
  console.log(`🪙 $TAB Distributed Today: ${totalDistributedToday}`);
  console.log(`💸 Tables Created Today: ${splitToday}`);
  console.log(`🧾 Bills Created Today: ${billToday}`);
  console.log(`-------------`);
  console.log(`\n📊 All-Time Stats`);
  console.log(`🎯 Total Spins: ${totalSpinsAllTime}`);
  console.log(`🏆 Total Winners: ${totalWinnersAllTime}`);
  console.log(`🪙 Total $TAB Distributed: ${totalDistributedAllTime}`);
  console.log(`💸 Total Tables: ${splitAll}`);
  console.log(`🧾 Total Bills: ${billAll}`);
  console.log(`📣 Total Users with Notifications: ${totalNotifFIDs}`);
  console.log(`📤 Users Who Shared: ${sharedCount}`);
  console.log(`➕ Users Who Added: ${addedCount}`);
  console.log(`-------------`);

  console.log(`\n👑 Power Users (3+ tables & bills):`);
  powerUsers.forEach((u) => console.log(`- ${u._id}`));

  console.log(`\n🏅 Top 5 Points Leaderboard:`);
  for (let i = 0; i < leaderboard.length; i++) {
    const user = leaderboard[i];
    const address = user.address;

    const [tableCount, billCount] = await Promise.all([
      db.collection("a-split-game").countDocuments(
        { admin: address },
        { collation: { locale: "en", strength: 2 } }
      ),
      db.collection("a-split-bill").countDocuments(
        { creator: address },
        { collation: { locale: "en", strength: 2 } }
      ),
    ]);

    const breakdown: Record<string, number> = {};
    user.history?.forEach((h: any) => {
      breakdown[h.action] = (breakdown[h.action] || 0) + h.points;
    });

    console.log(`#${i + 1} ${address}`);
    console.log(`   → ${user.points} pts`);
    console.log(`   → 🪑 Tables: ${tableCount} | 🧾 Bills: ${billCount}`);
    console.log(`   → Breakdown:`, breakdown);
  }

  process.exit();
};

run();
