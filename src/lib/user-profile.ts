import clientPromise from "@/lib/mongodb";
import { neynarApi } from "@/lib/neynar";
import { getBearerToken, getPrivyServerClient } from "@/lib/privy-server";

type LinkedAccountLike = {
  type?: string;
  chain_type?: string;
  wallet_client_type?: string;
  chainType?: string;
  walletClientType?: string;
  address?: string;
  fid?: number | string;
};

type PrivyUserLike = {
  id?: string;
  farcaster?: {
    fid?: number | string | null;
    username?: string | null;
    displayName?: string | null;
    display_name?: string | null;
    pfp?: string | null;
    pfpUrl?: string | null;
  } | null;
  linked_accounts?: unknown;
  linkedAccounts?: unknown;
};

export type UserProfileDoc = {
  userId: string;
  fid: number | null;
  username: string | null;
  usernameLower: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  primaryAddress: string | null;
  usernameSource: "farcaster";
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt: Date;
};

let ensureUserProfileIndexesPromise: Promise<void> | null = null;

function normalizeAddress(value?: string | null) {
  return typeof value === "string" && value ? value.toLowerCase() : null;
}

function ensureUserProfileIndexes(
  collection: import("mongodb").Collection<UserProfileDoc>
) {
  if (!ensureUserProfileIndexesPromise) {
    ensureUserProfileIndexesPromise = (async () => {
      await collection.createIndexes([
        { key: { userId: 1 }, unique: true },
        { key: { fid: 1 } },
        { key: { usernameLower: 1 } },
      ]);
    })().catch(() => {
      ensureUserProfileIndexesPromise = null;
    });
  }
  return ensureUserProfileIndexesPromise;
}

function toLinkedAccounts(user: unknown): LinkedAccountLike[] {
  if (!user || typeof user !== "object") return [];
  const maybeAccounts =
    (user as PrivyUserLike).linked_accounts ?? (user as PrivyUserLike).linkedAccounts;
  return Array.isArray(maybeAccounts) ? (maybeAccounts as LinkedAccountLike[]) : [];
}

function normalizeFid(value?: number | string | null) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function findFarcasterAccount(accounts: LinkedAccountLike[]) {
  return accounts.find((account) => account.type === "farcaster") ?? null;
}

function findFarcasterFid(user: PrivyUserLike, accounts: LinkedAccountLike[]) {
  return (
    normalizeFid(user?.farcaster?.fid) ??
    normalizeFid(findFarcasterAccount(accounts)?.fid) ??
    null
  );
}

function findPrimaryPrivyWalletAddress(accounts: LinkedAccountLike[]) {
  const wallet = accounts.find(
    (account) =>
      account.type === "wallet" &&
      (account.chain_type === "ethereum" || account.chainType === "ethereum") &&
      (account.wallet_client_type === "privy" || account.walletClientType === "privy") &&
      typeof account.address === "string"
  );
  return normalizeAddress(wallet?.address);
}

async function lookupNeynarProfile(fid: number) {
  try {
    const res = await neynarApi.fetchBulkUsers({ fids: [fid] });
    const user = (Array.isArray(res.users) ? res.users[0] : null) as
      | {
          username?: string | null;
          display_name?: string | null;
          displayName?: string | null;
          pfp_url?: string | null;
          pfp?: { url?: string | null } | null;
        }
      | null;
    if (!user) return null;

    const pfpUrl =
      typeof user.pfp_url === "string"
        ? user.pfp_url
        : typeof user.pfp?.url === "string"
          ? user.pfp.url
          : null;

    return {
      username: typeof user.username === "string" ? user.username : null,
      displayName:
        typeof user.display_name === "string"
          ? user.display_name
          : typeof user.displayName === "string"
            ? user.displayName
            : null,
      pfpUrl,
    };
  } catch {
    return null;
  }
}

export async function getPrivyAuthedUserFromAuthorization(
  authorizationHeader: string | null
): Promise<
  | { ok: true; token: string; user: PrivyUserLike; linkedAccounts: LinkedAccountLike[] }
  | { ok: false; response: Response }
> {
  const token = getBearerToken(authorizationHeader);
  if (!token) {
    return {
      ok: false,
      response: Response.json({ error: "Missing identity token" }, { status: 401 }),
    };
  }

  try {
    const privy = getPrivyServerClient();
    const user = (await privy.users().get({ id_token: token })) as PrivyUserLike;
    return { ok: true, token, user, linkedAccounts: toLinkedAccounts(user) };
  } catch {
    try {
      const privy = getPrivyServerClient();
      const verified = await privy.utils().auth().verifyAccessToken(token);
      const user = (await privy.users()._get(verified.user_id)) as PrivyUserLike;
      return { ok: true, token, user, linkedAccounts: toLinkedAccounts(user) };
    } catch {
      return {
        ok: false,
        response: Response.json({ error: "Invalid auth token" }, { status: 401 }),
      };
    }
  }
}

function sanitizeProfile(doc: UserProfileDoc) {
  return {
    userId: doc.userId,
    fid: doc.fid,
    username: doc.username,
    displayName: doc.displayName,
    pfpUrl: doc.pfpUrl,
    primaryAddress: doc.primaryAddress,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastSyncedAt: doc.lastSyncedAt,
  };
}

export async function syncCanonicalUserProfileFromPrivyUser(input: {
  user: PrivyUserLike;
  linkedAccounts: LinkedAccountLike[];
}) {
  const userId = typeof input.user.id === "string" ? input.user.id : null;
  if (!userId) {
    return {
      ok: false as const,
      response: Response.json({ error: "Invalid user" }, { status: 401 }),
    };
  }

  const fid = findFarcasterFid(input.user, input.linkedAccounts);
  if (!fid) {
    return {
      ok: false as const,
      response: Response.json({ error: "Farcaster link required" }, { status: 403 }),
    };
  }

  const neynarProfile = await lookupNeynarProfile(fid);
  const privyFarcaster = input.user.farcaster ?? null;
  const username =
    neynarProfile?.username ??
    (typeof privyFarcaster?.username === "string" ? privyFarcaster.username : null);
  const displayName =
    neynarProfile?.displayName ??
    (typeof privyFarcaster?.displayName === "string"
      ? privyFarcaster.displayName
      : typeof privyFarcaster?.display_name === "string"
        ? privyFarcaster.display_name
        : username);
  const pfpUrl =
    neynarProfile?.pfpUrl ??
    (typeof privyFarcaster?.pfpUrl === "string"
      ? privyFarcaster.pfpUrl
      : typeof privyFarcaster?.pfp === "string"
        ? privyFarcaster.pfp
        : null);
  const usernameLower = typeof username === "string" ? username.toLowerCase() : null;
  const primaryAddress = findPrimaryPrivyWalletAddress(input.linkedAccounts);

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<UserProfileDoc>("a-user-profile");
  await ensureUserProfileIndexes(collection);
  const now = new Date();

  await collection.updateOne(
    { userId },
    {
      $set: {
        fid,
        username,
        usernameLower,
        displayName,
        pfpUrl,
        primaryAddress,
        usernameSource: "farcaster",
        updatedAt: now,
        lastSyncedAt: now,
      },
      $setOnInsert: {
        userId,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  const profile = await collection.findOne({ userId });
  if (!profile) {
    return {
      ok: false as const,
      response: Response.json({ error: "Failed to persist profile" }, { status: 500 }),
    };
  }

  return {
    ok: true as const,
    profile: sanitizeProfile(profile),
  };
}

export async function getCanonicalUserProfileByUserId(userId: string) {
  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<UserProfileDoc>("a-user-profile");
  await ensureUserProfileIndexes(collection);
  const profile = await collection.findOne({ userId });
  return profile ? sanitizeProfile(profile) : null;
}

export async function getCanonicalUserProfileByUsername(username: string) {
  const normalized = username.trim().replace(/^@/, "").toLowerCase();
  if (!normalized) return null;

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<UserProfileDoc>("a-user-profile");
  await ensureUserProfileIndexes(collection);
  const profile = await collection.findOne({ usernameLower: normalized });
  return profile ? sanitizeProfile(profile) : null;
}

export async function getCanonicalUserProfileByFid(fid: number) {
  const normalizedFid = Number(fid);
  if (!Number.isFinite(normalizedFid) || normalizedFid <= 0) return null;

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<UserProfileDoc>("a-user-profile");
  await ensureUserProfileIndexes(collection);
  const profile = await collection.findOne({ fid: normalizedFid });
  return profile ? sanitizeProfile(profile) : null;
}

export async function getCanonicalUserProfileByAddress(address: string) {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection<UserProfileDoc>("a-user-profile");
  await ensureUserProfileIndexes(collection);
  const profile = await collection.findOne({ primaryAddress: normalized });
  return profile ? sanitizeProfile(profile) : null;
}
