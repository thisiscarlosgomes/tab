import { SendNotificationRequest } from "@farcaster/frame-sdk";
import { sendNotificationResponseSchema } from "@farcaster/frame-core";
import { getUserNotificationDetails } from "@/lib/kv";

type SendFrameNotificationResult =
  | { state: "error"; error: unknown }
  | { state: "no_token" }
  | { state: "rate_limit" }
  | { state: "success" };

export async function sendFrameNotification({
  fid,
  title,
  body,
  targetUrl,
}: {
  fid: number;
  title: string;
  body: string;
  targetUrl: string;
}): Promise<SendFrameNotificationResult> {
  const notificationDetails = await getUserNotificationDetails(fid);

  if (!notificationDetails || !notificationDetails.token || !notificationDetails.url) {
    console.warn(`No valid notification details for fid ${fid}`);
    return { state: "no_token" };
  }

  console.log("Sending notification to fid:", fid, "url:", notificationDetails.url);

  const payload: SendNotificationRequest = {
    notificationId: crypto.randomUUID(),
    title,
    body,
    targetUrl,
    tokens: [notificationDetails.token],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

  try {
    const response = await fetch(notificationDetails.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseJson = await response.json();

    if (response.status === 200) {
      const parsed = sendNotificationResponseSchema.safeParse(responseJson);
      if (!parsed.success) {
        console.error("Invalid response schema from notification server:", parsed.error);
        return { state: "error", error: parsed.error.errors };
      }

      if (parsed.data.result.rateLimitedTokens.length) {
        return { state: "rate_limit" };
      }

      return { state: "success" };
    } else {
      console.error("Notification request failed with non-200 status:", response.status, responseJson);
      return { state: "error", error: responseJson };
    }
  } catch (err) {
    console.error(`Fetch failed for fid ${fid}:`, err);
    return { state: "error", error: err };
  }
}
