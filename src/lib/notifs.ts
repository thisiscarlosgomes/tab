import {
  SendNotificationRequest,
  sendNotificationResponseSchema,
} from "@farcaster/frame-sdk";
import { getUserNotificationDetails } from "@/lib/kv"; // MongoDB-based notification retrieval

// const appUrl = process.env.PUBLIC_URL || "https://tab.castfriends.com"; // Use your app URL

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
  // Retrieve the notification details from MongoDB for the user (by fid)
  const notificationDetails = await getUserNotificationDetails(fid);

  // If no notification details are found, return an error
  if (!notificationDetails) {
    return { state: "no_token" }; // No token found for the user
  }

  // Send the notification using the provided URL and token
  const response = await fetch(notificationDetails.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      notificationId: crypto.randomUUID(),
      title,
      body,
      targetUrl,
      tokens: [notificationDetails.token],
    } satisfies SendNotificationRequest),
  });

  const responseJson = await response.json();

  // Handle the response from the notification service
  if (response.status === 200) {
    const responseBody = sendNotificationResponseSchema.safeParse(responseJson);

    // If the response is malformed, return an error
    if (responseBody.success === false) {
      return { state: "error", error: responseBody.error.errors };
    }

    // If the token is rate-limited, return the rate-limit state
    if (responseBody.data.result.rateLimitedTokens.length) {
      return { state: "rate_limit" };
    }

    // Return success if notification was sent successfully
    return { state: "success" };
  } else {
    // If the response from the notification service is not successful, return an error
    return { state: "error", error: responseJson };
  }
}
