import { NextRequest } from "next/server";
import { formatEther, formatUnits, keccak256, stringToHex } from "viem";
import clientPromise from "@/lib/mongodb";
import {
  sendWebPushNotification,
  type StoredWebPushSubscription,
} from "@/lib/web-push";

type MoralisErc20Transfer = {
  transactionHash?: string;
  hash?: string;
  logIndex?: number | string;
  to?: string;
  toAddress?: string;
  from?: string;
  fromAddress?: string;
  value?: string | number;
  amount?: string | number;
  decimals?: string | number;
  tokenDecimals?: string | number;
  symbol?: string;
  tokenSymbol?: string;
  tokenName?: string;
  chainId?: string | number;
};

type MoralisNativeTx = {
  hash?: string;
  transactionHash?: string;
  to?: string;
  toAddress?: string;
  from?: string;
  fromAddress?: string;
  value?: string | number;
  chainId?: string | number;
};

type MoralisStreamsPayload = {
  confirmed?: boolean;
  chainId?: string | number;
  erc20Transfers?: MoralisErc20Transfer[];
  txs?: MoralisNativeTx[];
  txsInternal?: unknown[];
  logs?: unknown[];
  abi?: unknown;
  retries?: number;
  tag?: string;
};

type MoralisLogLike = {
  transactionHash?: string;
  hash?: string;
  logIndex?: number | string;
  address?: string;
  contract?: string;
  data?: string;
  topic0?: string;
  topic1?: string;
  topic2?: string;
  topic3?: string;
  topics?: string[];
  decodedEvent?: {
    label?: string;
    signature?: string;
    params?: Array<{ name?: string; value?: unknown }>;
  } | null;
};

type WebPushSubscriptionDoc = {
  userId: string;
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
  enabled: boolean;
  addresses?: string[];
};

type PushDedupeDoc = {
  _id: string;
  createdAt: Date;
  chainId: string;
  txHash: string;
  kind: "erc20_received" | "eth_received";
  to: string;
  endpointHash: string;
};

const ERC20_TRANSFER_TOPIC0 = keccak256(stringToHex("Transfer(address,address,uint256)"));

const KNOWN_BASE_ERC20S: Record<
  string,
  { symbol: string; decimals: number; name?: string }
> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": { symbol: "EURC", decimals: 6, name: "EURC" },
};

function normalizeAddress(value?: string | null) {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

function getMoralisSignature(req: NextRequest) {
  return (
    req.headers.get("x-signature") ??
    req.headers.get("X-Signature") ??
    req.headers.get("x-moralis-signature")
  );
}

function verifyMoralisSignature(rawBody: string, signature: string | null) {
  if (!signature) return false;
  const provided = signature.trim().toLowerCase();
  const secrets = Array.from(
    new Set(
      [
        process.env.MORALIS_STREAMS_SECRET?.trim(),
        process.env.MORALIS_API_KEY?.trim(),
      ].filter((v): v is string => Boolean(v))
    )
  );
  if (secrets.length === 0) return false;

  return secrets.some((secret) => {
    const expected = keccak256(stringToHex(`${rawBody}${secret}`)).toLowerCase();
    return expected === provided;
  });
}

function isLikelyMoralisValidationProbe(payload: MoralisStreamsPayload, rawBody: string) {
  const trimmed = rawBody.trim();
  if (!trimmed || trimmed === "{}") return true;

  const erc20Count = Array.isArray(payload.erc20Transfers) ? payload.erc20Transfers.length : 0;
  const txCount = Array.isArray(payload.txs) ? payload.txs.length : 0;
  const internalTxCount = Array.isArray(payload.txsInternal) ? payload.txsInternal.length : 0;
  const logCount = Array.isArray(payload.logs) ? payload.logs.length : 0;

  // Moralis stream creation/update sends a webhook validation request; treat empty/no-event bodies as probes.
  return erc20Count === 0 && txCount === 0 && internalTxCount === 0 && logCount === 0;
}

function normalizeChainId(value?: string | number | null) {
  if (typeof value === "number") return `0x${value.toString(16)}`.toLowerCase();
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith("0x")) return trimmed;
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum > 0) return `0x${asNum.toString(16)}`.toLowerCase();
  return trimmed;
}

function getConfiguredMoralisChainId() {
  const env = process.env.MORALIS_CHAIN?.trim();
  if (!env) return "0x2105"; // Base mainnet default
  if (env.toLowerCase() === "base") return "0x2105";
  return normalizeChainId(env) ?? "0x2105";
}

function toBigIntSafe(value: string | number | undefined, fallback = 0n) {
  try {
    if (typeof value === "number") return BigInt(Math.trunc(value));
    if (typeof value === "string" && value.trim()) return BigInt(value.trim());
    return fallback;
  } catch {
    return fallback;
  }
}

function toNumberSafe(value: string | number | undefined, fallback = 18) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function formatHumanAmount(value: bigint, decimals: number) {
  try {
    const text = formatUnits(value, decimals);
    return text.includes(".")
      ? text.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")
      : text;
  } catch {
    return value.toString();
  }
}

function shortAddress(addr: string) {
  return addr.length > 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function extractAddressFromTopic(topic?: string | null) {
  const value = typeof topic === "string" ? topic.trim().toLowerCase() : "";
  if (!value.startsWith("0x") || value.length < 42) return null;
  return normalizeAddress(`0x${value.slice(-40)}`);
}

function extractValueFromHexData(data?: string | null) {
  const value = typeof data === "string" ? data.trim() : "";
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function extractLogTransfer(log: MoralisLogLike): MoralisErc20Transfer | null {
  const txHash = (log.transactionHash ?? log.hash ?? "").trim();
  const logIndex = log.logIndex;
  const contract = normalizeAddress(log.address ?? log.contract);

  const decoded = log.decodedEvent;
  if (decoded && (decoded.label === "Transfer" || decoded.signature?.startsWith("Transfer("))) {
    const params = Array.isArray(decoded.params) ? decoded.params : [];
    const from = normalizeAddress(asString(params.find((p) => p.name === "from")?.value) ?? undefined);
    const to = normalizeAddress(asString(params.find((p) => p.name === "to")?.value) ?? undefined);
    const rawValue = params.find((p) => p.name === "value")?.value;
    const value =
      typeof rawValue === "string" || typeof rawValue === "number" ? rawValue : String(rawValue ?? "0");
    const tokenMeta = contract ? KNOWN_BASE_ERC20S[contract] : undefined;
    if (!to || !txHash) return null;
    return {
      transactionHash: txHash,
      logIndex,
      from: from ?? undefined,
      to,
      value,
      decimals: tokenMeta?.decimals,
      symbol: tokenMeta?.symbol,
      tokenName: tokenMeta?.name,
    };
  }

  const topics = Array.isArray(log.topics)
    ? log.topics
    : [log.topic0, log.topic1, log.topic2, log.topic3].filter((v): v is string => typeof v === "string");
  const topic0 = (topics[0] ?? log.topic0 ?? "").toLowerCase();
  if (topic0 !== ERC20_TRANSFER_TOPIC0.toLowerCase()) return null;

  const from = extractAddressFromTopic(topics[1] ?? log.topic1);
  const to = extractAddressFromTopic(topics[2] ?? log.topic2);
  const value = extractValueFromHexData(log.data);
  const tokenMeta = contract ? KNOWN_BASE_ERC20S[contract] : undefined;
  if (!to || !txHash) return null;

  return {
    transactionHash: txHash,
    logIndex,
    from: from ?? undefined,
    to,
    value: value.toString(),
    decimals: tokenMeta?.decimals,
    symbol: tokenMeta?.symbol,
    tokenName: tokenMeta?.name,
  };
}

async function sendToAddressSubscribers(args: {
  address: string;
  title: string;
  body: string;
  url?: string;
  tag: string;
  dedupeBase: string;
  chainId: string;
  txHash: string;
  kind: PushDedupeDoc["kind"];
}) {
  const client = await clientPromise;
  const db = client.db();
  const subs = db.collection<WebPushSubscriptionDoc>("a-web-push-subscriptions");
  const dedupe = db.collection<PushDedupeDoc>("a-web-push-dedupe");

  const subscriptions = await subs
    .find({ enabled: true, addresses: args.address })
    .toArray();

  let sent = 0;
  let skippedDuplicate = 0;
  let removed = 0;
  const errors: string[] = [];

  for (const sub of subscriptions) {
    const endpointHash = keccak256(stringToHex(sub.endpoint)).slice(2, 18);
    const dedupeId = `${args.dedupeBase}:${endpointHash}`;

    try {
      await dedupe.insertOne({
        _id: dedupeId,
        createdAt: new Date(),
        chainId: args.chainId,
        txHash: args.txHash,
        kind: args.kind,
        to: args.address,
        endpointHash,
      });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 11000) {
        skippedDuplicate += 1;
        continue;
      }
      throw error;
    }

    try {
      const target: StoredWebPushSubscription = {
        endpoint: sub.endpoint,
        expirationTime: sub.expirationTime ?? null,
        keys: sub.keys,
      };
      await sendWebPushNotification(target, {
        title: args.title,
        body: args.body,
        url: args.url ?? "/notifications",
        tag: args.tag,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { address: args.address, txHash: args.txHash },
      });
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await subs.updateOne(
          { endpoint: sub.endpoint, userId: sub.userId },
          { $set: { enabled: false, updatedAt: new Date() } as never }
        );
        removed += 1;
      } else {
        errors.push(error instanceof Error ? error.message : "Push send failed");
      }
    }
  }

  return { matched: subscriptions.length, sent, removed, skippedDuplicate, errors };
}

function buildErc20Notification(transfer: MoralisErc20Transfer) {
  const value = toBigIntSafe(transfer.value ?? transfer.amount, 0n);
  const decimals = toNumberSafe(transfer.decimals ?? transfer.tokenDecimals, 18);
  const amount = formatHumanAmount(value, decimals);
  const symbol = (transfer.symbol ?? transfer.tokenSymbol ?? "TOKEN").trim();
  const from = normalizeAddress(transfer.from ?? transfer.fromAddress);
  return {
    title: `Received ${amount} ${symbol}`,
    body: `Incoming transfer on Base${from ? ` from ${shortAddress(from)}` : ""}`,
  };
}

function buildEthNotification(tx: MoralisNativeTx) {
  const value = toBigIntSafe(tx.value, 0n);
  const amount = formatEther(value);
  const from = normalizeAddress(tx.from ?? tx.fromAddress);
  return {
    title: `Received ${amount} ETH`,
    body: `Incoming transfer on Base${from ? ` from ${shortAddress(from)}` : ""}`,
  };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = getMoralisSignature(req);

  let payload: MoralisStreamsPayload;
  try {
    payload = JSON.parse(rawBody) as MoralisStreamsPayload;
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!verifyMoralisSignature(rawBody, signature)) {
    if (isLikelyMoralisValidationProbe(payload, rawBody)) {
      return Response.json({ success: true, probe: true });
    }
    return Response.json({ error: "Invalid Moralis signature" }, { status: 401 });
  }

  // Moralis sends test webhooks and non-transfer payloads; acknowledge them.
  if (payload.confirmed !== true) {
    return Response.json({ success: true, skipped: "not_confirmed" });
  }

  const expectedChainId = getConfiguredMoralisChainId();
  const payloadChainId = normalizeChainId(payload.chainId);
  if (payloadChainId && payloadChainId !== expectedChainId) {
    return Response.json({
      success: true,
      skipped: "unsupported_chain",
      chainId: payloadChainId,
    });
  }

  let erc20Processed = 0;
  let logProcessed = 0;
  let nativeProcessed = 0;
  let sent = 0;
  let matchedSubscriptions = 0;
  let skippedDuplicate = 0;
  let removed = 0;
  const errors: string[] = [];

  for (const transfer of Array.isArray(payload.erc20Transfers) ? payload.erc20Transfers : []) {
    try {
      const to = normalizeAddress(transfer.to ?? transfer.toAddress);
      const txHash = (transfer.transactionHash ?? transfer.hash ?? "").trim();
      if (!to || !txHash) continue;

      const notification = buildErc20Notification(transfer);
      const logIndex = String(transfer.logIndex ?? "0");
      const res = await sendToAddressSubscribers({
        address: to,
        title: notification.title,
        body: notification.body,
        url: `/activity`,
        tag: `token-receive-${txHash}-${logIndex}`,
        dedupeBase: `erc20:${expectedChainId}:${txHash}:${logIndex}:${to}`,
        chainId: expectedChainId,
        txHash,
        kind: "erc20_received",
      });
      erc20Processed += 1;
      matchedSubscriptions += res.matched;
      sent += res.sent;
      skippedDuplicate += res.skippedDuplicate;
      removed += res.removed;
      errors.push(...res.errors);
    } catch (error) {
      errors.push(
        `erc20 transfer processing failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  for (const tx of Array.isArray(payload.txs) ? payload.txs : []) {
    try {
      const to = normalizeAddress(tx.to ?? tx.toAddress);
      const txHash = (tx.hash ?? tx.transactionHash ?? "").trim();
      const value = toBigIntSafe(tx.value, 0n);
      if (!to || !txHash || value <= 0n) continue;

      const notification = buildEthNotification(tx);
      const res = await sendToAddressSubscribers({
        address: to,
        title: notification.title,
        body: notification.body,
        url: `/activity`,
        tag: `eth-receive-${txHash}`,
        dedupeBase: `eth:${expectedChainId}:${txHash}:${to}`,
        chainId: expectedChainId,
        txHash,
        kind: "eth_received",
      });
      nativeProcessed += 1;
      matchedSubscriptions += res.matched;
      sent += res.sent;
      skippedDuplicate += res.skippedDuplicate;
      removed += res.removed;
      errors.push(...res.errors);
    } catch (error) {
      errors.push(
        `native tx processing failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  // Fallback for custom contract-event streams where Moralis provides `logs` but not `erc20Transfers`.
  if (erc20Processed === 0) {
    for (const rawLog of Array.isArray(payload.logs) ? payload.logs : []) {
      try {
        const transfer = extractLogTransfer((rawLog ?? {}) as MoralisLogLike);
        if (!transfer) continue;
        const to = normalizeAddress(transfer.to ?? transfer.toAddress);
        const txHash = (transfer.transactionHash ?? transfer.hash ?? "").trim();
        if (!to || !txHash) continue;

        const notification = buildErc20Notification(transfer);
        const logIndex = String(transfer.logIndex ?? "0");
        const res = await sendToAddressSubscribers({
          address: to,
          title: notification.title,
          body: notification.body,
          url: `/activity`,
          tag: `token-receive-${txHash}-${logIndex}`,
          // Share the same dedupe namespace as erc20Transfers to prevent
          // double-notifies when two Moralis streams emit the same transfer
          // via different payload shapes (erc20Transfers vs custom logs).
          dedupeBase: `erc20:${expectedChainId}:${txHash}:${logIndex}:${to}`,
          chainId: expectedChainId,
          txHash,
          kind: "erc20_received",
        });
        logProcessed += 1;
        matchedSubscriptions += res.matched;
        sent += res.sent;
        skippedDuplicate += res.skippedDuplicate;
        removed += res.removed;
        errors.push(...res.errors);
      } catch (error) {
        errors.push(
          `log transfer processing failed: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }
  }

  return Response.json({
    success: true,
    confirmed: true,
    chainId: expectedChainId,
    erc20Processed,
    logProcessed,
    nativeProcessed,
    matchedSubscriptions,
    sent,
    removed,
    skippedDuplicate,
    errors,
  });
}

export async function GET() {
  return Response.json({ ok: true, route: "moralis-streams-webhook" });
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
