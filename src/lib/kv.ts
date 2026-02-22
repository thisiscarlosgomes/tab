import clientPromise from "@/lib/mongodb";

// Define the type for notification details
interface NotificationDetails {
  url: string; // URL for sending the notification
  token: string; // Notification token
}

async function getCollection() {
  const client = await clientPromise;
  return client.db().collection("a-split-notification");
}

// Exported function to get user notification details
export async function getUserNotificationDetails(fid: number): Promise<NotificationDetails | null> {
  const collection = await getCollection();
  const userNotification = await collection.findOne({ fid });
  return userNotification ? userNotification.notificationDetails : null;
}

// Exported function to set user notification details
export async function setUserNotificationDetails(
  fid: number,
  notificationDetails: NotificationDetails // Use the defined type here
) {
  const collection = await getCollection();
  await collection.updateOne(
    { fid },
    { $set: { notificationDetails } },
    { upsert: true }
  );
}

// Exported function to delete user notification details
export async function deleteUserNotificationDetails(fid: number) {
  const collection = await getCollection();
  await collection.deleteOne({ fid });
}
