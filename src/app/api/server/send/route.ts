import { randomUUID } from "crypto";
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
import { hasValidInternalSecret, requireTrustedRequest } from "@/lib/security";
import { getPrivyServerClient } from "@/lib/privy-server";
import { getPrivyAuthedUserFromAuthorization } from "@/lib/user-profile";
import { getNextDayUtc, getStartOfDayUtc } from "@/lib/agent-access";
import { tokenList } from "@/lib/tokens";
import { resolveRecipient } from "@/lib/recipient-resolver";
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
};

function normalizeAddress(value?: string | null) {
  return value ? value.toLowerCase() : null;
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

function getLinkedEthereumAddresses(accounts: LinkedAccountLike[]) {
  return new Set(
    accounts
      .filter(
        (account) =>
          account.type === "wallet" &&
          (account.chain_type === "ethereum" || account.chainType === "ethereum")
      )
      .map((account) => normalizeAddress(account.address))
      .filter((value): value is string => Boolean(value))
  );
}

function getTokenMeta(token: string) {
  return tokenList.find((entry) => entry.name.toUpperCase() === token.toUpperCase());
}

function parseAmount(input: unknown) {
  if (typeof input === "number") return input;
  if (typeof input !== "string") return Number.NaN;
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  return Number(cleaned);
}

function formatAmountForDecimals(amount: number, decimals: number) {
  const precision = Math.min(Math.max(decimals, 0), 8);
  const fixed = amount.toFixed(precision);
  return fixed.replace(/\.?0+$/, "");
}

async function getDailyUsedTotal(userId: string) {
  const client = await clientPromise;
  const db = client.db();
  const settlements = db.collection("a-server-settlement");
  const transfers = db.collection("a-server-transfer");
  const start = getStartOfDayUtc();
  const end = getNextDayUtc();

  const aggregateTotal = async (collectionName: "settlements" | "transfers") => {
    const collection =
      collectionName === "settlements" ? settlements : transfers;
    const result = await collection
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
  };

  const [settlementsTotal, transfersTotal] = await Promise.all([
    aggregateTotal("settlements"),
    aggregateTotal("transfers"),
  ]);

  return settlementsTotal + transfersTotal;
}

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "server-send",
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
  let identityToken: string | null = authed.ok ? authed.token : null;
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
        // fall through and return original auth error below
      }
    }
  }

  if (!userId) return authed.ok ? Response.json({ error: "Invalid user" }, { status: 401 }) : authed.response;

  const client = await clientPromise;
  const db = client.db();
  const policies = db.collection<AgentPolicyDoc>("a-server-access");
  const transfers = db.collection("a-server-transfer");

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
  if (!sourceWalletAddress || !isAddress(sourceWalletAddress)) {
    return Response.json(
      { error: "Delegated wallet is invalid. Re-enable server access." },
      { status: 400 }
    );
  }

  let delegatedWalletId =
    typeof policy.walletId === "string" && policy.walletId ? policy.walletId : null;
  const linkedAddresses = getLinkedEthereumAddresses(linkedAccounts);

  const delegatedWallet = findEmbeddedEthereumWallet(
    linkedAccounts,
    sourceWalletAddress
  );
  if (!delegatedWallet || !delegatedWallet.delegated) {
    return Response.json(
      { error: "Delegated wallet not found. Re-enable server access." },
      { status: 403 }
    );
  }

  delegatedWalletId = delegatedWalletId ?? delegatedWallet.id ?? null;
  if (!delegatedWalletId) {
    return Response.json(
      { error: "Missing delegated wallet id. Re-enable server access." },
      { status: 400 }
    );
  }

  if (policy.expiresAt && new Date(policy.expiresAt).getTime() < Date.now()) {
    return Response.json(
      { error: "Server access expired. Renew permissions in Profile." },
      { status: 403 }
    );
  }

  const requestedToken = String(body?.token ?? "").toUpperCase().trim();
  const allowedToken = String(policy.allowedToken ?? "USDC").toUpperCase();
  const tokenSymbol = requestedToken || allowedToken;

  if (tokenSymbol !== allowedToken) {
    return Response.json(
      { error: `Policy only allows ${policy.allowedToken}` },
      { status: 403 }
    );
  }

  const tokenMeta = getTokenMeta(tokenSymbol);
  if (!tokenMeta) {
    return Response.json({ error: "Unsupported token" }, { status: 400 });
  }

  const parsedAmount = parseAmount(body?.amount);
  const roundedAmount = Number(
    parsedAmount.toFixed(tokenSymbol === "ETH" ? 6 : 2)
  );

  if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }

  const maxPerPayment = Number(policy.maxPerPayment ?? 0);
  const dailyCap = Number(policy.dailyCap ?? 0);
  if (roundedAmount > maxPerPayment) {
    return Response.json(
      { error: `Amount exceeds your per-payment limit ($${maxPerPayment})` },
      { status: 403 }
    );
  }

  const dailyUsed = await getDailyUsedTotal(userId);
  if (dailyUsed + roundedAmount > dailyCap) {
    return Response.json(
      { error: `Daily cap exceeded ($${dailyCap})` },
      { status: 403 }
    );
  }

  const recipient = String(body?.recipient ?? "").trim();
  const recipientResolved = await resolveRecipient({
    recipient,
    recipientAddress:
      typeof body?.recipientAddress === "string"
        ? body.recipientAddress
        : undefined,
    recipientUsername:
      typeof body?.recipientUsername === "string"
        ? body.recipientUsername
        : undefined,
    recipientEns:
      typeof body?.recipientEns === "string" ? body.recipientEns : undefined,
  });

  if (!recipientResolved?.address || !isAddress(recipientResolved.address)) {
    return Response.json(
      { error: "Unable to resolve recipient wallet address" },
      { status: 400 }
    );
  }

  const recipientAddress = recipientResolved.address.toLowerCase();
  if (recipientAddress === sourceWalletAddress || linkedAddresses.has(recipientAddress)) {
    return Response.json(
      { error: "Recipient cannot be one of your own wallets" },
      { status: 400 }
    );
  }

  const requestId =
    (typeof body?.requestId === "string" && body.requestId.trim()) || randomUUID();

  const existing = await transfers.findOne({
    userId,
    requestId,
    status: { $in: ["pending", "success"] },
  });

  if (existing) {
    return Response.json(
      {
        error:
          existing.status === "success"
            ? "Transfer already completed"
            : "Transfer is already pending",
        requestId,
        txHash: existing.txHash ?? null,
      },
      { status: 409 }
    );
  }

  // Prefer the existing working app key first to avoid mismatched signer setups.
  const authorizationPrivateKey =
    process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY?.trim() ||
    process.env.PRIVY_SERVER_AUTHORIZATION_PRIVATE_KEY?.trim();

  const authorizationContext =
    authorizationPrivateKey || identityToken
      ? {
          ...(authorizationPrivateKey
            ? { authorization_private_keys: [authorizationPrivateKey] }
            : {}),
          ...(identityToken ? { user_jwts: [identityToken] } : {}),
        }
      : undefined;

  const now = new Date();
  const day = getStartOfDayUtc();
  const transferInsert = await transfers.insertOne({
    userId,
    requestId,
    sourceWalletAddress,
    recipientAddress,
    recipientUsername: recipientResolved.username,
    recipientResolutionSource: recipientResolved.source,
    recipientInput: recipient,
    token: tokenSymbol,
    amount: roundedAmount,
    note: typeof body?.note === "string" ? body.note : null,
    status: "pending",
    day,
    createdAt: now,
    updatedAt: now,
    executionMode: "user_session",
  });

  const amountForChain = formatAmountForDecimals(
    roundedAmount,
    tokenMeta.decimals ?? 18
  );
  const rawAmount = parseUnits(amountForChain, tokenMeta.decimals ?? 18);
  const idempotencyKey = `server-send:${userId}:${requestId}`;

  try {
    const txData =
      tokenMeta.address === undefined
        ? await privy.wallets().ethereum().sendTransaction(delegatedWalletId!, {
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
        : await privy.wallets().ethereum().sendTransaction(delegatedWalletId!, {
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

    await transfers.updateOne(
      { _id: transferInsert.insertedId },
      {
        $set: {
          status: "success",
          txHash: hash,
          updatedAt: new Date(),
        },
      }
    );

    const executionMode = "user_session";
    const activityTimestamp = new Date();

    // Sender-side activity record for activity/notifications feed.
    void writeActivity({
      address: sourceWalletAddress,
      type: "bill_paid",
      refType: "transfer",
      refId: requestId,
      amount: roundedAmount,
      token: tokenSymbol,
      txHash: hash,
      executionMode,
      recipientResolutionSource: recipientResolved.source,
      note: typeof body?.note === "string" ? body.note.trim() || null : null,
      counterparty: {
        address: recipientAddress,
        name: recipientResolved.username ?? undefined,
      },
      timestamp: activityTimestamp,
    });

    // Recipient-side activity record (if recipient uses Tab with this wallet).
    void writeActivity({
      address: recipientAddress,
      type: "bill_received",
      refType: "transfer",
      refId: requestId,
      amount: roundedAmount,
      token: tokenSymbol,
      txHash: hash,
      executionMode,
      note: typeof body?.note === "string" ? body.note.trim() || null : null,
      counterparty: {
        address: sourceWalletAddress,
      },
      timestamp: activityTimestamp,
    });

    return Response.json({
      success: true,
      requestId,
      txHash: hash,
      amount: roundedAmount,
      token: tokenSymbol,
      recipientAddress,
      recipientUsername: recipientResolved.username,
      recipientResolutionSource: recipientResolved.source,
      sentFrom: sourceWalletAddress,
      executionMode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transfer failed";
    const needsDelegation =
      /key quorum|authorized entity|not part of a key quorum|user key|session signer/i.test(
        message
      );

    await transfers.updateOne(
      { _id: transferInsert.insertedId },
      {
        $set: {
          status: "failed",
          error: message,
          updatedAt: new Date(),
        },
      }
    );

    if (needsDelegation) {
      return Response.json(
        {
          error:
            "Delegated wallet authorization is missing. Enable server access and try again.",
          code: "DELEGATION_REQUIRED",
          requestId,
        },
        { status: 403 }
      );
    }

    return Response.json(
      {
        error: message || "Server transfer failed",
        requestId,
      },
      { status: 500 }
    );
  }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server send failed";
    const isMongoInfraError =
      /Mongo|ReplicaSetNoPrimary|server selection timed out|ECONN|topology/i.test(message);

    return Response.json(
      {
        error: isMongoInfraError
          ? "Tab is temporarily unable to send payments (database unavailable). Please retry in a moment."
          : "Tab hit an internal error while preparing the payment. Please retry.",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: isMongoInfraError ? 503 : 500 }
    );
  }
}
