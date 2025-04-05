import clientPromise from "@/lib/mongodb";

// MongoDB client setup
const client = await clientPromise;
const db = client.db();
const collection = db.collection("a-split-notification");

// Define the type for notification details
interface NotificationDetails {
  url: string; // URL for sending the notification
  token: string; // Notification token
}

// Exported function to get user notification details
export async function getUserNotificationDetails(fid: number): Promise<NotificationDetails | null> {
  const userNotification = await collection.findOne({ fid });
  return userNotification ? userNotification.notificationDetails : null;
}

// Exported function to set user notification details
export async function setUserNotificationDetails(
  fid: number,
  notificationDetails: NotificationDetails // Use the defined type here
) {
  await collection.updateOne(
    { fid },
    { $set: { notificationDetails } },
    { upsert: true }
  );
}

// Exported function to delete user notification details
export async function deleteUserNotificationDetails(fid: number) {
  await collection.deleteOne({ fid });
}
