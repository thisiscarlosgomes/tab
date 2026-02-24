import clientPromise from "@/lib/mongodb";
import {
  sendWebPushNotification,
  type StoredWebPushSubscription,
} from "@/lib/web-push";

type WebPushSubscriptionDoc = {
  userId: string;
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  enabled: boolean;
  fid?: number | null;
  addresses?: string[];
};

export type WebUserNotificationTarget = {
  userId?: string | null;
  fid?: number | string | null;
  address?: string | null;
};

export type WebUserNotificationPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

function normalizeAddress(value?: string | null) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

function normalizeFid(value?: number | string | null) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function sendWebNotificationToUser(
  target: WebUserNotificationTarget,
  payload: WebUserNotificationPayload
) {
  const userId = typeof target.userId === "string" && target.userId.trim() ? target.userId.trim() : null;
  const fid = normalizeFid(target.fid);
  const address = normalizeAddress(target.address);

  if (!userId && !fid && !address) {
    return {
      success: false as const,
      matchedSubscriptions: 0,
      sent: 0,
      removed: 0,
      errors: ["Missing notification target (userId, fid, or address)"],
    };
  }

  const orFilters: Record<string, unknown>[] = [];
  if (userId) orFilters.push({ userId });
  if (fid) orFilters.push({ fid });
  if (address) orFilters.push({ addresses: address });

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<WebPushSubscriptionDoc>("a-web-push-subscriptions");
  const subscriptions = await collection
    .find({
      enabled: true,
      ...(orFilters.length === 1 ? orFilters[0] : { $or: orFilters }),
    })
    .toArray();

  const byEndpoint = new Map<string, WebPushSubscriptionDoc>();
  for (const sub of subscriptions) {
    if (!sub.endpoint) continue;
    byEndpoint.set(sub.endpoint, sub);
  }

  let sent = 0;
  let removed = 0;
  const errors: string[] = [];

  for (const sub of byEndpoint.values()) {
    const pushTarget: StoredWebPushSubscription = {
      endpoint: sub.endpoint,
      expirationTime: sub.expirationTime ?? null,
      keys: sub.keys,
    };
    try {
      await sendWebPushNotification(pushTarget, {
        title: payload.title,
        body: payload.body,
        url: payload.url ?? "/notifications",
        tag: payload.tag,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
      });
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await collection.updateOne(
          { endpoint: sub.endpoint, userId: sub.userId },
          { $set: { enabled: false, updatedAt: new Date() } as never }
        );
        removed += 1;
      } else {
        errors.push(error instanceof Error ? error.message : "Push send failed");
      }
    }
  }

  return {
    success: sent > 0,
    matchedSubscriptions: byEndpoint.size,
    sent,
    removed,
    errors,
  };
}

