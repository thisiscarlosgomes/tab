import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import clientPromise from "@/lib/mongodb";
import { requireTrustedRequest } from "@/lib/security";
import { getBearerToken, getPrivyServerClient } from "@/lib/privy-server";
import { resolveRecipient } from "@/lib/recipient-resolver";
import { tokenList } from "@/lib/tokens";
import { writeActivity } from "@/lib/writeActivity";

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

type AgentLinkDoc = {
  userId?: string;
  agentId?: string;
  status?: string;
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

function getServiceAgentKey(req: NextRequest) {
  const provided = req.headers.get("x-agent-key")?.trim();
  const expected = process.env.AGENT_EXECUTOR_KEY?.trim();
  if (!provided || !expected) return false;
  return provided === expected;
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
    bucket: "agent-split-create",
    limit: 20,
    windowMs: 60_000,
  });
  if (denied && !(denied.status === 403 && getServiceAgentKey(req))) {
    return denied;
  }

  const body = await req.json().catch(() => ({}));
  const identityToken = getBearerToken(req.headers.get("authorization"));
  const isServiceAgentRequest = !identityToken && getServiceAgentKey(req);
  const serviceAgentId = isServiceAgentRequest
    ? String(body?.agentId ?? "").trim()
    : null;

  if (!identityToken && !isServiceAgentRequest) {
    return Response.json(
      { error: "Missing identity token or agent credentials" },
      { status: 401 }
    );
  }

  let userId = "";
  let linkedAccounts: LinkedAccountLike[] = [];
  const privy = getPrivyServerClient();

  if (identityToken) {
    let user: unknown;
    try {
      user = await privy.users().get({ id_token: identityToken });
    } catch {
      try {
        const verified = await privy.utils().auth().verifyAccessToken(identityToken);
        user = await privy.users()._get(verified.user_id);
      } catch {
        return Response.json({ error: "Invalid auth token" }, { status: 401 });
      }
    }

    userId = String((user as { id?: string }).id ?? "").trim();
    if (!userId) return Response.json({ error: "Invalid user" }, { status: 401 });
    linkedAccounts = toLinkedAccounts(user);
  } else {
    userId = String(body?.userId ?? "").trim();
    if (!userId) {
      return Response.json(
        { error: "Missing userId for service agent request" },
        { status: 400 }
      );
    }
  }

  const client = await clientPromise;
  const db = client.db();
  const links = db.collection<AgentLinkDoc>("a-agent-links");
  const policies = db.collection<AgentPolicyDoc>("a-agent-access");
  const splitCollection = db.collection<SplitBillDoc>("a-split-bill");

  if (isServiceAgentRequest) {
    if (!serviceAgentId) {
      return Response.json(
        { error: "Missing agentId for service agent request" },
        { status: 400 }
      );
    }

    const link = await links.findOne({
      userId,
      agentId: serviceAgentId,
      status: "ACTIVE",
    });
    if (!link) {
      return Response.json(
        { error: "Agent is not linked to this Tab account" },
        { status: 403 }
      );
    }
  }

  const policy = await policies.findOne(
    {
      userId,
      status: "ACTIVE",
      delegated: true,
    },
    { sort: { updatedAt: -1, createdAt: -1 } }
  );

  if (!policy) {
    return Response.json({ error: "Agent Access is not active" }, { status: 403 });
  }

  const sourceWalletAddress = normalizeAddress(policy.address);
  if (!sourceWalletAddress) {
    return Response.json(
      { error: "Agent Access wallet is invalid. Re-enable in Profile." },
      { status: 400 }
    );
  }

  if (identityToken) {
    const delegatedWallet = findEmbeddedEthereumWallet(linkedAccounts, sourceWalletAddress);
    if (!delegatedWallet || !delegatedWallet.delegated) {
      return Response.json(
        { error: "Delegated wallet not found. Re-enable Agent Access." },
        { status: 403 }
      );
    }
  }

  if (policy.expiresAt && new Date(policy.expiresAt).getTime() < Date.now()) {
    return Response.json(
      { error: "Agent Access expired. Renew permissions in Profile." },
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

  const splitUrl = `${getPublicBaseUrl(req)}/split/${splitId}`;

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
}
