import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import clientPromise from "@/lib/mongodb";
import { hasValidInternalSecret, requireTrustedRequest } from "@/lib/security";
import { getPrivyAuthedUserFromAuthorization } from "@/lib/user-profile";
import { getPrivyServerClient } from "@/lib/privy-server";
import { resolveRecipient } from "@/lib/recipient-resolver";
import { tokenList } from "@/lib/tokens";
import { writeActivity } from "@/lib/writeActivity";
import { sendWebNotificationToUser } from "@/lib/user-notifications";

type LinkedAccountLike = {
  type?: string;
  chain_type?: string;
  wallet_client_type?: string;
  chainType?: string;
  walletClientType?: string;
  address?: string;
  delegated?: boolean;
  id?: string | null;
  fid?: number | string | null;
  username?: string | null;
};

type AgentPolicyDoc = {
  _id: unknown;
  userId?: string;
  address?: string;
  walletId?: string | null;
  delegated?: boolean;
  status?: string;
  expiresAt?: Date | string | null;
  farcasterFid?: number | string | null;
};

type SplitUserLike = {
  address?: string | null;
  fid?: number | string | null;
  name?: string;
  pfp?: string | null;
  amount?: number;
};

type SplitBillDoc = {
  splitId: string;
  code: string;
  creator: SplitUserLike;
  recipient: SplitUserLike;
  description: string;
  totalAmount: number;
  token: string;
  participants: SplitUserLike[];
  invited: SplitUserLike[];
  paid: SplitUserLike[];
  splitType: "invited";
  invitedOnly: true;
  createdAt: Date;
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
      normalizeAddress(account.address) === normalized
  );
}

function findFarcasterAccount(accounts: LinkedAccountLike[]) {
  return accounts.find((account) => account.type === "farcaster") ?? null;
}

function parseAmount(input: unknown) {
  if (typeof input === "number") return input;
  if (typeof input !== "string") return Number.NaN;
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  return Number(cleaned);
}

function getTokenMeta(token: string) {
  return tokenList.find((entry) => entry.name.toUpperCase() === token.toUpperCase());
}

function getPublicBaseUrl(req: NextRequest) {
  return (
    process.env.PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_URL?.trim() ||
    req.nextUrl.origin
  ).replace(/\/$/, "");
}

function generateCode() {
  const words = ["pizza", "lunch", "bill", "tab", "night", "trip", "meal"];
  const randomWord = words[Math.floor(Math.random() * words.length)];
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `${randomWord}-${randomSuffix}`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "server-split-create",
    limit: 20,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    let authed = await getPrivyAuthedUserFromAuthorization(
      req.headers.get("authorization")
    );
    const privy = getPrivyServerClient();
    let userId = authed.ok ? String(authed.user.id ?? "").trim() : "";
    let linkedAccounts = authed.ok
      ? (authed.linkedAccounts as LinkedAccountLike[])
      : [];

    if (!authed.ok && hasValidInternalSecret(req)) {
      const forwardedUserId = String(req.headers.get("x-tab-user-id") ?? "").trim();
      if (forwardedUserId) {
        try {
          const user = await privy.users()._get(forwardedUserId);
          userId = String((user as { id?: string }).id ?? "").trim();
          linkedAccounts = toLinkedAccounts(user);
        } catch {
          // fall through and use auth error below
        }
      }
    }

    if (!userId) return authed.ok ? Response.json({ error: "Invalid user" }, { status: 401 }) : authed.response;

  const client = await clientPromise;
  const db = client.db();
  const policies = db.collection<AgentPolicyDoc>("a-server-access");
  const splitCollection = db.collection<SplitBillDoc>("a-split-bill");

  const policy = await policies.findOne(
    {
      userId,
      status: "ACTIVE",
      delegated: true,
    },
    { sort: { updatedAt: -1, createdAt: -1 } }
  );

  if (!policy) {
    return Response.json({ error: "Server access is not active" }, { status: 403 });
  }

  const sourceWalletAddress = normalizeAddress(policy.address);
  if (!sourceWalletAddress) {
    return Response.json(
      { error: "Server access wallet is invalid. Re-enable in Profile." },
      { status: 400 }
    );
  }

  const delegatedWallet = findEmbeddedEthereumWallet(linkedAccounts, sourceWalletAddress);
  if (!delegatedWallet || !delegatedWallet.delegated) {
    return Response.json(
      { error: "Delegated wallet not found. Re-enable server access." },
      { status: 403 }
    );
  }

  if (policy.expiresAt && new Date(policy.expiresAt).getTime() < Date.now()) {
    return Response.json(
      { error: "Server access expired. Renew permissions in Profile." },
      { status: 403 }
    );
  }

  const amountInput = parseAmount(body?.amount);
  const tokenSymbol = String(body?.token ?? "USDC").toUpperCase().trim();
  const tokenMeta = getTokenMeta(tokenSymbol);

  if (!tokenMeta) {
    return Response.json({ error: "Unsupported token" }, { status: 400 });
  }

  const totalAmount = Number(amountInput.toFixed(tokenSymbol === "ETH" ? 6 : 2));
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }

  const rawUsers: string[] = Array.isArray(body?.users)
    ? body.users.filter((v: unknown): v is string => typeof v === "string")
    : Array.isArray(body?.participants)
      ? body.participants.filter((v: unknown): v is string => typeof v === "string")
      : [];
  const userTags = uniqueStrings(
    rawUsers.map((v) => (v.startsWith("@") ? v : `@${v}`))
  );

  if (userTags.length === 0) {
    return Response.json(
      { error: "Provide at least one Farcaster username in users[]" },
      { status: 400 }
    );
  }

  if (userTags.length > 20) {
    return Response.json({ error: "Too many users (max 20)" }, { status: 400 });
  }

  const resolved = await Promise.all(
    userTags.map(async (tag) => ({ tag, resolved: await resolveRecipient({ recipient: tag }) }))
  );

  const unresolved = resolved.filter((r) => !r.resolved?.address).map((r) => r.tag);
  if (unresolved.length > 0) {
    return Response.json(
      { error: "Could not resolve one or more users", unresolved },
      { status: 400 }
    );
  }

  const invitedDedup = new Map<
    string,
    { address: string; username: string | null; fid: number | null }
  >();

  for (const entry of resolved) {
    const recipient = entry.resolved!;
    const key = recipient.fid ? `fid:${recipient.fid}` : `wallet:${recipient.address}`;
    invitedDedup.set(key, {
      address: recipient.address.toLowerCase(),
      username: recipient.username ?? entry.tag.replace(/^@/, ""),
      fid: recipient.fid ?? null,
    });
  }

  const invitedUsers = Array.from(invitedDedup.values()).filter(
    (u) => u.address !== sourceWalletAddress
  );

  if (invitedUsers.length === 0) {
    return Response.json(
      { error: "No eligible users to split with (self was excluded)" },
      { status: 400 }
    );
  }

  const creatorFarcaster = findFarcasterAccount(linkedAccounts);
  const creatorFid =
    normalizeFid(creatorFarcaster?.fid) ?? normalizeFid(policy.farcasterFid ?? null);
  const creatorUsername =
    typeof creatorFarcaster?.username === "string" && creatorFarcaster.username
      ? creatorFarcaster.username
      : null;

  const creator: SplitUserLike = {
    address: sourceWalletAddress,
    fid: creatorFid,
    name: creatorUsername ?? sourceWalletAddress.slice(0, 6),
  };

  const perPersonAmount = totalAmount / invitedUsers.length;
  const descriptionInput =
    typeof body?.description === "string" ? body.description.trim() : "";
  const description =
    descriptionInput ||
    `Split ${totalAmount} ${tokenSymbol} with ${invitedUsers.length} ${
      invitedUsers.length === 1 ? "person" : "people"
    }`;

  let splitId = nanoid().toLowerCase();
  while (await splitCollection.findOne({ splitId })) {
    splitId = nanoid().toLowerCase();
  }

  let code = generateCode();
  while (await splitCollection.findOne({ code })) {
    code = generateCode();
  }

  const createdAt = new Date();
  const doc: SplitBillDoc = {
    splitId,
    code,
    creator,
    recipient: creator,
    description,
    totalAmount,
    token: tokenSymbol,
    participants: [],
    invited: invitedUsers.map((user) => ({
      fid: user.fid,
      address: user.address,
      name: user.username ?? user.address.slice(0, 6),
      amount: perPersonAmount,
    })),
    paid: [],
    createdAt,
    splitType: "invited",
    invitedOnly: true,
  };

  await splitCollection.insertOne(doc);

  void writeActivity({
    address: sourceWalletAddress,
    type: "bill_created",
    refType: "bill",
    refId: splitId,
    timestamp: createdAt,
  });

  for (const invitedUser of invitedUsers) {
    if (!invitedUser.address) continue;
    void writeActivity({
      address: invitedUser.address,
      type: "bill_invited",
      refType: "bill",
      refId: splitId,
      counterparty: {
        address: sourceWalletAddress,
        name: creator.name,
      },
      timestamp: createdAt,
    });
  }

  const splitUrl = `${getPublicBaseUrl(req)}/split/${splitId}`;

  // Best-effort invite notifications for users who already have web push enabled.
  const creatorLabel =
    typeof creator.name === "string" && creator.name.trim()
      ? creator.name.trim().replace(/^@+/, "")
      : "Someone";
  void Promise.allSettled(
    invitedUsers.map((user) =>
      sendWebNotificationToUser(
        {
          fid: user.fid,
          address: user.address,
        },
        {
          title: "Split invite",
          body: `@${creatorLabel} invited you to split "${description}" (${perPersonAmount.toFixed(
            tokenSymbol === "ETH" ? 4 : 2
          )} ${tokenSymbol} each)`,
          url: splitUrl,
          tag: `split-invite-${splitId}`,
        }
      )
    )
  ).catch(() => {});

  return Response.json({
      success: true,
      splitId,
      splitCode: code,
      splitUrl,
      amount: totalAmount,
      currency: tokenSymbol,
      description,
      users: invitedUsers.map((user) => ({
        username: user.username,
        fid: user.fid,
        address: user.address,
        amount: perPersonAmount,
      })),
      confirmation: {
        amount: totalAmount,
        currency: tokenSymbol,
        url: splitUrl,
        users: invitedUsers.map((u) => `@${u.username ?? "user"}`),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server split create failed";
    const isMongoInfraError =
      /Mongo|ReplicaSetNoPrimary|server selection timed out|ECONN|topology/i.test(
        message
      );

    return Response.json(
      {
        error: isMongoInfraError
          ? "Tab is temporarily unable to create splits (database unavailable). Please retry in a moment."
          : "Tab hit an internal error while creating the split. Please retry.",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: isMongoInfraError ? 503 : 500 }
    );
  }
}
