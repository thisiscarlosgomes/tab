import { isAddress } from "viem";
import clientPromise from "@/lib/mongodb";
import { getPrivyServerClient } from "@/lib/privy-server";

type TwitterOAuthTokensInput = {
  provider: string;
  accessToken: string;
  accessTokenExpiresInSeconds?: number;
  refreshToken?: string;
  refreshTokenExpiresInSeconds?: number;
  scopes?: string[];
};

type TwitterAccountLike = {
  type?: string;
  subject?: string | null;
  username?: string | null;
  name?: string | null;
  profile_picture_url?: string | null;
  profilePictureUrl?: string | null;
};

type WalletAccountLike = {
  type?: string;
  chain_type?: string;
  chainType?: string;
  wallet_client_type?: string;
  walletClientType?: string;
  address?: string | null;
  id?: string | null;
};

export type TwitterIdentityProfile = {
  subject: string;
  username: string;
  name: string;
  profilePictureUrl: string | null;
  description?: string | null;
};

export type TwitterIdentityDoc = {
  subject: string;
  username: string;
  usernameLower: string;
  name: string | null;
  profilePictureUrl: string | null;
  description: string | null;
  privyUserId: string | null;
  walletAddress: string | null;
  walletId: string | null;
  updatedAt: Date;
  createdAt: Date;
};

type TwitterGraphCacheProfile = {
  subject: string;
  username: string;
  name: string;
  profilePictureUrl: string | null;
};

type TwitterGraphCacheDoc = {
  userId: string;
  subject: string;
  limit: number;
  kind: "following" | "followers";
  profiles: TwitterGraphCacheProfile[];
  updatedAt: Date;
  expiresAt: Date;
  createdAt: Date;
};

type TwitterOAuthDoc = {
  userId: string;
  subject: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
  updatedAt: Date;
  createdAt: Date;
};

type XUserResponse = {
  data?: {
    id?: string;
    username?: string;
    name?: string;
    profile_image_url?: string;
    description?: string;
  };
};

type XFollowListResponse = {
  data?: Array<{
    id?: string;
    username?: string;
    name?: string;
    profile_image_url?: string;
  }>;
  meta?: {
    next_token?: string;
  };
};

const X_API_BASE_URL = process.env.X_API_BASE_URL?.trim() || "https://api.x.com/2";
const TWITTER_IDENTITY_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const TWITTER_FOLLOWING_CACHE_TTL_MS = 1000 * 60 * 30;

function normalizeTwitterUsername(username: string) {
  return username.trim().replace(/^@+/, "").toLowerCase();
}

function normalizeAddress(address?: string | null) {
  return address ? address.toLowerCase() : null;
}

function getXAppBearerToken() {
  return process.env.X_BEARER_TOKEN?.trim() || null;
}

async function getCollections() {
  const client = await clientPromise;
  const db = client.db();
  return {
    identities: db.collection<TwitterIdentityDoc>("a-twitter-identity"),
    followingCache:
      db.collection<TwitterGraphCacheDoc>("a-twitter-following-cache"),
    oauth: db.collection<TwitterOAuthDoc>("a-twitter-oauth"),
  };
}

function isFreshDate(
  value: Date | string | null | undefined,
  maxAgeMs: number
) {
  if (!value) return false;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= maxAgeMs;
}

function buildExpiryDate(seconds?: number) {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000);
}

function extractLinkedAccounts(user: unknown) {
  if (!user || typeof user !== "object") return [] as Array<TwitterAccountLike | WalletAccountLike>;
  const maybeAccounts =
    (user as { linked_accounts?: unknown; linkedAccounts?: unknown }).linked_accounts ??
    (user as { linked_accounts?: unknown; linkedAccounts?: unknown }).linkedAccounts;
  return Array.isArray(maybeAccounts)
    ? (maybeAccounts as Array<TwitterAccountLike | WalletAccountLike>)
    : [];
}

function extractTwitterAccount(user: unknown) {
  const direct = (user as { twitter?: TwitterAccountLike | null } | null)?.twitter ?? null;
  if (direct?.subject && direct?.username) {
    return {
      subject: direct.subject,
      username: direct.username,
      name: direct.name ?? direct.username,
      profilePictureUrl:
        direct.profilePictureUrl ??
        direct.profile_picture_url ??
        null,
    };
  }

  const linked = extractLinkedAccounts(user).find(
    (account) => account.type === "twitter_oauth"
  ) as TwitterAccountLike | undefined;
  if (!linked?.subject || !linked?.username) return null;

  return {
    subject: linked.subject,
    username: linked.username,
    name: linked.name ?? linked.username,
    profilePictureUrl:
      linked.profilePictureUrl ??
      linked.profile_picture_url ??
      null,
  };
}

function extractPrimaryPrivyWallet(user: unknown) {
  const linked = extractLinkedAccounts(user).find(
    (account) =>
      account.type === "wallet" &&
      (((account as WalletAccountLike).chain_type ?? (account as WalletAccountLike).chainType) ===
        "ethereum") &&
      (((account as WalletAccountLike).wallet_client_type ??
        (account as WalletAccountLike).walletClientType) === "privy") &&
      typeof (account as WalletAccountLike).address === "string"
  ) as WalletAccountLike | undefined;

  if (!linked?.address) return null;
  return {
    walletAddress: normalizeAddress(linked.address),
    walletId: linked.id ?? null,
  };
}

async function xFetchJson<T>(
  path: string,
  options?: {
    searchParams?: Record<string, string | undefined>;
    userAccessToken?: string | null;
  }
) {
  const url = new URL(path, X_API_BASE_URL.endsWith("/") ? X_API_BASE_URL : `${X_API_BASE_URL}/`);
  if (options?.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      if (typeof value === "string" && value) url.searchParams.set(key, value);
    }
  }

  const authToken = options?.userAccessToken || getXAppBearerToken();
  if (!authToken) {
    throw new Error("Something went wrong...");
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`X API request failed: ${res.status}`);
  }

  return (await res.json()) as T;
}

export async function saveTwitterOAuthTokensForUser(input: {
  userId: string;
  user: unknown;
  tokens: TwitterOAuthTokensInput;
}) {
  if (input.tokens.provider !== "twitter") return;

  const twitter = extractTwitterAccount(input.user);
  if (!twitter?.subject) return;

  const { oauth, identities } = await getCollections();
  const now = new Date();

  await oauth.updateOne(
    { userId: input.userId },
    {
      $set: {
        userId: input.userId,
        subject: twitter.subject,
        username: twitter.username ?? null,
        name: twitter.name ?? null,
        profilePictureUrl: twitter.profilePictureUrl ?? null,
        accessToken: input.tokens.accessToken,
        accessTokenExpiresAt: buildExpiryDate(input.tokens.accessTokenExpiresInSeconds),
        refreshToken: input.tokens.refreshToken ?? null,
        refreshTokenExpiresAt: buildExpiryDate(input.tokens.refreshTokenExpiresInSeconds),
        scopes: Array.isArray(input.tokens.scopes) ? input.tokens.scopes : [],
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );

  await identities.updateOne(
    { subject: twitter.subject },
    {
      $set: {
        username: twitter.username,
        usernameLower: normalizeTwitterUsername(twitter.username),
        name: twitter.name ?? null,
        profilePictureUrl: twitter.profilePictureUrl ?? null,
        description: null,
        updatedAt: now,
      },
      $setOnInsert: {
        subject: twitter.subject,
        privyUserId: input.userId,
        walletAddress: null,
        walletId: null,
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

export async function getTwitterOAuthDocForUser(userId: string) {
  const { oauth } = await getCollections();
  return oauth.findOne({ userId });
}

export async function getTwitterIdentityByUsername(username: string) {
  const { identities } = await getCollections();
  return identities.findOne({ usernameLower: normalizeTwitterUsername(username) });
}

export async function upsertTwitterIdentity(profile: TwitterIdentityProfile) {
  const { identities } = await getCollections();
  const now = new Date();
  await identities.updateOne(
    { subject: profile.subject },
    {
      $set: {
        username: profile.username,
        usernameLower: normalizeTwitterUsername(profile.username),
        name: profile.name ?? null,
        profilePictureUrl: profile.profilePictureUrl ?? null,
        description: profile.description ?? null,
        updatedAt: now,
      },
      $setOnInsert: {
        subject: profile.subject,
        privyUserId: null,
        walletAddress: null,
        walletId: null,
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

export async function fetchTwitterUserByUsername(
  username: string,
  options?: { actorUserId?: string | null }
) {
  const cleaned = normalizeTwitterUsername(username);
  if (!cleaned) return null;
  const cachedIdentity = await getTwitterIdentityByUsername(cleaned);
  if (
    cachedIdentity &&
    isFreshDate(cachedIdentity.updatedAt, TWITTER_IDENTITY_CACHE_TTL_MS)
  ) {
    return {
      subject: cachedIdentity.subject,
      username: cachedIdentity.username,
      name: cachedIdentity.name ?? cachedIdentity.username,
      profilePictureUrl: cachedIdentity.profilePictureUrl ?? null,
      description: cachedIdentity.description ?? null,
    } satisfies TwitterIdentityProfile;
  }

  const actorToken =
    options?.actorUserId ? (await getTwitterOAuthDocForUser(options.actorUserId))?.accessToken ?? null : null;
  const response = await xFetchJson<XUserResponse>(`users/by/username/${encodeURIComponent(cleaned)}`, {
    searchParams: { "user.fields": "profile_image_url,description" },
    userAccessToken: actorToken,
  });

  const data = response?.data;
  if (!data?.id || !data?.username || !data?.name) return null;

  const profile = {
    subject: data.id,
    username: data.username,
    name: data.name,
    profilePictureUrl: data.profile_image_url ?? null,
    description: data.description ?? null,
  } satisfies TwitterIdentityProfile;

  await upsertTwitterIdentity(profile);
  return profile;
}

async function ensureTwitterUserWalletRecord(input: {
  subject: string;
  username: string;
  name: string;
  profilePictureUrl: string | null;
}) {
  const privy = getPrivyServerClient();

  let user: unknown;
  try {
    user = await privy.users().getByTwitterSubject({ subject: input.subject });
  } catch {
    user = await privy.users().create({
      linked_accounts: [
        {
          type: "twitter_oauth",
          subject: input.subject,
          username: input.username,
          name: input.name,
          ...(input.profilePictureUrl ? { profile_picture_url: input.profilePictureUrl } : {}),
        },
      ],
    });
  }

  const userId = String((user as { id?: string }).id ?? "").trim() || null;
  let primaryWallet = extractPrimaryPrivyWallet(user);

  if (!primaryWallet?.walletAddress && userId) {
    const createdWallet = await privy.wallets().create({
      chain_type: "ethereum",
      owner: { user_id: userId },
      "privy-idempotency-key": `twitter-wallet:${input.subject}`,
    });
    primaryWallet = {
      walletAddress: normalizeAddress(createdWallet.address),
      walletId: createdWallet.id,
    };
  }

  if (!primaryWallet?.walletAddress || !isAddress(primaryWallet.walletAddress)) {
    return null;
  }

  const { identities } = await getCollections();
  await identities.updateOne(
    { subject: input.subject },
    {
      $set: {
        username: input.username,
        usernameLower: normalizeTwitterUsername(input.username),
        name: input.name,
        profilePictureUrl: input.profilePictureUrl,
        description: null,
        privyUserId: userId,
        walletAddress: primaryWallet.walletAddress,
        walletId: primaryWallet.walletId ?? null,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  return {
    userId,
    walletAddress: primaryWallet.walletAddress,
    walletId: primaryWallet.walletId ?? null,
  };
}

export async function resolveTwitterRecipientByUsername(
  username: string,
  options?: { actorUserId?: string | null }
) {
  const cleaned = normalizeTwitterUsername(username);
  if (!cleaned) return null;

  let identity = await getTwitterIdentityByUsername(cleaned);
  if (!identity) {
    const profile = await fetchTwitterUserByUsername(cleaned, options);
    if (!profile) return null;
    identity = await getTwitterIdentityByUsername(cleaned);
  }

  if (!identity) return null;

  if (identity.walletAddress && isAddress(identity.walletAddress)) {
    return {
      address: identity.walletAddress,
      username: identity.username,
      source: "twitter" as const,
    };
  }

  const wallet = await ensureTwitterUserWalletRecord({
    subject: identity.subject,
    username: identity.username,
    name: identity.name ?? identity.username,
    profilePictureUrl: identity.profilePictureUrl ?? null,
  });

  if (!wallet?.walletAddress) return null;

  return {
    address: wallet.walletAddress,
    username: identity.username,
    source: "twitter" as const,
  };
}

export async function fetchTwitterFollowingForUser(input: {
  userId: string;
  subject: string;
  limit?: number;
}) {
  return fetchTwitterGraphForUser({
    ...input,
    kind: "following",
    path: "following",
  });
}

export async function fetchTwitterFollowersForUser(input: {
  userId: string;
  subject: string;
  limit?: number;
}) {
  return fetchTwitterGraphForUser({
    ...input,
    kind: "followers",
    path: "followers",
  });
}

async function fetchTwitterGraphForUser(input: {
  userId: string;
  subject: string;
  limit?: number;
  kind: "following" | "followers";
  path: "following" | "followers";
}) {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const { followingCache } = await getCollections();
  const cached = await followingCache.findOne({
    userId: input.userId,
    subject: input.subject,
    limit,
    kind: input.kind,
    expiresAt: { $gt: new Date() },
  });
  if (cached?.profiles?.length) {
    return cached.profiles;
  }

  const oauth = await getTwitterOAuthDocForUser(input.userId);
  const results: TwitterIdentityProfile[] = [];
  let nextToken: string | undefined;
  let userAccessToken = oauth?.accessToken ?? null;

  do {
    let response: XFollowListResponse;
    try {
      response = await xFetchJson<XFollowListResponse>(
        `users/${encodeURIComponent(input.subject)}/${input.path}`,
        {
          searchParams: {
            "user.fields": "profile_image_url",
            max_results: String(Math.min(100, limit - results.length)),
            ...(nextToken ? { pagination_token: nextToken } : {}),
          },
          userAccessToken,
        }
      );
    } catch (error) {
      if (!userAccessToken) {
        throw error;
      }

      userAccessToken = null;
      response = await xFetchJson<XFollowListResponse>(
        `users/${encodeURIComponent(input.subject)}/${input.path}`,
        {
          searchParams: {
            "user.fields": "profile_image_url",
            max_results: String(Math.min(100, limit - results.length)),
            ...(nextToken ? { pagination_token: nextToken } : {}),
          },
        },
      );
    }

    const page = Array.isArray(response?.data) ? response.data : [];
    for (const entry of page) {
      if (!entry?.id || !entry?.username || !entry?.name) continue;
      results.push({
        subject: entry.id,
        username: entry.username,
        name: entry.name,
        profilePictureUrl: entry.profile_image_url ?? null,
      });
      if (results.length >= limit) break;
    }

    nextToken = response?.meta?.next_token;
  } while (nextToken && results.length < limit);

  const now = new Date();
  await followingCache.updateOne(
    { userId: input.userId, subject: input.subject, limit, kind: input.kind },
    {
      $set: {
        userId: input.userId,
        subject: input.subject,
        limit,
        kind: input.kind,
        profiles: results.map((profile) => ({
          subject: profile.subject,
          username: profile.username,
          name: profile.name,
          profilePictureUrl: profile.profilePictureUrl ?? null,
        })),
        updatedAt: now,
        expiresAt: new Date(now.getTime() + TWITTER_FOLLOWING_CACHE_TTL_MS),
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return results;
}
