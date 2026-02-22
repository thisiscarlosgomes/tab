type MoralisCounterparty = {
  address?: string;
  name?: string;
};

export type MoralisSyntheticActivity = {
  address: string;
  type: "bill_paid" | "bill_received";
  refType: "transfer";
  refId: string;
  amount?: number;
  token?: string;
  txHash?: string;
  counterparty?: MoralisCounterparty;
  recipient?: string;
  timestamp: string | Date;
  summary?: string;
};

const MORALIS_BASE_URL = "https://deep-index.moralis.io/api/v2.2";
const MORALIS_CACHE_TTL_MS = 20_000;
const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI", "EURC"]);

const moralisCache = new Map<
  string,
  { ts: number; value: MoralisSyntheticActivity[] }
>();

function normalizeAddress(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) return null;
  return normalized;
}

function shortAddress(address: string) {
  if (!/^0x[a-f0-9]{40}$/.test(address)) return address;
  return `0x${address.slice(2, 5)}...${address.slice(-3)}`;
}

function asFiniteNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(normalized);
}

function envNumber(name: string, fallback: number) {
  const parsed = asFiniteNumber(process.env[name]);
  return parsed === null ? fallback : parsed;
}

function isLikelySpamSymbol(symbolRaw: string | null | undefined) {
  const symbol = String(symbolRaw ?? "").trim().toUpperCase();
  if (!symbol) return false;
  if (symbol.length > 14) return true;
  if (/https?:|www\.|\.com|\.io|\.xyz|t\.me|discord|airdrop|claim|free|visit/.test(symbol.toLowerCase())) {
    return true;
  }
  if (!/^[A-Z0-9._-]+$/.test(symbol)) return true;
  return false;
}

function looksLikeSpamItem(item: Record<string, unknown>) {
  if (
    asBoolean(item.possible_spam) ||
    asBoolean(item.is_spam) ||
    asBoolean(item.spam)
  ) {
    return true;
  }

  const summary = String(item.summary ?? "").toLowerCase();
  if (/(airdrop|claim|visit|free|phishing)/.test(summary)) {
    return true;
  }

  const erc20Transfers = Array.isArray(item.erc20_transfers)
    ? (item.erc20_transfers as Record<string, unknown>[])
    : [];

  for (const transfer of erc20Transfers) {
    if (
      asBoolean(transfer.possible_spam) ||
      asBoolean(transfer.is_spam) ||
      asBoolean(transfer.spam)
    ) {
      return true;
    }
    const symbolRaw =
      transfer.token_symbol ??
      transfer.symbol ??
      (transfer.token && typeof transfer.token === "object"
        ? (transfer.token as Record<string, unknown>).symbol
        : undefined);
    if (isLikelySpamSymbol(typeof symbolRaw === "string" ? symbolRaw : null)) {
      return true;
    }
  }

  return false;
}

function isSmallTransfer(params: {
  amount: number | null;
  token: string | null;
  item: Record<string, unknown>;
}) {
  const minUsd = envNumber("MORALIS_MIN_TRANSFER_USD", 0.1);
  const minStable = envNumber("MORALIS_MIN_STABLE_AMOUNT", 0.05);
  const minNative = envNumber("MORALIS_MIN_NATIVE_AMOUNT", 0.00001);
  const minToken = envNumber("MORALIS_MIN_TOKEN_AMOUNT", 0.01);

  const erc20Transfers = Array.isArray(params.item.erc20_transfers)
    ? (params.item.erc20_transfers as Record<string, unknown>[])
    : [];
  const nativeTransfers = Array.isArray(params.item.native_transfers)
    ? (params.item.native_transfers as Record<string, unknown>[])
    : [];

  const usdCandidates = [
    asFiniteNumber(params.item.usd_value),
    asFiniteNumber(params.item.value_usd),
    ...erc20Transfers.flatMap((transfer) => [
      asFiniteNumber(transfer.usd_value),
      asFiniteNumber(transfer.value_usd),
    ]),
    ...nativeTransfers.flatMap((transfer) => [
      asFiniteNumber(transfer.usd_value),
      asFiniteNumber(transfer.value_usd),
    ]),
  ].filter((value): value is number => value !== null);

  if (usdCandidates.length > 0) {
    const usdMax = Math.max(...usdCandidates);
    return usdMax < minUsd;
  }

  if (params.amount === null || !Number.isFinite(params.amount)) {
    return true;
  }

  const token = String(params.token ?? "").toUpperCase();
  if (!token) return true;
  if (STABLE_SYMBOLS.has(token)) return params.amount < minStable;
  if (token === "ETH" || token === "WETH") return params.amount < minNative;
  return params.amount < minToken;
}

function parseSummaryAmountToken(summary: string) {
  const match = summary.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s+([A-Za-z0-9._-]+)/);
  if (!match) return { amount: null, token: null as string | null };
  const amount = asFiniteNumber(match[1].replace(/,/g, ""));
  const token = String(match[2] ?? "").trim().toUpperCase();
  return {
    amount,
    token: token || null,
  };
}

function extractAmountTokenFromTransfer(transfer: Record<string, unknown>) {
  const symbolRaw =
    transfer.token_symbol ??
    transfer.symbol ??
    (transfer.token && typeof transfer.token === "object"
      ? (transfer.token as Record<string, unknown>).symbol
      : undefined);
  const token = String(symbolRaw ?? "").trim().toUpperCase() || null;

  const valueFormatted = asFiniteNumber(transfer.value_formatted);
  if (valueFormatted !== null) {
    return { amount: valueFormatted, token };
  }

  const value = asFiniteNumber(transfer.value);
  const decimals = asFiniteNumber(transfer.token_decimals);
  if (value !== null && decimals !== null && decimals >= 0) {
    return { amount: value / 10 ** decimals, token };
  }

  return { amount: null, token };
}

function extractAmountToken(item: Record<string, unknown>) {
  const erc20Transfers = Array.isArray(item.erc20_transfers)
    ? (item.erc20_transfers as Record<string, unknown>[])
    : [];
  if (erc20Transfers.length > 0) {
    const parsed = extractAmountTokenFromTransfer(erc20Transfers[0]);
    if (parsed.amount !== null || parsed.token) return parsed;
  }

  const nativeTransfers = Array.isArray(item.native_transfers)
    ? (item.native_transfers as Record<string, unknown>[])
    : [];
  if (nativeTransfers.length > 0) {
    const parsed = extractAmountTokenFromTransfer(nativeTransfers[0]);
    return {
      amount: parsed.amount,
      token: parsed.token ?? "ETH",
    };
  }

  const summary = String(item.summary ?? "").trim();
  if (summary) {
    return parseSummaryAmountToken(summary);
  }

  return { amount: null, token: null as string | null };
}

function inferDirection(item: Record<string, unknown>, walletAddress: string) {
  const from = normalizeAddress(item.from_address);
  const to = normalizeAddress(item.to_address);
  if (from === walletAddress) return "sent";
  if (to === walletAddress) return "received";

  const category = String(item.category ?? "").toLowerCase();
  if (category.includes("send")) return "sent";
  if (category.includes("receive")) return "received";
  return null;
}

function toSyntheticActivity(
  item: Record<string, unknown>,
  walletAddress: string
): MoralisSyntheticActivity | null {
  if (looksLikeSpamItem(item)) return null;

  const direction = inferDirection(item, walletAddress);
  if (!direction) return null;

  const txHash = String(item.hash ?? item.transaction_hash ?? "").trim();
  if (!txHash) return null;

  const from = normalizeAddress(item.from_address);
  const to = normalizeAddress(item.to_address);
  const counterpartyAddress =
    direction === "received" ? from : to;

  const { amount, token } = extractAmountToken(item);
  if (isSmallTransfer({ amount, token, item })) return null;

  const summary = String(item.summary ?? "").trim() || undefined;

  return {
    address: walletAddress,
    type: direction === "received" ? "bill_received" : "bill_paid",
    refType: "transfer",
    refId: txHash,
    amount: amount ?? undefined,
    token: token ?? undefined,
    txHash,
    recipient: direction === "sent" ? counterpartyAddress ?? undefined : undefined,
    counterparty: counterpartyAddress
      ? {
          address: counterpartyAddress,
          name: shortAddress(counterpartyAddress),
        }
      : undefined,
    timestamp:
      String(item.block_timestamp ?? "").trim() ||
      String(item.block_date ?? "").trim() ||
      new Date(),
    summary,
  };
}

export async function fetchMoralisTransferActivity(
  address: string,
  options?: { limit?: number; direction?: "received" | "all" }
) {
  const normalized = normalizeAddress(address);
  if (!normalized) return [] as MoralisSyntheticActivity[];

  const apiKey = process.env.MORALIS_API_KEY?.trim();
  if (!apiKey) return [] as MoralisSyntheticActivity[];

  const limit = Math.min(Math.max(Number(options?.limit ?? 20) || 20, 1), 100);
  const directionFilter = options?.direction ?? "received";
  const chain = process.env.MORALIS_CHAIN?.trim() || "base";
  const cacheKey = `${normalized}:${chain}:${limit}:${directionFilter}`;
  const cached = moralisCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < MORALIS_CACHE_TTL_MS) {
    return cached.value;
  }

  const controller = new AbortController();
  const timeoutMs = envNumber("MORALIS_TIMEOUT_MS", 2500);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(`${MORALIS_BASE_URL}/wallets/${normalized}/history`);
    url.searchParams.set("chain", chain);
    url.searchParams.set("order", "DESC");
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-API-Key": apiKey,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return [] as MoralisSyntheticActivity[];
    }

    const json = (await res.json()) as { result?: unknown };
    const result = Array.isArray(json?.result)
      ? (json.result as Record<string, unknown>[])
      : [];

    const mapped = result
      .map((item) => toSyntheticActivity(item, normalized))
      .filter((item): item is MoralisSyntheticActivity => Boolean(item))
      .filter((item) =>
        directionFilter === "all" ? true : item.type === "bill_received"
      );

    moralisCache.set(cacheKey, { ts: Date.now(), value: mapped });
    return mapped;
  } catch {
    return [] as MoralisSyntheticActivity[];
  } finally {
    clearTimeout(timeoutId);
  }
}
