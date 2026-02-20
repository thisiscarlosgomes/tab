// import { NextRequest } from "next/server";
// import clientPromise from "@/lib/mongodb";
// import { sendFrameNotification } from "@/lib/notifs";

// export async function POST(_req: NextRequest) {
//   const client = await clientPromise;
//   const db = client.db();

//   const users = await db
//     .collection("a-split-notification")
//     .find({ "notificationDetails.token": { $exists: true } })
//     .toArray();

//   const BATCH_SIZE = 100;
//   let success = 0;
//   let failures = 0;
//   const failedFids: number[] = [];

//   for (let i = 0; i < users.length; i += BATCH_SIZE) {
//     const batch = users.slice(i, i + BATCH_SIZE);

//     const results = await Promise.allSettled(
//       batch.map((user) => {
//         try {
//           return sendFrameNotification({
//             fid: Number(user.fid),
//             title: "💰Enter $1.3M Jackpot + earn $tab",
//             body: "Buy a ticket, maybe win the jackpot... definitely earn up to 50,000 $tab. Feels illegal, but it’s not.",
//             targetUrl: "https://usetab.app/jackpot",
//           });
//         } catch (err) {
//           return Promise.reject(err);
//         }
//       })
//     );

//     results.forEach((result, index) => {
//       if (result.status === "fulfilled") {
//         success++;
//       } else {
//         console.error("Notification failed for fid:", batch[index].fid, result.reason);
//         failures++;
//         failedFids.push(batch[index].fid);
//       }
//     });
//   }

//   return Response.json({
//     success,
//     failures,
//     total: success + failures,
//     batches: Math.ceil(users.length / BATCH_SIZE),
//     failedFids,
//   });
// }




// src/app/api/broadcast/route.ts

import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { sendFrameNotification } from "@/lib/notifs";

export async function POST(_req: NextRequest) {
  const client = await clientPromise;
  const db = client.db();

  const users = await db
    .collection("a-split-notification")
    .find({ "notificationDetails.token": { $exists: true } })
    .toArray();

  const BATCH_SIZE = 100;
  let success = 0;
  let failures = 0;
  const failedFids: number[] = [];

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map((user) =>
        sendFrameNotification({
          fid: Number(user.fid),
          title: "🎟️ Use tab earn $DAU",
          body: "Grab a Jackpot ticket to earn $DAU",
          targetUrl: "https://usetab.app/jackpot",
        })
      )
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        success++;
      } else {
        console.error("Notification failed for fid:", batch[index].fid, result.reason);
        failures++;
        failedFids.push(batch[index].fid);
      }
    });
  }

  return new Response(
    JSON.stringify({
      success,
      failures,
      total: success + failures,
      batches: Math.ceil(users.length / BATCH_SIZE),
      failedFids,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

