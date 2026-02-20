// /app/api/send-payment-notification/route.ts

import { NextRequest } from "next/server";
import { sendFrameNotification } from "@/lib/notifs";

export async function POST(req: NextRequest) {
  const { fid, title, message, senderUsername, amount, targetUrl, token } =
    await req.json();

  const tokenLabel = token || "ETH"; // fallback just in case

  // Defaults if not provided
  const finalTitle = title || `💸 @${senderUsername} sent you ${amount} ${tokenLabel}`;
  const finalBody = message?.trim()
    ? `${message}`
    : `@${senderUsername} sent you ${amount} ${tokenLabel}`;
  const finalTargetUrl = targetUrl || "https://usetab.app";

  const result = await sendFrameNotification({
    fid,
    title: finalTitle,
    body: finalBody,
    targetUrl: finalTargetUrl,
  });

  return Response.json(result);
}
