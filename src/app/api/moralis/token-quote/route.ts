import { NextRequest, NextResponse } from "next/server";

const MORALIS_BASE_URL = "https://deep-index.moralis.io/api/v2.2";
const DEFAULT_CHAIN = "base";
const BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const NATIVE_PLACEHOLDER_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const CACHE_TTL_MS = 2_000;

const cache = new Map<string, { ts: number; payload: unknown }>();

function normalizeChain(value: string | null) {
  const chain = (value ?? DEFAULT_CHAIN).trim().toLowerCase();
  return chain || DEFAULT_CHAIN;
}

function normalizeTokenAddress(value: string | null, chain: string) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (chain === "base" && (raw === "native:eth" || raw === NATIVE_PLACEHOLDER_ADDRESS)) {
    return BASE_WETH_ADDRESS;
  }
  if (/^0x[a-f0-9]{40}$/.test(raw)) return raw;
  return null;
}

function toNum(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const chain = normalizeChain(req.nextUrl.searchParams.get("chain"));
  const tokenAddress = normalizeTokenAddress(
    req.nextUrl.searchParams.get("tokenAddress"),
    chain
  );

  if (!tokenAddress) {
    return NextResponse.json({ error: "Invalid tokenAddress" }, { status: 400 });
  }

  const apiKey = process.env.MORALIS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Missing MORALIS_API_KEY" }, { status: 500 });
  }

  const cacheKey = `${chain}:${tokenAddress}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload, {
      headers: { "x-token-quote-cache": "hit" },
    });
  }

  try {
    const url = new URL(`${MORALIS_BASE_URL}/erc20/${tokenAddress}/price`);
    url.searchParams.set("chain", chain);

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-API-Key": apiKey,
      },
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch token quote", details: json ?? null },
        { status: 502 }
      );
    }

    const payload = {
      tokenAddress,
      pairAddress: String((json as { pairAddress?: string }).pairAddress ?? "").trim() || null,
      price: toNum((json as { usdPrice?: unknown }).usdPrice),
      blockTimestamp: String((json as { blockTimestamp?: string }).blockTimestamp ?? "").trim() || null,
    };

    cache.set(cacheKey, { ts: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[moralis token-quote]", error);
    return NextResponse.json({ error: "Failed to fetch token quote" }, { status: 502 });
  }
}
