import webpush from "web-push";

let configured = false;

function getVapidConfig() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.WEB_PUSH_VAPID_SUBJECT?.trim() ?? "mailto:hello@usetab.app";

  if (!publicKey || !privateKey) {
    return null;
  }

  return { publicKey, privateKey, subject };
}

export function getWebPushPublicKey() {
  return process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? null;
}

export function isWebPushConfigured() {
  return Boolean(getVapidConfig());
}

function ensureConfigured() {
  if (configured) return;
  const vapid = getVapidConfig();
  if (!vapid) {
    throw new Error("Missing WEB_PUSH_VAPID_PUBLIC_KEY/PRIVATE_KEY");
  }
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  configured = true;
}

export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
};

export type StoredWebPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export async function sendWebPushNotification(
  subscription: StoredWebPushSubscription,
  payload: WebPushPayload
) {
  ensureConfigured();
  return webpush.sendNotification(subscription, JSON.stringify(payload));
}

