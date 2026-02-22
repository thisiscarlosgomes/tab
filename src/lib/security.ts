import { createHash, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

type GuardOptions = {
  bucket: string;
  limit: number;
  windowMs: number;
  requireInternalSecret?: boolean;
  allowBearerAuthorization?: boolean;
};

const RATE_LIMIT_STORE_KEY = "__tab_rate_limit_store__";
const INTERNAL_SECRET_HEADER = "x-internal-api-secret";

function getEffectiveInternalSecret(): string | null {
  const explicit = process.env.INTERNAL_API_SECRET;
  if (explicit) return explicit;

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) return null;

  return createHash("sha256").update(privateKey).digest("hex");
}

function getRateLimitStore(): Map<string, RateLimitRecord> {
  const globalWithStore = globalThis as typeof globalThis & {
    [RATE_LIMIT_STORE_KEY]?: Map<string, RateLimitRecord>;
  };

  if (!globalWithStore[RATE_LIMIT_STORE_KEY]) {
    globalWithStore[RATE_LIMIT_STORE_KEY] = new Map<string, RateLimitRecord>();
  }

  return globalWithStore[RATE_LIMIT_STORE_KEY]!;
}

function parseOrigin(raw: string | null): string | null {
  if (!raw) return null;

  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function addOriginWithCommonVariants(origins: Set<string>, origin: string) {
  origins.add(origin);

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();

    // Trust both apex and www forms for the same configured domain.
    if (hostname.startsWith("www.")) {
      const apex = hostname.slice(4);
      if (apex) {
        const apexUrl = new URL(origin);
        apexUrl.hostname = apex;
        origins.add(apexUrl.origin);
      }
      return;
    }

    if (hostname.includes(".") && hostname !== "localhost" && hostname !== "127.0.0.1") {
      const wwwUrl = new URL(origin);
      wwwUrl.hostname = `www.${hostname}`;
      origins.add(wwwUrl.origin);
    }
  } catch {
    // ignore invalid origins
  }
}

function getAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const candidates = [process.env.PUBLIC_URL, process.env.NEXT_PUBLIC_URL];

  for (const candidate of candidates) {
    const parsed = parseOrigin(candidate ?? null);
    if (parsed) addOriginWithCommonVariants(origins, parsed);
  }

  if (process.env.VERCEL_URL) {
    addOriginWithCommonVariants(origins, `https://${process.env.VERCEL_URL}`);
  }

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return origins;
}

function secureCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

export function getInternalRequestHeaders(): Record<string, string> {
  const secret = getEffectiveInternalSecret();

  if (!secret) return {};
  return { [INTERNAL_SECRET_HEADER]: secret };
}

export function hasValidInternalSecret(req: NextRequest): boolean {
  const secret = getEffectiveInternalSecret();
  if (!secret) return false;

  const provided = req.headers.get(INTERNAL_SECRET_HEADER);
  if (!provided) return false;

  return secureCompare(secret, provided);
}

export function isTrustedOrigin(req: NextRequest): boolean {
  const origin =
    parseOrigin(req.headers.get("origin")) ??
    parseOrigin(req.headers.get("referer"));

  if (!origin) return false;
  if (process.env.NODE_ENV !== "production") {
    try {
      const parsed = new URL(origin);
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        return true;
      }
    } catch {
      // fall through to explicit allowlist check
    }
  }
  return getAllowedOrigins().has(origin);
}

export function getClientIp(req: NextRequest): string {
  const xForwardedFor = req.headers.get("x-forwarded-for");
  if (xForwardedFor) return xForwardedFor.split(",")[0]?.trim() || "unknown";

  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp) return xRealIp;

  return "unknown";
}

function applyRateLimit(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds: number } {
  const store = getRateLimitStore();
  const now = Date.now();
  const id = `${bucket}:${key}`;
  const current = store.get(id);

  if (!current || current.resetAt <= now) {
    store.set(id, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= limit) {
    const retryAfterMs = Math.max(current.resetAt - now, 0);
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  current.count += 1;
  store.set(id, current);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function requireTrustedRequest(
  req: NextRequest,
  options: GuardOptions
): Response | null {
  const isInternal = hasValidInternalSecret(req);
  const trustedOrigin = isTrustedOrigin(req);
  const hasBearerAuthorization =
    options.allowBearerAuthorization === true &&
    /^bearer\s+\S+/i.test(req.headers.get("authorization") ?? "");

  if (options.requireInternalSecret) {
    if (!isInternal) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (!isInternal && !trustedOrigin && !hasBearerAuthorization) {
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  }

  const key = `${getClientIp(req)}:${req.nextUrl.pathname}`;
  const result = applyRateLimit(
    options.bucket,
    key,
    options.limit,
    options.windowMs
  );

  if (!result.allowed) {
    return Response.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(result.retryAfterSeconds) },
      }
    );
  }

  return null;
}
