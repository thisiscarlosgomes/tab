import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { requireTrustedRequest } from "@/lib/security";
import { getPrivyAuthedUserFromAuthorization } from "@/lib/user-profile";
import { getWebPushPublicKey, isWebPushConfigured } from "@/lib/web-push";

type LinkedAccountLike = {
  type?: string;
  chain_type?: string;
  chainType?: string;
  address?: string;
  fid?: number | string | null;
};

type WebPushSubscriptionKeys = {
  p256dh?: string;
  auth?: string;
};

type WebPushSubscriptionInput = {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: WebPushSubscriptionKeys;
};

type WebPushSubscriptionDoc = {
  userId: string;
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  fid: number | null;
  addresses: string[];
  ua: string | null;
  platform: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
};

function normalizeAddress(value?: string | null) {
  return typeof value === "string" && value ? value.toLowerCase() : null;
}

function normalizeFid(value?: number | string | null) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toLinkedAccounts(user: unknown): LinkedAccountLike[] {
  if (!user || typeof user !== "object") return [];
  const maybeAccounts =
    (user as { linked_accounts?: unknown; linkedAccounts?: unknown }).linked_accounts ??
    (user as { linked_accounts?: unknown; linkedAccounts?: unknown }).linkedAccounts;
  return Array.isArray(maybeAccounts) ? (maybeAccounts as LinkedAccountLike[]) : [];
}

function getAddresses(accounts: LinkedAccountLike[]) {
  return Array.from(
    new Set(
      accounts
        .filter(
          (a) =>
            a.type === "wallet" &&
            (a.chain_type === "ethereum" || a.chainType === "ethereum")
        )
        .map((a) => normalizeAddress(a.address))
        .filter((v): v is string => Boolean(v))
    )
  );
}

function getFid(accounts: LinkedAccountLike[]) {
  const farcaster = accounts.find((a) => a.type === "farcaster");
  return normalizeFid(farcaster?.fid);
}

function sanitizeSubscription(
  doc: Pick<WebPushSubscriptionDoc, "endpoint" | "platform" | "enabled" | "updatedAt" | "lastSeenAt">
) {
  return {
    endpoint: doc.endpoint,
    platform: doc.platform,
    enabled: doc.enabled,
    updatedAt: doc.updatedAt,
    lastSeenAt: doc.lastSeenAt,
  };
}

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
  return {
    ok: true as const,
    userId,
    linkedAccounts: toLinkedAccounts(authed.user),
  };
}

export async function GET(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "webpush-subscriptions-get",
    limit: 60,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  const auth = await requirePrivyUser(req);
  if (!auth.ok) return auth.response;

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<WebPushSubscriptionDoc>("a-web-push-subscriptions");
  const docs = await collection
    .find({ userId: auth.userId, enabled: true })
    .sort({ updatedAt: -1 })
    .toArray();

  return Response.json({
    supported: true,
    configured: isWebPushConfigured(),
    vapidPublicKey: getWebPushPublicKey(),
    subscriptions: docs.map(sanitizeSubscription),
  });
}

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "webpush-subscriptions-post",
    limit: 40,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  const auth = await requirePrivyUser(req);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    subscription?: WebPushSubscriptionInput;
    platform?: string;
  };
  const subscription = body.subscription;

  const endpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint.trim() : "";
  const p256dh = typeof subscription?.keys?.p256dh === "string" ? subscription.keys.p256dh.trim() : "";
  const authKey = typeof subscription?.keys?.auth === "string" ? subscription.keys.auth.trim() : "";

  if (!endpoint || !p256dh || !authKey) {
    return Response.json({ error: "Invalid PushSubscription" }, { status: 400 });
  }

  const now = new Date();
  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<WebPushSubscriptionDoc>("a-web-push-subscriptions");

  await collection.updateOne(
    { endpoint },
    {
      $set: {
        userId: auth.userId,
        endpoint,
        expirationTime:
          typeof subscription?.expirationTime === "number"
            ? subscription.expirationTime
            : null,
        keys: { p256dh, auth: authKey },
        fid: getFid(auth.linkedAccounts),
        addresses: getAddresses(auth.linkedAccounts),
        ua: req.headers.get("user-agent"),
        platform:
          typeof body.platform === "string" && body.platform.trim()
            ? body.platform.trim()
            : null,
        enabled: true,
        updatedAt: now,
        lastSeenAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return Response.json({
    success: true,
    configured: isWebPushConfigured(),
    vapidPublicKey: getWebPushPublicKey(),
  });
}

export async function DELETE(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "webpush-subscriptions-delete",
    limit: 40,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  const auth = await requirePrivyUser(req);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) {
    return Response.json({ error: "Missing endpoint" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<WebPushSubscriptionDoc>("a-web-push-subscriptions");

  await collection.updateOne(
    { endpoint, userId: auth.userId },
    { $set: { enabled: false, updatedAt: new Date() } }
  );

  return Response.json({ success: true });
}

