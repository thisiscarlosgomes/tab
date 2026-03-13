import { NextRequest } from "next/server";
import { isAddress } from "viem";
import clientPromise from "@/lib/mongodb";
import { requireTrustedRequest } from "@/lib/security";
import {
  DEFAULT_AGENT_POLICY,
  getNextDayUtc,
  getPolicyExpiry,
  getStartOfDayUtc,
  type AgentAccessStatus,
} from "@/lib/agent-access";
import { getBearerToken, getPrivyServerClient } from "@/lib/privy-server";

type LinkedAccountLike = {
  type?: string;
  chain_type?: string;
  wallet_client_type?: string;
  chainType?: string;
  walletClientType?: string;
  address?: string;
  delegated?: boolean;
  id?: string | null;
  fid?: number | string;
  subject?: string;
  username?: string;
};

function normalizeAddress(value: string) {
  return value.toLowerCase();
}

function toLinkedAccounts(user: unknown): LinkedAccountLike[] {
  if (!user || typeof user !== "object") return [];
  const maybeAccounts =
    (user as { linked_accounts?: unknown; linkedAccounts?: unknown })
      .linked_accounts ??
    (user as { linked_accounts?: unknown; linkedAccounts?: unknown })
      .linkedAccounts;
  if (!Array.isArray(maybeAccounts)) return [];
  return maybeAccounts as LinkedAccountLike[];
}

function findEmbeddedEthereumWallet(
  accounts: LinkedAccountLike[],
  address: string
) {
  const normalized = normalizeAddress(address);
  return accounts.find(
    (account) =>
      account.type === "wallet" &&
      (account.chain_type === "ethereum" || account.chainType === "ethereum") &&
      (account.wallet_client_type === "privy" ||
        account.walletClientType === "privy") &&
      typeof account.address === "string" &&
      normalizeAddress(account.address) === normalized
  );
}

function findDelegatedPrivyWallet(accounts: LinkedAccountLike[]) {
  return accounts.find(
    (account) =>
      account.type === "wallet" &&
      (account.chain_type === "ethereum" || account.chainType === "ethereum") &&
      (account.wallet_client_type === "privy" ||
        account.walletClientType === "privy") &&
      account.delegated &&
      typeof account.address === "string"
  );
}

function normalizeFid(value?: number | string) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function findFarcasterFid(accounts: LinkedAccountLike[]) {
  const farcaster = accounts.find((account) => account.type === "farcaster");
  return normalizeFid(farcaster?.fid);
}

function findTwitterAccount(accounts: LinkedAccountLike[]) {
  const twitter = accounts.find((account) => account.type === "twitter_oauth");
  if (!twitter || typeof twitter.subject !== "string" || !twitter.subject.trim()) {
    return null;
  }

  return {
    subject: twitter.subject.trim(),
    username:
      typeof twitter.username === "string" && twitter.username.trim()
        ? twitter.username.trim()
        : null,
  };
}

function parsePolicyIds(raw: string | undefined) {
  if (!raw) return [] as string[];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildSignerConfigs() {
  const pairs = [
    {
      signerId: process.env.PRIVY_AGENT_SIGNER_ID?.trim(),
      policyIds: parsePolicyIds(process.env.PRIVY_AGENT_POLICY_IDS),
    },
    {
      signerId: process.env.PRIVY_SERVER_SIGNER_ID?.trim(),
      policyIds: parsePolicyIds(process.env.PRIVY_SERVER_POLICY_IDS),
    },
  ].filter((entry): entry is { signerId: string; policyIds: string[] } => Boolean(entry.signerId));

  const dedup = new Map<string, string[]>();
  for (const entry of pairs) {
    const prev = dedup.get(entry.signerId) ?? [];
    const merged = Array.from(new Set([...prev, ...entry.policyIds]));
    dedup.set(entry.signerId, merged);
  }

  return Array.from(dedup.entries()).map(([signerId, policyIds]) => ({
    signer_id: signerId,
    ...(policyIds.length > 0 ? { override_policy_ids: policyIds } : {}),
  }));
}

async function maybeConfigureAgentSigner({
  walletId,
  userJwt,
}: {
  walletId: string;
  userJwt: string | null;
}) {
  const additionalSigners = buildSignerConfigs();

  if (additionalSigners.length === 0) return;
  if (!userJwt) {
    throw new Error("Missing identity token for signer configuration");
  }

  const privy = getPrivyServerClient();
  await privy.wallets().update(walletId, {
    additional_signers: additionalSigners,
    authorization_context: {
      user_jwts: [userJwt],
    },
  });
}

async function requirePrivyUser(req: NextRequest) {
  const token = getBearerToken(req.headers.get("authorization"));
  if (!token) {
    return {
      error: Response.json({ error: "Missing identity token" }, { status: 401 }),
      user: null,
      linkedAccounts: [] as LinkedAccountLike[],
    };
  }

  try {
    const privy = getPrivyServerClient();
    const user = await privy.users().get({ id_token: token });
    const linkedAccounts = toLinkedAccounts(user);
    return { error: null, user, linkedAccounts };
  } catch {
    try {
      const privy = getPrivyServerClient();
      const verified = await privy.utils().auth().verifyAccessToken(token);
      const user = await privy.users()._get(verified.user_id);
      const linkedAccounts = toLinkedAccounts(user);
      return { error: null, user, linkedAccounts };
    } catch {
      return {
        error: Response.json({ error: "Invalid auth token" }, { status: 401 }),
        user: null,
        linkedAccounts: [] as LinkedAccountLike[],
      };
    }
  }
}

function toNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function getDailyUsed(userId: string) {
  const client = await clientPromise;
  const db = client.db();
  const settlements = db.collection("a-agent-settlement");
  const start = getStartOfDayUtc();
  const end = getNextDayUtc();
  const result = await settlements
    .aggregate([
      {
        $match: {
          userId,
          createdAt: { $gte: start, $lt: end },
          status: { $in: ["pending", "success"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();

  return Number(result[0]?.total ?? 0);
}

export async function GET(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "agent-access-get",
    limit: 80,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  const rawAddress = req.nextUrl.pathname.split("/").pop();
  if (!rawAddress) {
    return Response.json({ error: "Invalid address" }, { status: 400 });
  }

  const { error, user, linkedAccounts } = await requirePrivyUser(req);
  if (error) return error;

  const userId = (user as { id?: string }).id;
  if (!userId) {
    return Response.json({ error: "Invalid user" }, { status: 401 });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-agent-access");

  if (rawAddress === "me") {
    const activePolicy = await collection.findOne(
      {
        userId,
        status: "ACTIVE",
        delegated: true,
      },
      { sort: { updatedAt: -1, createdAt: -1 } }
    );
    const latestPolicy =
      activePolicy ??
      (await collection.findOne(
        { userId },
        { sort: { updatedAt: -1, createdAt: -1 } }
      ));

    const delegatedWallet = findDelegatedPrivyWallet(linkedAccounts);
    const dailyUsed = await getDailyUsed(userId);

    if (!latestPolicy) {
      return Response.json({
        address:
          typeof delegatedWallet?.address === "string"
            ? normalizeAddress(delegatedWallet.address)
            : null,
        walletId: delegatedWallet?.id ?? null,
        enabled: false,
        delegated: Boolean(delegatedWallet?.delegated),
        status: "PAUSED",
        allowedToken: DEFAULT_AGENT_POLICY.allowedToken,
        maxPerPayment: DEFAULT_AGENT_POLICY.maxPerPayment,
        dailyCap: DEFAULT_AGENT_POLICY.dailyCap,
        recipientMode: DEFAULT_AGENT_POLICY.recipientMode,
        expiresAt: getPolicyExpiry(DEFAULT_AGENT_POLICY.expiresInDays)?.toISOString(),
        dailyUsed,
        nextResetAt: getNextDayUtc().toISOString(),
      });
    }

    return Response.json({
      address: latestPolicy.address ?? null,
      walletId: latestPolicy.walletId ?? null,
      enabled: latestPolicy.status === "ACTIVE",
      delegated: Boolean(latestPolicy.delegated),
      status: latestPolicy.status,
      allowedToken: latestPolicy.allowedToken,
      maxPerPayment: latestPolicy.maxPerPayment,
      dailyCap: latestPolicy.dailyCap,
      recipientMode: latestPolicy.recipientMode,
      expiresAt: latestPolicy.expiresAt
        ? new Date(latestPolicy.expiresAt).toISOString()
        : null,
      dailyUsed,
      nextResetAt: getNextDayUtc().toISOString(),
    });
  }

  if (!isAddress(rawAddress)) {
    return Response.json({ error: "Invalid address" }, { status: 400 });
  }
  const address = normalizeAddress(rawAddress);

  const embeddedWallet = findEmbeddedEthereumWallet(linkedAccounts, address);
  if (!embeddedWallet) {
    return Response.json({ error: "Wallet not linked to this user" }, { status: 403 });
  }

  const existing = await collection.findOne({ address, userId });
  const dailyUsed = await getDailyUsed(userId);

  if (!existing) {
    return Response.json({
      address,
      walletId: embeddedWallet.id ?? null,
      enabled: false,
      delegated: Boolean(embeddedWallet.delegated),
      status: "PAUSED",
      allowedToken: DEFAULT_AGENT_POLICY.allowedToken,
      maxPerPayment: DEFAULT_AGENT_POLICY.maxPerPayment,
      dailyCap: DEFAULT_AGENT_POLICY.dailyCap,
      recipientMode: DEFAULT_AGENT_POLICY.recipientMode,
      expiresAt: getPolicyExpiry(DEFAULT_AGENT_POLICY.expiresInDays)?.toISOString(),
      dailyUsed,
      nextResetAt: getNextDayUtc().toISOString(),
    });
  }

  return Response.json({
    address: existing.address ?? address,
    walletId: existing.walletId ?? embeddedWallet.id ?? null,
    enabled: existing.status === "ACTIVE",
    delegated: Boolean(existing.delegated),
    status: existing.status,
    allowedToken: existing.allowedToken,
    maxPerPayment: existing.maxPerPayment,
    dailyCap: existing.dailyCap,
    recipientMode: existing.recipientMode,
    expiresAt: existing.expiresAt ? new Date(existing.expiresAt).toISOString() : null,
    dailyUsed,
    nextResetAt: getNextDayUtc().toISOString(),
  });
}

export async function PUT(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "agent-access-put",
    limit: 40,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  const rawAddress = req.nextUrl.pathname.split("/").pop();
  if (!rawAddress || !isAddress(rawAddress)) {
    return Response.json({ error: "Invalid address" }, { status: 400 });
  }
  const address = normalizeAddress(rawAddress);

  const { error, user, linkedAccounts } = await requirePrivyUser(req);
  if (error) return error;

  const userId = (user as { id?: string }).id;
  if (!userId) {
    return Response.json({ error: "Invalid user" }, { status: 401 });
  }

  const embeddedWallet = findEmbeddedEthereumWallet(linkedAccounts, address);
  if (!embeddedWallet) {
    return Response.json({ error: "Wallet not linked to this user" }, { status: 403 });
  }
  const farcasterFid = findFarcasterFid(linkedAccounts);
  const twitter = findTwitterAccount(linkedAccounts);

  const body = await req.json().catch(() => ({}));
  const statusInput = String(body?.status ?? "PAUSED").toUpperCase();
  const status: AgentAccessStatus =
    statusInput === "ACTIVE" || statusInput === "REVOKED" ? statusInput : "PAUSED";

  const allowedToken = String(
    body?.allowedToken ?? DEFAULT_AGENT_POLICY.allowedToken
  ).toUpperCase();
  const maxPerPayment = Math.max(
    0.01,
    toNumber(body?.maxPerPayment, DEFAULT_AGENT_POLICY.maxPerPayment)
  );
  const dailyCap = Math.max(
    0.01,
    toNumber(body?.dailyCap, DEFAULT_AGENT_POLICY.dailyCap)
  );
  const expiresInDays = Math.max(
    0,
    Math.floor(toNumber(body?.expiresInDays, DEFAULT_AGENT_POLICY.expiresInDays))
  );
  const recipientMode = "split_participants";
  const expiresAt = getPolicyExpiry(expiresInDays);

  if (status === "ACTIVE" && !embeddedWallet.delegated) {
    return Response.json(
      { error: "Delegate wallet access first" },
      { status: 400 }
    );
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-agent-access");
  const now = new Date();

  await collection.updateOne(
    { address, userId },
    {
      $set: {
        userId,
        address,
        farcasterFid,
        twitterSubject: twitter?.subject ?? null,
        twitterUsername: twitter?.username ?? null,
        walletId: embeddedWallet.id ?? null,
        delegated: Boolean(embeddedWallet.delegated),
        status,
        allowedToken,
        maxPerPayment,
        dailyCap,
        recipientMode,
        expiresAt,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return Response.json({ success: true });
}

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "agent-access-post",
    limit: 30,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  const rawAddress = req.nextUrl.pathname.split("/").pop();
  if (!rawAddress || !isAddress(rawAddress)) {
    return Response.json({ error: "Invalid address" }, { status: 400 });
  }
  const address = normalizeAddress(rawAddress);
  const identityToken = getBearerToken(req.headers.get("authorization"));

  const { error, user, linkedAccounts } = await requirePrivyUser(req);
  if (error) return error;

  const userId = (user as { id?: string }).id;
  if (!userId) {
    return Response.json({ error: "Invalid user" }, { status: 401 });
  }

  const embeddedWallet = findEmbeddedEthereumWallet(linkedAccounts, address);
  if (!embeddedWallet) {
    return Response.json({ error: "Wallet not linked to this user" }, { status: 403 });
  }
  const farcasterFid = findFarcasterFid(linkedAccounts);
  const twitter = findTwitterAccount(linkedAccounts);

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "").toLowerCase();

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-agent-access");
  const now = new Date();

  if (action === "delegate") {
    if (!embeddedWallet.delegated || !embeddedWallet.id) {
      return Response.json(
        { error: "Delegation not detected yet. Complete Privy delegation first." },
        { status: 400 }
      );
    }

    try {
      await maybeConfigureAgentSigner({
        walletId: embeddedWallet.id,
        userJwt: identityToken,
      });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to configure signer policy",
        },
        { status: 500 }
      );
    }

    const existing = await collection.findOne({ address, userId });
    const maxPerPayment = Math.max(
      0.01,
      toNumber(existing?.maxPerPayment, DEFAULT_AGENT_POLICY.maxPerPayment)
    );
    const dailyCap = Math.max(
      0.01,
      toNumber(existing?.dailyCap, DEFAULT_AGENT_POLICY.dailyCap)
    );

    await collection.updateOne(
      { address, userId },
      {
        $set: {
          userId,
          address,
          farcasterFid,
          twitterSubject: twitter?.subject ?? null,
          twitterUsername: twitter?.username ?? null,
          walletId: embeddedWallet.id,
          delegated: true,
          status: "ACTIVE",
          allowedToken:
            existing?.allowedToken ?? DEFAULT_AGENT_POLICY.allowedToken,
          maxPerPayment,
          dailyCap,
          recipientMode:
            existing?.recipientMode ?? DEFAULT_AGENT_POLICY.recipientMode,
          expiresAt:
            existing?.expiresAt ??
            getPolicyExpiry(DEFAULT_AGENT_POLICY.expiresInDays),
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    return Response.json({ success: true });
  }

  if (action === "revoke") {
    await collection.updateOne(
      { address, userId },
      {
        $set: {
          delegated: false,
          walletId: null,
          status: "PAUSED",
          updatedAt: now,
        },
      }
    );
    return Response.json({ success: true });
  }

  return Response.json({ error: "Unsupported action" }, { status: 400 });
}
