// // app/api/leaderboard/points/route.ts
// import { NextRequest } from "next/server";
// import clientPromise from "@/lib/mongodb";

// export const dynamic = "force-dynamic";

// export async function GET(req: NextRequest) {
//   const client = await clientPromise;
//   const db = client.db();
//   const collection = db.collection("a-user-points");

//   // 1. Fetch top 50 users by points
//   const topUsers = await collection
//     .find({ points: { $gt: 0 } })
//     .sort({ points: -1 })
//     .limit(50)
//     .toArray();

//   // 2. Enrich each user with Neynar profile
//   const enriched = await Promise.all(
//     topUsers.map(async (u) => {
//       let profile = null;
//       try {
//         const res = await fetch(
//           `${process.env.PUBLIC_URL}/api/neynar/user/by-address/${u.address}`
//         );
//         profile = await res.json();
//       } catch {}

//       return {
//         address: u.address,
//         points: u.points,
//         fid: profile?.fid,
//         username: profile?.username,
//         displayName: profile?.display_name,
//         pfp: profile?.pfp_url,
//         score: profile?.experimental?.neynar_user_score ?? null,
//       };
//     })
//   );

//   return Response.json({ leaders: enriched });
// }






// app/api/leaderboard/points/route.ts
import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-user-points");

  // 1. Fetch top users by points
  const topUsers = await collection
    .find({ points: { $gt: 0 } })
    .sort({ points: -1 })
    .limit(100) // fetch extra in case of filtering
    .toArray();

  // 2. Enrich with Neynar profile and filter
  const enriched = [];

  for (const u of topUsers) {
    try {
      const res = await fetch(
        `${process.env.PUBLIC_URL}/api/neynar/user/by-address/${u.address}`
      );
      const profile = await res.json();
      const score = profile?.experimental?.neynar_user_score ?? 0;

      if (score >= 0.3) {
        enriched.push({
          address: u.address,
          points: u.points,
          fid: profile?.fid,
          username: profile?.username,
          displayName: profile?.display_name,
          pfp: profile?.pfp_url,
          score,
        });
      }
    } catch {
      // skip on failure
    }
  }

  return Response.json({ leaders: enriched });
}
