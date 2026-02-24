// /app/api/send-payment-notification/route.ts

import { NextRequest } from "next/server";
import { requireTrustedRequest } from "@/lib/security";
import { sendWebNotificationToUser } from "@/lib/user-notifications";

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "send-notif-post",
    limit: 60,
    windowMs: 60_000,
  });
  if (denied) return denied;

  const { fid, userId, address, recipientAddress, title, message, senderUsername, amount, targetUrl, token } =
    await req.json();

  const tokenLabel = token || "ETH"; // fallback just in case
  const safeSenderUsername =
    typeof senderUsername === "string" &&
    senderUsername.trim() &&
    senderUsername.trim().toLowerCase() !== "null" &&
    senderUsername.trim().toLowerCase() !== "undefined"
      ? senderUsername.trim()
      : null;
  const senderLabel = safeSenderUsername ? `@${safeSenderUsername}` : "Someone";

  // Defaults if not provided
  const finalTitle = title || `💸 ${senderLabel} sent you ${amount} ${tokenLabel}`;
  const finalBody = message?.trim()
    ? `${message}`
    : `${senderLabel} sent you ${amount} ${tokenLabel}`;
  const finalTargetUrl = targetUrl || "https://usetab.app";

  const result = await sendWebNotificationToUser(
    {
      fid,
      userId,
      address: recipientAddress || address || null,
    },
    {
    title: finalTitle,
    body: finalBody,
      url: finalTargetUrl,
      tag: "tab-app-notification",
    }
  );

  if (result.matchedSubscriptions === 0) {
    return Response.json({ state: "no_subscription", ...result });
  }
  if (!result.success) {
    return Response.json({ state: "error", ...result }, { status: 502 });
  }
  return Response.json({ state: "success", ...result });
}
