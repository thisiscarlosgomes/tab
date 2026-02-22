import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

export const dynamic = "force-dynamic";

const ALLOWED_TOKENS = ["USDC", "EURC", "ETH"];

export async function GET(req: NextRequest) {
  const client = await clientPromise;
  const db = client.db();
  const baseUrl = process.env.PUBLIC_URL?.trim() || req.nextUrl.origin;

  const bills = await db.collection("a-split-bill").find({}).toArray();

  const spenders: Record<string, { name: string; amount: number }> = {};

  for (const bill of bills) {
    if (!ALLOWED_TOKENS.includes(bill.token) || !Array.isArray(bill.paid)) continue;

    const perPerson = bill.totalAmount / bill.numPeople;

    for (const entry of bill.paid) {
      const amount = typeof entry.amount === "number" ? entry.amount : perPerson;
      if (amount < 1 || !ALLOWED_TOKENS.includes(entry.token)) continue;

      const addr = entry.address;
      const name = entry.name || addr;

      if (!spenders[addr]) {
        spenders[addr] = { name, amount };
      } else {
        spenders[addr].amount += amount;
      }
    }
  }

  const topSpenders = Object.entries(spenders)
    .filter(([, data]) => data.amount >= 1)
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 50);

  const enriched = (
    await Promise.all(
      topSpenders.map(async ([address, data]) => {
        try {
          const res = await fetch(
            `${baseUrl}/api/neynar/user/by-address/${address}`
          );
          if (!res.ok) return null;
          const profile = await res.json();
          const score = profile?.experimental?.neynar_user_score ?? 0;

          if (score < 0.3) return null;

          return {
            address,
            totalSpent: data.amount,
            fid: profile?.fid,
            username: profile?.username,
            displayName: profile?.display_name,
            pfp: profile?.pfp_url,
            score,
          };
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean);

  return Response.json({ leaders: enriched });
}
