import { NextRequest } from "next/server";
import {
  ParseWebhookEvent,
  parseWebhookEvent,
  verifyAppKeyWithNeynar,
} from "@farcaster/frame-node";
import { deleteUserNotificationDetails, setUserNotificationDetails } from "@/lib/kv"; // MongoDB-based functions
import { sendFrameNotification } from "@/lib/notifs"; // Function to send notifications

export async function POST(request: NextRequest) {
  const requestJson = await request.json();
  
  let data;
  try {
    data = await parseWebhookEvent(requestJson, verifyAppKeyWithNeynar);
  } catch (e: unknown) {
    const error = e as ParseWebhookEvent.ErrorType;

    // Handle various error cases
    switch (error.name) {
      case "VerifyJsonFarcasterSignature.InvalidDataError":
      case "VerifyJsonFarcasterSignature.InvalidEventDataError":
        return Response.json({ success: false, error: error.message }, { status: 400 });
      case "VerifyJsonFarcasterSignature.InvalidAppKeyError":
        return Response.json({ success: false, error: error.message }, { status: 401 });
      case "VerifyJsonFarcasterSignature.VerifyAppKeyError":
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
  }

  const fid = data.fid; // Farcaster user ID
  const event = data.event; // Event data

  switch (event.event) {
    case "frame_added":
      console.log("Handling frame_added event...");

      if (event.notificationDetails) {
        // Store the notification details in MongoDB
        console.log("Storing notification details:", event.notificationDetails);
        await setUserNotificationDetails(fid, event.notificationDetails);

        // Send a welcome notification to the user
        const sendResult = await sendFrameNotification({
          fid,
          title: "meet tab",
          body: "You're all set to receive notifications. Stay close, stay notified!",
          targetUrl:"https://usetab.app",
        });

        // Check the state and log accordingly
        if (sendResult.state === "error") {
          console.error("Error sending notification:", sendResult.error);
        } else if (sendResult.state === "rate_limit") {
          console.log("Rate limit exceeded. Notification not sent.");
        } else if (sendResult.state === "no_token") {
          console.log("No notification token found for the user.");
        } else {
          console.log("Notification sent successfully.");
        }
      } else {
        console.log("No notification details provided for frame_added.");
        await deleteUserNotificationDetails(fid);
      }
      break;

    case "frame_removed":
      console.log("Handling frame_removed event...");
      await deleteUserNotificationDetails(fid);
      break;

    case "notifications_enabled":
      console.log("Handling notifications_enabled event...");
      await setUserNotificationDetails(fid, event.notificationDetails);
      await sendFrameNotification({
        fid,
        title: "meet tab",
        body: "You're all set to receive notifications. Stay close, stay notified!",
        targetUrl:"https://usetab.app",
      });
      break;

    case "notifications_disabled":
      console.log("Handling notifications_disabled event...");
      await deleteUserNotificationDetails(fid);
      break;
  }

  return Response.json({ success: true });
}
