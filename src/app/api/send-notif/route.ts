// /app/api/send-payment-notification/route.ts

import { NextRequest } from "next/server";
import { sendFrameNotification } from "@/lib/notifs";

export async function POST(req: NextRequest) {
  const { fid, amount, senderUsername, message, token } = await req.json();

  const tokenLabel = token || "ETH"; // fallback just in case

  const title = `💸 You got ${tokenLabel}`;
  const body = message?.trim()
    ? `@${senderUsername} sent you ${amount} ${tokenLabel}: “${message}”`
    : `@${senderUsername} sent you ${amount} ${tokenLabel}`;
  const targetUrl = "https://tab.castfriends.com";

  const result = await sendFrameNotification({ fid, title, body, targetUrl });

  return Response.json(result);
}
