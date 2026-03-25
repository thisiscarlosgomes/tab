import clientPromise from "@/lib/mongodb";
import { getNextDayUtc, getStartOfDayUtc } from "@/lib/agent-access";

export async function getAgentDailyUsedTotal(userId: string) {
  const client = await clientPromise;
  const db = client.db();
  const settlements = db.collection("a-agent-settlement");
  const transfers = db.collection("a-agent-transfer");
  const start = getStartOfDayUtc();
  const end = getNextDayUtc();

  const aggregateTotal = async (collectionName: "settlements" | "transfers") => {
    const collection = collectionName === "settlements" ? settlements : transfers;
    const result = await collection
      .aggregate([
        {
          $match: {
            userId,
            createdAt: { $gte: start, $lt: end },
            status: { $in: ["pending", "success"] },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
      .toArray();
    return Number(result[0]?.total ?? 0);
  };

  const [settlementsTotal, transfersTotal] = await Promise.all([
    aggregateTotal("settlements"),
    aggregateTotal("transfers"),
  ]);

  return settlementsTotal + transfersTotal;
}
