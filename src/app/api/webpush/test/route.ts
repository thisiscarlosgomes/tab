import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { requireTrustedRequest } from "@/lib/security";
import { getPrivyAuthedUserFromAuthorization } from "@/lib/user-profile";
import {
  isWebPushConfigured,
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
};

async function requirePrivyUser(req: NextRequest) {
  const authed = await getPrivyAuthedUserFromAuthorization(req.headers.get("authorization"));
  if (!authed.ok) return authed;
  const userId = typeof authed.user.id === "string" ? authed.user.id : "";
  if (!userId) {
    return {
      ok: false as const,
      response: Response.json({ error: "Invalid user" }, { status: 401 }),
    };
  }
  return { ok: true as const, userId };
}

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "webpush-test-post",
    limit: 20,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  const auth = await requirePrivyUser(req);
  if (!auth.ok) return auth.response;

  if (!isWebPushConfigured()) {
    return Response.json({ error: "Web push is not configured" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    url?: string;
  };

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<WebPushSubscriptionDoc>("a-web-push-subscriptions");
  const subscriptions = await collection.find({ userId: auth.userId, enabled: true }).toArray();

  if (subscriptions.length === 0) {
    return Response.json({ error: "No web push subscriptions found" }, { status: 404 });
  }

  const payload = {
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Tab notifications enabled",
    body:
      typeof body.body === "string" && body.body.trim()
        ? body.body.trim()
        : "You will receive payment and activity notifications here.",
    url: typeof body.url === "string" && body.url.trim() ? body.url.trim() : "/notifications",
    tag: "tab-test",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
  };

  let sent = 0;
  let removed = 0;
  const errors: string[] = [];

  for (const sub of subscriptions) {
    const target: StoredWebPushSubscription = {
      endpoint: sub.endpoint,
      expirationTime: sub.expirationTime ?? null,
      keys: sub.keys,
    };

    try {
      await sendWebPushNotification(target, payload);
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await collection.updateOne(
          { endpoint: sub.endpoint, userId: auth.userId },
          { $set: { enabled: false } }
        );
        removed += 1;
        continue;
      }
      errors.push(error instanceof Error ? error.message : "Push send failed");
    }
  }

  return Response.json({
    success: sent > 0,
    sent,
    removed,
    errors,
  });
}

