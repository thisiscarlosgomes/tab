import { NextRequest } from "next/server";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  isAddress,
  parseUnits,
} from "viem";
import { base } from "viem/chains";
import clientPromise from "@/lib/mongodb";
import { requireTrustedRequest } from "@/lib/security";
import { getBearerToken, getPrivyServerClient } from "@/lib/privy-server";
import { buildUserKey } from "@/lib/identity";
import { tokenList } from "@/lib/tokens";
import { writeActivity } from "@/lib/writeActivity";
import { getNextDayUtc, getStartOfDayUtc } from "@/lib/agent-access";

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
  username?: string;
};

type SplitUserLike = {
  address?: string | null;
  fid?: number | string | null;
  userKey?: string | null;
  name?: string;
  pfp?: string;
  amount?: number;
};

type SplitBillDoc = {
  splitId: string;
  invited?: SplitUserLike[];
  paid?: SplitUserLike[];
  recipient?: SplitUserLike;
  totalAmount?: number;
  numPeople?: number;
  token?: string;
  description?: string;
};

type AgentPolicyDoc = {
  _id: unknown;
  userId?: string;
  address?: string;
  walletId?: string | null;
  delegated?: boolean;
  status?: string;
  expiresAt?: Date | string | null;
  allowedToken?: string;
  maxPerPayment?: number;
  dailyCap?: number;
  farcasterFid?: number | string | null;
};

type AgentLinkDoc = {
  userId?: string;
  agentId?: string;
  status?: string;
};

function normalizeAddress(value?: string | null) {
  return value ? value.toLowerCase() : null;
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
  return accounts.find((account) => account.type === "farcaster");
}

function keyOf(entry?: SplitUserLike | null) {
  if (!entry) return null;
  if (entry.userKey) return entry.userKey.toLowerCase();
  const generated = buildUserKey({
    fid: entry.fid,
    address: normalizeAddress(entry.address),
  });
  return generated?.toLowerCase() ?? null;
}

function sameUser(a?: SplitUserLike | null, b?: SplitUserLike | null) {
  const aAddress = normalizeAddress(a?.address);
  const bAddress = normalizeAddress(b?.address);
  if (aAddress && bAddress && aAddress === bAddress) return true;

  const aKey = keyOf(a);
  const bKey = keyOf(b);
  if (aKey && bKey && aKey === bKey) return true;

  const aFid = normalizeFid(a?.fid);
  const bFid = normalizeFid(b?.fid);
  if (aFid !== null && bFid !== null && aFid === bFid) return true;

  return false;
}

function getTokenMeta(token: string) {
  return tokenList.find((t) => t.name.toUpperCase() === token.toUpperCase());
}

function getLinkedEthereumAddresses(accounts: LinkedAccountLike[]) {
  return new Set(
    accounts
      .filter(
        (account) =>
          account.type === "wallet" && account.chain_type === "ethereum"
      )
      .map((account) => normalizeAddress(account.address))
      .filter((value): value is string => Boolean(value))
  );
}

function getServiceAgentKey(req: NextRequest) {
  const provided = req.headers.get("x-agent-key")?.trim();
  const expected = process.env.AGENT_EXECUTOR_KEY?.trim();
  if (!provided || !expected) return false;
  return provided === expected;
}

function extractSplitIdFromUrl(raw: unknown) {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";

  try {
    const parsed = new URL(value);
    const parts = parsed.pathname
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    const splitIndex = parts.findIndex((part) => part.toLowerCase() === "split");
    if (splitIndex >= 0 && parts[splitIndex + 1]) {
      return parts[splitIndex + 1].toLowerCase();
    }
  } catch {
    // ignore and try regex fallback
  }

  const match = value.match(/\/split\/([a-zA-Z0-9_-]+)/);
  if (!match) return "";
  return String(match[1] ?? "").toLowerCase().trim();
}

function extractSplitCodeFromUrl(raw: unknown) {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";

  try {
    const parsed = new URL(value);
    const code = parsed.searchParams.get("code");
    if (code) return code.toLowerCase().trim();
  } catch {
    // ignore and try regex fallback
  }

  const queryMatch = value.match(/[?&]code=([a-zA-Z0-9_-]+)/i);
  if (!queryMatch) return "";
  return String(queryMatch[1] ?? "").toLowerCase().trim();
}

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "agent-settle",
    limit: 20,
    windowMs: 60_000,
  });
  if (denied && !(denied.status === 403 && getServiceAgentKey(req))) return denied;

  const body = await req.json().catch(() => ({}));
  const splitIdInput = String(body?.splitId ?? "").toLowerCase().trim();
  const splitCodeInput = String(body?.splitCode ?? "").toLowerCase().trim();
  const splitUrlInput = String(body?.splitUrl ?? "").trim();
  const splitIdFromUrl = extractSplitIdFromUrl(splitUrlInput);
  const splitCodeFromUrl = extractSplitCodeFromUrl(splitUrlInput);
  let splitId = splitIdInput || splitIdFromUrl;
  const effectiveSplitCode = splitCodeInput || splitCodeFromUrl;

  if (!splitId && !effectiveSplitCode) {
    return Response.json(
      { error: "Missing split identifier (splitId, splitCode, or splitUrl)" },
      { status: 400 }
    );
  }

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
    if (!userId) {
      return Response.json({ error: "Invalid user" }, { status: 401 });
    }
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
  const settlements = db.collection("a-agent-settlement");
  const splitCollection = db.collection("a-split-bill");

  if (!splitId && effectiveSplitCode) {
    const billByCode = await splitCollection.findOne(
      { code: effectiveSplitCode },
      { projection: { splitId: 1 } }
    );
    splitId = String(
      (billByCode as { splitId?: string } | null)?.splitId ?? ""
    )
      .toLowerCase()
      .trim();
    if (!splitId) {
      return Response.json({ error: "Split not found for provided code" }, { status: 404 });
    }
  }

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
  if (!sourceWalletAddress || !isAddress(sourceWalletAddress)) {
    return Response.json(
      { error: "Agent Access wallet is invalid. Re-enable in Profile." },
      { status: 400 }
    );
  }

  let delegatedWalletId =
    typeof policy.walletId === "string" && policy.walletId ? policy.walletId : null;

  let actorFid = normalizeFid(policy.farcasterFid ?? null);
  const linkedAddresses = getLinkedEthereumAddresses(linkedAccounts);

  if (identityToken) {
    const delegatedWallet = findEmbeddedEthereumWallet(
      linkedAccounts,
      sourceWalletAddress
    );

    if (!delegatedWallet || !delegatedWallet.delegated) {
      return Response.json(
        { error: "Delegated wallet not found. Re-enable Agent Access." },
        { status: 403 }
      );
    }

    delegatedWalletId = delegatedWalletId ?? delegatedWallet.id ?? null;
    if (!delegatedWalletId) {
      return Response.json({ error: "Missing delegated wallet id" }, { status: 400 });
    }

    const farcaster = findFarcasterAccount(linkedAccounts);
    actorFid = normalizeFid(farcaster?.fid);
    if (actorFid === null) {
      return Response.json(
        { error: "Link Farcaster before using Agent Access" },
        { status: 403 }
      );
    }

    if (
      policy.walletId !== delegatedWalletId ||
      policy.delegated !== Boolean(delegatedWallet.delegated) ||
      policy.farcasterFid !== actorFid
    ) {
      await policies.updateOne(
        { _id: policy._id },
        {
          $set: {
            walletId: delegatedWalletId,
            delegated: Boolean(delegatedWallet.delegated),
            farcasterFid: actorFid,
            updatedAt: new Date(),
          },
        }
      );
    }
  } else {
    if (!delegatedWalletId) {
      return Response.json(
        { error: "Missing delegated wallet id. Re-enable Agent Access." },
        { status: 400 }
      );
    }

    if (actorFid === null) {
      return Response.json(
        {
          error:
            "Farcaster link missing for this policy. Re-save Agent Access from user session.",
        },
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

  const split = (await splitCollection.findOne({ splitId })) as SplitBillDoc | null;
  if (!split) {
    return Response.json({ error: "Split not found" }, { status: 404 });
  }

  const invited = Array.isArray(split.invited) ? split.invited : [];
  const paid = Array.isArray(split.paid) ? split.paid : [];

  const invitedEntry = invited.find((entry) => {
    const entryFid = normalizeFid(entry.fid);
    const entryAddress = normalizeAddress(entry.address);
    return (
      (actorFid !== null && entryFid !== null && actorFid === entryFid) ||
      (entryAddress
        ? linkedAddresses.has(entryAddress) || entryAddress === sourceWalletAddress
        : false)
    );
  });

  if (!invitedEntry) {
    return Response.json(
      { error: "You are not an eligible debtor for this split" },
      { status: 403 }
    );
  }

  const debtorAddress = normalizeAddress(invitedEntry.address) ?? sourceWalletAddress;
  if (!isAddress(debtorAddress)) {
    return Response.json({ error: "Invalid debtor identity" }, { status: 400 });
  }

  const debtorFid = normalizeFid(invitedEntry.fid) ?? actorFid;
  const debtorUserKey =
    invitedEntry.userKey ??
    buildUserKey({ fid: debtorFid, address: debtorAddress }) ??
    null;

  const debtorIdentity: SplitUserLike = {
    address: debtorAddress,
    fid: debtorFid,
    userKey: debtorUserKey,
    name:
      invitedEntry.name ??
      `${debtorAddress.slice(0, 6)}...${debtorAddress.slice(-4)}`,
  };

  if (sameUser(split.recipient, debtorIdentity)) {
    return Response.json({ error: "Recipient cannot settle this split" }, { status: 400 });
  }

  const alreadyPaid = paid.some((entry) => sameUser(entry, debtorIdentity));
  if (alreadyPaid) {
    return Response.json({ error: "This split is already paid" }, { status: 409 });
  }

  const tokenSymbol = String(split.token ?? "USDC").toUpperCase();
  if (String(policy.allowedToken ?? "USDC").toUpperCase() !== tokenSymbol) {
    return Response.json(
      { error: `Policy only allows ${policy.allowedToken}` },
      { status: 403 }
    );
  }

  const fallbackAmount =
    Number(split.totalAmount ?? 0) > 0 && Number(split.numPeople ?? 0) > 0
      ? Number(split.totalAmount) / Number(split.numPeople)
      : 0;

  const amount = Number(
    Number(invitedEntry.amount ?? fallbackAmount).toFixed(tokenSymbol === "ETH" ? 6 : 2)
  );
  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: "Invalid split amount" }, { status: 400 });
  }

  const maxPerPayment = Number(policy.maxPerPayment ?? 0);
  const dailyCap = Number(policy.dailyCap ?? 0);
  if (amount > maxPerPayment) {
    return Response.json(
      { error: `Amount exceeds your per-payment limit ($${maxPerPayment})` },
      { status: 403 }
    );
  }

  const day = getStartOfDayUtc();
  const nextDay = getNextDayUtc();
  const spendingAgg = await settlements
    .aggregate([
      {
        $match: {
          userId,
          createdAt: { $gte: day, $lt: nextDay },
          status: { $in: ["pending", "success"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();

  const dailyUsed = Number(spendingAgg[0]?.total ?? 0);
  if (dailyUsed + amount > dailyCap) {
    return Response.json(
      { error: `Daily cap exceeded ($${dailyCap})` },
      { status: 403 }
    );
  }

  const existingSettlement = await settlements.findOne({
    splitId,
    userId,
    status: { $in: ["pending", "success"] },
  });
  if (existingSettlement) {
    return Response.json(
      { error: "Settlement is already in progress or completed" },
      { status: 409 }
    );
  }

  const recipientAddress = normalizeAddress(split.recipient?.address);
  if (!recipientAddress || !isAddress(recipientAddress)) {
    return Response.json({ error: "Invalid split recipient" }, { status: 400 });
  }

  const tokenMeta = getTokenMeta(tokenSymbol);
  if (!tokenMeta) {
    return Response.json({ error: "Unsupported split token" }, { status: 400 });
  }

  const authorizationPrivateKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY?.trim();
  if (!identityToken && !authorizationPrivateKey) {
    return Response.json(
      {
        error:
          "Missing PRIVY_AUTHORIZATION_PRIVATE_KEY for autonomous agent execution",
      },
      { status: 500 }
    );
  }

  const authorizationContext =
    authorizationPrivateKey || identityToken
      ? {
          ...(authorizationPrivateKey
            ? { authorization_private_keys: [authorizationPrivateKey] }
            : {}),
          ...(identityToken ? { user_jwts: [identityToken] } : {}),
        }
      : undefined;

  const settlementInsert = await settlements.insertOne({
    userId,
    agentId: serviceAgentId,
    splitId,
    payerAddress: debtorAddress,
    sourceWalletAddress,
    recipientAddress,
    token: tokenSymbol,
    amount,
    day,
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    executionMode: identityToken ? "user_session" : "service_agent",
  });

  const idempotencyKey = `agent-settle:${splitId}:${userId}`;

  try {
    const rawAmount = parseUnits(amount.toString(), tokenMeta.decimals ?? 18);

    const txData =
      tokenMeta.address === undefined
        ? await privy.wallets().ethereum().sendTransaction(delegatedWalletId, {
            caip2: "eip155:8453",
            idempotency_key: idempotencyKey,
            authorization_context: authorizationContext,
            params: {
              transaction: {
                to: recipientAddress,
                value: rawAmount.toString(),
                chain_id: 8453,
              },
            },
          })
        : await privy.wallets().ethereum().sendTransaction(delegatedWalletId, {
            caip2: "eip155:8453",
            idempotency_key: idempotencyKey,
            authorization_context: authorizationContext,
            params: {
              transaction: {
                to: tokenMeta.address,
                data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: "transfer",
                  args: [recipientAddress as `0x${string}`, rawAmount],
                }),
                value: 0,
                chain_id: 8453,
              },
            },
          });

    const hash = txData.hash;

    const rpcUrl =
      process.env.ALCHEMY_URL ??
      process.env.NEXT_PUBLIC_ALCHEMY_URL ??
      "https://mainnet.base.org";

    const publicClient = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: hash as `0x${string}`,
    });

    if (receipt.status !== "success") {
      throw new Error("Transaction failed onchain");
    }

    await splitCollection.updateOne(
      { splitId, "paid.address": { $ne: debtorAddress } },
      {
        $push: {
          paid: {
            address: debtorAddress,
            fid: debtorFid ?? null,
            userKey: debtorUserKey,
            name: debtorIdentity.name,
            txHash: hash,
            token: tokenSymbol,
            amount,
            timestamp: new Date(),
          },
        },
      }
    );

    void writeActivity({
      address: debtorAddress,
      type: "bill_paid",
      refType: "bill",
      refId: splitId,
      amount,
      token: tokenSymbol,
      txHash: hash,
      executionMode: identityToken ? "user_session" : "service_agent",
      agentId: serviceAgentId,
      counterparty: {
        address: recipientAddress,
        name: split.recipient?.name,
        pfp: split.recipient?.pfp,
      },
      timestamp: new Date(),
    });

    void writeActivity({
      address: recipientAddress,
      type: "bill_received",
      refType: "bill",
      refId: splitId,
      amount,
      token: tokenSymbol,
      txHash: hash,
      executionMode: identityToken ? "user_session" : "service_agent",
      agentId: serviceAgentId,
      counterparty: {
        address: debtorAddress,
        name: debtorIdentity.name,
      },
      timestamp: new Date(),
    });

    await settlements.updateOne(
      { _id: settlementInsert.insertedId },
      {
        $set: {
          status: "success",
          txHash: hash,
          updatedAt: new Date(),
        },
      }
    );

    return Response.json({
      success: true,
      txHash: hash,
      amount,
      token: tokenSymbol,
      payerAddress: debtorAddress,
      settledFrom: sourceWalletAddress,
      executionMode: identityToken ? "user_session" : "service_agent",
    });
  } catch (error) {
    await settlements.updateOne(
      { _id: settlementInsert.insertedId },
      {
        $set: {
          status: "failed",
          error: error instanceof Error ? error.message : "Settlement failed",
          updatedAt: new Date(),
        },
      }
    );

    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Agent settlement failed",
      },
      { status: 500 }
    );
  }
}
