// import { NextRequest } from "next/server";
// import { sendFrameNotification } from "@/lib/notifs";

// export async function POST(req: NextRequest) {
//   const testFids = [2201, 247916];

//   const users = testFids.map((fid) => ({
//     fid,
//     notificationDetails: { token: "test" }, // dummy shape to match original structure
//   }));

//   const results = await Promise.allSettled(
//     users.map((user) =>
//       sendFrameNotification({
//         fid: user.fid,
//         title: "💸 Spin to Win",
//         body: "New day, new chance. Jump in and claim your slice of the pot.",
//       })
//     )
//   );

//   const success = results.filter((r) => r.status === "fulfilled").length;
//   const failures = results.length - success;

//   return Response.json({
//     success,
//     failures,
//     total: results.length,
//   });
// }

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

//   const results = await Promise.allSettled(
//     users.map((user) =>
//       sendFrameNotification({
//         fid: user.fid,
//         title: "💸 Spin to Win",
//         body: "New day, new chance. Jump in and claim your slice of the pot.",
//       })
//     )
//   );

//   const success = results.filter((r) => r.status === "fulfilled").length;
//   const failures = results.length - success;

//   return Response.json({
//     success,
//     failures,
//     total: results.length,
//   });
// }

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

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    // const results = await Promise.allSettled(
    //   batch.map((user) =>
    //     sendFrameNotification({
    //       fid: user.fid,
    //       title: "📢tab v0.5 is live!",
    //       body: "Big upgrade just dropped. Smoother UX, reminders, notifications, more stables support, and new ways to get paid. Try it out.",
    //       targetUrl: "https://tab.castfriends.com",
    //     })
    //   )
    // );

    const results = await Promise.allSettled(
      batch.map((user) =>
        sendFrameNotification({
          fid: user.fid,
          title: "📢 ICYMI, tab got an upgrade",
          body: "smoother UX, reminders, cast notifs, more stables, new ways to get paid.",
          targetUrl: "https://tab.castfriends.com",
        })
      )
    );

    success += results.filter((r) => r.status === "fulfilled").length;
    failures += results.filter((r) => r.status === "rejected").length;
  }

  return Response.json({
    success,
    failures,
    total: success + failures,
    batches: Math.ceil(users.length / BATCH_SIZE),
  });
}
