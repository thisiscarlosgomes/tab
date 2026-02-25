import { NextRequest, NextResponse } from "next/server";

const MORALIS_BASE_URL = "https://deep-index.moralis.io/api/v2.2";
const DEFAULT_CHAIN = "base";
const CACHE_TTL_MS = 15_000;
const BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const NATIVE_PLACEHOLDER_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

type OhlcvRow = {
  timestamp?: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
};

type CandleDto = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const cache = new Map<string, { ts: number; payload: unknown }>();

function toNum(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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

function getApiKey() {
  return process.env.MORALIS_API_KEY?.trim() || null;
}

function asIso(date: Date) {
  return date.toISOString();
}

function windowToOhlcvConfig(windowSecs: number) {
  if (windowSecs <= 15 * 60) {
    const candleWidthSecs = 60;
    return {
      timeframe: "1min",
      fromMs: Math.max(windowSecs * 1000, candleWidthSecs * 12 * 1000),
      candleWidthSecs,
    };
  }
  if (windowSecs <= 4 * 60 * 60) {
    const candleWidthSecs = 300;
    return {
      timeframe: "5min",
      fromMs: Math.max(windowSecs * 1000, candleWidthSecs * 12 * 1000),
      candleWidthSecs,
    };
  }
  const candleWidthSecs = 3600;
  return {
    timeframe: "1h",
    fromMs: Math.max(windowSecs * 1000, candleWidthSecs * 12 * 1000),
    candleWidthSecs,
  };
}

function buildOhlcvUrl(params: {
  pairAddress: string;
  chain: string;
  timeframe: string;
  from: Date;
  to: Date;
  limit: number;
}) {
  const url = new URL(`${MORALIS_BASE_URL}/pairs/${params.pairAddress}/ohlcv`);
  url.searchParams.set("chain", params.chain);
  url.searchParams.set("timeframe", params.timeframe);
  url.searchParams.set("currency", "usd");
  url.searchParams.set("fromDate", asIso(params.from));
  url.searchParams.set("toDate", asIso(params.to));
  url.searchParams.set("limit", String(params.limit));
  return url;
}

function mapOhlcvRows(rows: unknown): CandleDto[] {
  const list = Array.isArray(rows) ? (rows as OhlcvRow[]) : [];
  return list
    .map((row) => {
      const time = Date.parse(String(row.timestamp ?? ""));
      const open = toNum(row.open);
      const high = toNum(row.high);
      const low = toNum(row.low);
      const close = toNum(row.close);
      const volume = toNum(row.volume) ?? 0;
      if (
        !Number.isFinite(time) ||
        open === null ||
        high === null ||
        low === null ||
        close === null
      ) {
        return null;
      }
      return {
        time: Math.floor(time / 1000),
        open,
        high,
        low,
        close,
        volume,
      };
    })
    .filter((row): row is CandleDto => Boolean(row))
    .sort((a, b) => a.time - b.time);
}

export async function GET(req: NextRequest) {
  const chain = normalizeChain(req.nextUrl.searchParams.get("chain"));
  const tokenAddress = normalizeTokenAddress(
    req.nextUrl.searchParams.get("tokenAddress"),
    chain
  );
  const windowSecsRaw = Number(req.nextUrl.searchParams.get("windowSecs") ?? "300");
  const windowSecs = Math.max(60, Math.min(Number.isFinite(windowSecsRaw) ? windowSecsRaw : 300, 86400));

  if (!tokenAddress) {
    return NextResponse.json({ error: "Invalid tokenAddress" }, { status: 400 });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "Missing MORALIS_API_KEY" }, { status: 500 });
  }

  const cacheKey = `${chain}:${tokenAddress}:${windowSecs}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload, {
      headers: { "x-token-insights-cache": "hit" },
    });
  }

  try {
    const headers = {
      Accept: "application/json",
      "X-API-Key": apiKey,
    };

    const priceUrl = new URL(`${MORALIS_BASE_URL}/erc20/${tokenAddress}/price`);
    priceUrl.searchParams.set("chain", chain);

    const metadataUrl = new URL(`${MORALIS_BASE_URL}/erc20/metadata`);
    metadataUrl.searchParams.set("chain", chain);
    metadataUrl.searchParams.set("addresses[0]", tokenAddress);

    const [priceRes, metadataRes] = await Promise.all([
      fetch(priceUrl.toString(), { headers, cache: "no-store" }),
      fetch(metadataUrl.toString(), { headers, cache: "no-store" }),
    ]);

    const priceJson = await priceRes.json().catch(() => ({}));
    const metadataJson = await metadataRes.json().catch(() => []);

    if (!priceRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch token price", details: priceJson ?? null },
        { status: 502 }
      );
    }

    const pairAddress = String((priceJson as { pairAddress?: string }).pairAddress ?? "").trim();
    const usdPrice = toNum((priceJson as { usdPrice?: unknown }).usdPrice) ?? 0;

    const metadata = Array.isArray(metadataJson) ? metadataJson[0] ?? null : null;
    const marketCap =
      toNum((metadata as { market_cap?: unknown } | null)?.market_cap) ??
      toNum((metadata as { fully_diluted_valuation?: unknown } | null)?.fully_diluted_valuation);

    let candles: CandleDto[] = [];
    let volume24h: number | null = null;
    let change24hPct: number | null = null;
    let candleWidthSecs = 60;

    if (pairAddress && /^0x[a-f0-9]{40}$/i.test(pairAddress)) {
      const now = new Date();
      const chartCfg = windowToOhlcvConfig(windowSecs);
      candleWidthSecs = chartCfg.candleWidthSecs;
      const chartFrom = new Date(now.getTime() - chartCfg.fromMs);
      const volFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [chartRes, volRes] = await Promise.all([
        fetch(
          buildOhlcvUrl({
            pairAddress,
            chain,
            timeframe: chartCfg.timeframe,
            from: chartFrom,
            to: now,
            limit: 400,
          }).toString(),
          { headers, cache: "no-store" }
        ),
        fetch(
          buildOhlcvUrl({
            pairAddress,
            chain,
            timeframe: "1h",
            from: volFrom,
            to: now,
            limit: 48,
          }).toString(),
          { headers, cache: "no-store" }
        ),
      ]);

      const chartJson = await chartRes.json().catch(() => ({}));
      const volJson = await volRes.json().catch(() => ({}));

      if (chartRes.ok) {
        candles = mapOhlcvRows((chartJson as { result?: unknown }).result);
      }
      if (volRes.ok) {
        const volCandles = mapOhlcvRows((volJson as { result?: unknown }).result);
        volume24h = volCandles.reduce((sum, row) => sum + (row.volume || 0), 0);
        if (volCandles.length > 0) {
          const firstOpen = volCandles[0]?.open ?? null;
          const lastClose = volCandles[volCandles.length - 1]?.close ?? null;
          if (
            typeof firstOpen === "number" &&
            Number.isFinite(firstOpen) &&
            firstOpen > 0 &&
            typeof lastClose === "number" &&
            Number.isFinite(lastClose)
          ) {
            change24hPct = ((lastClose - firstOpen) / firstOpen) * 100;
          }
        }
      }
    }

    const payload = {
      tokenAddress,
      pairAddress: pairAddress || null,
      price: usdPrice,
      marketCap: marketCap ?? null,
      volume24h,
      change24hPct,
      candleWidthSecs,
      candles,
      tokenName: (priceJson as { tokenName?: string }).tokenName ?? null,
      tokenSymbol: (priceJson as { tokenSymbol?: string }).tokenSymbol ?? null,
      tokenLogo:
        (priceJson as { tokenLogo?: string }).tokenLogo ??
        (metadata as { logo?: string } | null)?.logo ??
        null,
    };

    cache.set(cacheKey, { ts: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[moralis token-insights]", error);
    return NextResponse.json({ error: "Failed to fetch token insights" }, { status: 502 });
  }
}
