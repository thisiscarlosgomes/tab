import { NextRequest, NextResponse } from "next/server";

const MORALIS_BASE_URL = "https://deep-index.moralis.io/api/v2.2";
const DEFAULT_CHAIN = "base";
const PORTFOLIO_CACHE_TTL_MS = 30 * 1000;
const portfolioCache = new Map<
  string,
  { ts: number; payload: { totalBalanceUSD: number; tokens: Array<NormalizedToken & { portfolioPercent: number }> } }
>();

type MoralisTokenItem = {
  token_address?: string | null;
  symbol?: string | null;
  name?: string | null;
  logo?: string | null;
  thumbnail?: string | null;
  decimals?: string | number | null;
  balance?: string | number | null;
  balance_formatted?: string | number | null;
  usd_price?: string | number | null;
  usd_value?: string | number | null;
  possible_spam?: boolean | string | number | null;
  is_spam?: boolean | string | number | null;
  spam?: boolean | string | number | null;
  native_token?: boolean | string | number | null;
};

type NormalizedToken = {
  tokenAddress: string;
  symbol: string;
  name: string;
  balance: number;
  balanceUSD: number;
  price: number;
  imgUrl: string | null;
  networkName: string | null;
};

const STABLE_TOKEN_ICONS: Record<string, string> = {
  USDC: "/tokens/usdc.png",
  ETH: "/tokens/eth.png",
  WETH: "/tokens/weth.png",
  EURC: "/tokens/eurc.png",
  TAB: "/tokens/tab.png",
};

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNonNegativeNumber(value: unknown) {
  return Math.max(0, toNumber(value));
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

function normalizeAddress(value: unknown) {
  const v = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(v) ? v : null;
}

function normalizeTokenKeyPart(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function canonicalSymbolKey(value: unknown) {
  const raw = String(value ?? "").toUpperCase();
  const cleaned = raw.replace(/[^A-Z0-9]/g, "");
  return cleaned || "TOKEN";
}

function getStableTokenIcon(symbol: string | null | undefined) {
  const key = String(symbol ?? "").trim().toUpperCase();
  return STABLE_TOKEN_ICONS[key] ?? null;
}

function hasMaterialBalance(token: { balance: number; balanceUSD: number }) {
  return token.balanceUSD >= 0.005 || token.balance > 0;
}

function parseBalance(item: MoralisTokenItem) {
  const formatted = toNumber(item.balance_formatted);
  if (formatted > 0) return formatted;

  const raw = toNumber(item.balance);
  const decimals = Math.max(0, Math.trunc(toNumber(item.decimals)));
  if (raw > 0) {
    return raw / 10 ** decimals;
  }
  return 0;
}

function normalizeToken(item: MoralisTokenItem): NormalizedToken | null {
  const isSpam =
    asBoolean(item.possible_spam) || asBoolean(item.is_spam) || asBoolean(item.spam);
  if (isSpam) return null;

  const tokenAddress = String(item.token_address ?? "").trim();
  const symbol = String(item.symbol ?? "").trim().toUpperCase();
  const name = String(item.name ?? "").trim() || symbol || "Token";
  const balance = toNonNegativeNumber(parseBalance(item));
  const price = toNonNegativeNumber(item.usd_price);
  const balanceUSD = toNonNegativeNumber(item.usd_value) || balance * price;
  const imgUrl = String(item.logo ?? item.thumbnail ?? "").trim() || null;

  const resolvedSymbol = symbol || (asBoolean(item.native_token) ? "ETH" : "TOKEN");
  const resolvedTokenAddress =
    tokenAddress || (resolvedSymbol === "ETH" ? "native:eth" : `unknown:${resolvedSymbol}`);

  return {
    tokenAddress: resolvedTokenAddress,
    symbol: resolvedSymbol,
    name,
    balance,
    balanceUSD,
    price,
    imgUrl,
    networkName: "Base",
  };
}

export async function GET(req: NextRequest) {
  const address = normalizeAddress(req.nextUrl.searchParams.get("address"));
  const chain = req.nextUrl.searchParams.get("chain")?.trim() || DEFAULT_CHAIN;

  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  const apiKey = process.env.MORALIS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing MORALIS_API_KEY" },
      { status: 500 }
    );
  }

  const cacheKey = `${chain}:${address}`;
  const cached = portfolioCache.get(cacheKey);

  const buildPayload = (tokens: NormalizedToken[]) => {
    const totalBalanceUSD = tokens.reduce((sum, token) => sum + token.balanceUSD, 0);
    return {
      totalBalanceUSD,
      tokens: tokens.map((token) => ({
        ...token,
        portfolioPercent:
          totalBalanceUSD > 0 ? (token.balanceUSD / totalBalanceUSD) * 100 : 0,
      })),
    };
  };

  try {
    const url = new URL(`${MORALIS_BASE_URL}/wallets/${address}/tokens`);
    url.searchParams.set("chain", chain);
    url.searchParams.set("exclude_spam", "true");
    url.searchParams.set("exclude_unverified_contracts", "false");
    url.searchParams.set("exclude_native", "false");
    url.searchParams.set("limit", "100");

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-API-Key": apiKey,
      },
      cache: "no-store",
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (cached && Date.now() - cached.ts < PORTFOLIO_CACHE_TTL_MS) {
        return NextResponse.json(cached.payload, {
          headers: { "x-portfolio-cache": "stale-fallback" },
        });
      }
      return NextResponse.json(
        { error: "Failed to fetch portfolio", details: body ?? null },
        { status: 502 }
      );
    }

    const rawTokens = Array.isArray(body) ? body : Array.isArray(body?.result) ? body.result : [];
    const normalizedTokens = (rawTokens as MoralisTokenItem[])
      .map(normalizeToken)
      .filter((token): token is NormalizedToken => Boolean(token))
      .filter(hasMaterialBalance);

    const dedupedBySymbol = new Map<string, NormalizedToken>();

    for (const token of normalizedTokens) {
      const symbolKey = canonicalSymbolKey(token.symbol);
      const existing = dedupedBySymbol.get(symbolKey);

      if (!existing) {
        dedupedBySymbol.set(symbolKey, { ...token });
        continue;
      }

      existing.balance += token.balance;
      existing.balanceUSD += token.balanceUSD;
      if (token.price > existing.price) existing.price = token.price;
      if (!existing.imgUrl && token.imgUrl) existing.imgUrl = token.imgUrl;
      if (
        normalizeTokenKeyPart(existing.tokenAddress).startsWith("unknown:") &&
        !normalizeTokenKeyPart(token.tokenAddress).startsWith("unknown:")
      ) {
        existing.tokenAddress = token.tokenAddress;
      }
      if (!existing.name && token.name) existing.name = token.name;
      if (!existing.networkName && token.networkName) existing.networkName = token.networkName;
    }

    const tokens = Array.from(dedupedBySymbol.values())
      .sort((a, b) => b.balanceUSD - a.balanceUSD)
      .map((token) => ({ ...token, imgUrl: getStableTokenIcon(token.symbol) ?? token.imgUrl }));
    const payload = buildPayload(tokens);
    portfolioCache.set(cacheKey, { ts: Date.now(), payload });
    return NextResponse.json(payload);
  } catch {
    if (cached && Date.now() - cached.ts < PORTFOLIO_CACHE_TTL_MS) {
      return NextResponse.json(cached.payload, {
        headers: { "x-portfolio-cache": "stale-fallback" },
      });
    }
    return NextResponse.json(
      { error: "Failed to fetch portfolio" },
      { status: 502 }
    );
  }
}
