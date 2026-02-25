"use client";

import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { CandlePoint, LivelinePoint } from "liveline";
import { ChartCandlestick, ChartLine } from "lucide-react";
import { ReceiveDrawerController } from "@/components/app/ReceiveDrawerController";
import { useTabIdentity } from "@/lib/useTabIdentity";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const Liveline = dynamic(
  () => import("liveline").then((mod) => mod.Liveline),
  { ssr: false }
);

type ChartState = {
  ticks: LivelinePoint[];
  candles: CandlePoint[];
  liveCandle: CandlePoint;
  value: number;
};

type TokenInsightsResponse = {
  tokenAddress: string;
  pairAddress: string | null;
  price: number;
  marketCap: number | null;
  volume24h: number | null;
  change24hPct: number | null;
  candleWidthSecs: number;
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
};

type WalletPortfolioToken = {
  tokenAddress?: string | null;
  symbol?: string | null;
  name?: string | null;
  balance?: number | null;
  balanceUSD?: number | null;
  price?: number | null;
  imgUrl?: string | null;
  networkName?: string | null;
};

const WINDOW_OPTIONS = [
  { label: "1M", secs: 60, candleWidth: 5 },
  { label: "5M", secs: 300, candleWidth: 15 },
  { label: "15M", secs: 900, candleWidth: 60 },
  { label: "1H", secs: 3600, candleWidth: 300 },
  { label: "4H", secs: 14_400, candleWidth: 900 },
  { label: "1D", secs: 86_400, candleWidth: 3600 },
] as const;

const BASE_TOKEN_ADDRESS_BY_SYMBOL: Record<string, string> = {
  ETH: "0x4200000000000000000000000000000000000006",
  WETH: "0x4200000000000000000000000000000000000006",
  USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  EURC: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
  TAB: "0xc1256ae5ff1cf2719d4937adb3bbccab2e00a2ca",
};

const APP_POSITIVE_HEX = "#34d399"; // tailwind emerald-400
const APP_NEGATIVE_HEX = "#f87171"; // tailwind red-400

function num(value: string | null, fallback = 0) {
  if (value === null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function decodeParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function tokenSlugFromNameOrSymbol(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeTokenAddressForMoralis(value: string | null, symbol: string) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
    return BASE_TOKEN_ADDRESS_BY_SYMBOL.ETH;
  }
  if (/^0x[a-f0-9]{40}$/.test(raw)) return raw;
  return BASE_TOKEN_ADDRESS_BY_SYMBOL[String(symbol ?? "").toUpperCase()] ?? null;
}

function hashString(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededUnit(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function buildSeededChartState(params: {
  seedKey: string;
  basePrice: number;
  windowSecs: number;
  candleWidth: number;
}): ChartState {
  const { seedKey, windowSecs, candleWidth } = params;
  const safeBase = params.basePrice > 0 ? params.basePrice : 1;
  const nowSec = Math.floor(Date.now() / 1000);
  const liveBucketStart = Math.floor(nowSec / candleWidth) * candleWidth;
  const bars = Math.max(12, Math.floor(windowSecs / candleWidth) - 1);
  const volatility = clamp(safeBase * 0.0035, safeBase * 0.0002, safeBase * 0.04);
  const drift = (seededUnit(hashString(seedKey)) - 0.5) * volatility * 0.06;

  const candles: CandlePoint[] = [];
  let prevClose = safeBase;

  for (let i = bars; i >= 1; i -= 1) {
    const time = liveBucketStart - i * candleWidth;
    const seed = hashString(`${seedKey}:${windowSecs}:${candleWidth}:${time}`);
    const open = prevClose;
    const delta = (seededUnit(seed) - 0.5) * volatility * 2 + drift;
    const close = Math.max(0.0000001, open + delta);
    const wickUp = seededUnit(seed + 1) * volatility * 0.9;
    const wickDown = seededUnit(seed + 2) * volatility * 0.9;
    const high = Math.max(open, close) + wickUp;
    const low = Math.max(0.0000001, Math.min(open, close) - wickDown);
    candles.push({ time, open, high, low, close });
    prevClose = close;
  }

  const liveOpen = prevClose;
  const liveNoise = (seededUnit(hashString(`${seedKey}:live:${liveBucketStart}`)) - 0.5) * volatility;
  const liveClose = Math.max(0.0000001, liveOpen + liveNoise);
  const liveCandle: CandlePoint = {
    time: liveBucketStart,
    open: liveOpen,
    close: liveClose,
    high: Math.max(liveOpen, liveClose) + volatility * 0.2,
    low: Math.max(0.0000001, Math.min(liveOpen, liveClose) - volatility * 0.2),
  };

  const ticks: LivelinePoint[] = [...candles, liveCandle].map((c) => ({
    time: c.time,
    value: c.close,
  }));

  return {
    ticks,
    candles,
    liveCandle,
    value: liveCandle.close,
  };
}

function formatUsd(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("en-US", {
    minimumFractionDigits: safe >= 1 ? 2 : 4,
    maximumFractionDigits: safe >= 1 ? 2 : 6,
  });
}

function formatCompactUsd(value: number) {
  if (!Number.isFinite(value) || value < 0) return "--";
  return `$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 2 : 1,
  }).format(value)}`;
}

export default function WalletTokenDetailsPage() {
  const { address } = useTabIdentity();
  const params = useParams();
  const searchParams = useSearchParams();
  const tokenNameParam = decodeParam(params?.tokenName);
  const [hydratedWalletToken, setHydratedWalletToken] = useState<WalletPortfolioToken | null>(
    null
  );

  const querySymbol = searchParams.get("symbol");
  const queryName = searchParams.get("name");
  const queryTokenAddress = searchParams.get("tokenAddress");
  const queryImgUrl = searchParams.get("imgUrl");
  const queryBalance = num(searchParams.get("balance"));
  const queryBalanceUSD = num(searchParams.get("balanceUSD"));
  const queryPrice = num(searchParams.get("price"));

  const symbol =
    querySymbol ||
    String(hydratedWalletToken?.symbol ?? "").trim() ||
    tokenNameParam.replace(/-/g, " ").toUpperCase();
  const name =
    queryName ||
    String(hydratedWalletToken?.name ?? "").trim() ||
    titleFromSlug(tokenNameParam) ||
    symbol;
  const tokenAddress =
    queryTokenAddress || (hydratedWalletToken?.tokenAddress ? String(hydratedWalletToken.tokenAddress) : null);
  const imgUrl = queryImgUrl || (hydratedWalletToken?.imgUrl ? String(hydratedWalletToken.imgUrl) : null);
  const balance =
    Number.isFinite(queryBalance) && queryBalance > 0
      ? queryBalance
      : Number(hydratedWalletToken?.balance ?? 0);
  const balanceUSD =
    Number.isFinite(queryBalanceUSD) && queryBalanceUSD > 0
      ? queryBalanceUSD
      : Number(hydratedWalletToken?.balanceUSD ?? 0);
  const priceFromQuery =
    Number.isFinite(queryPrice) && queryPrice > 0
      ? queryPrice
      : Number(hydratedWalletToken?.price ?? 0);
  const marketCap = num(searchParams.get("marketCap"), Number.NaN);
  const volume = num(searchParams.get("volume"), Number.NaN);

  const [selectedWindow, setSelectedWindow] = useState<number>(WINDOW_OPTIONS[3].secs);
  const [chart, setChart] = useState<ChartState | null>(null);
  const [lineMode, setLineMode] = useState(true);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [marketCapReal, setMarketCapReal] = useState<number | null>(null);
  const [volume24hReal, setVolume24hReal] = useState<number | null>(null);
  const [change24hPctReal, setChange24hPctReal] = useState<number | null>(null);
  const [isChartLoading, setIsChartLoading] = useState(false);
  const [effectiveCandleWidthSecs, setEffectiveCandleWidthSecs] = useState<number>(
    WINDOW_OPTIONS[3].candleWidth
  );
  const [activePairAddress, setActivePairAddress] = useState<string | null>(null);
  const [chartLoadedWindowSecs, setChartLoadedWindowSecs] = useState<number | null>(null);

  const selectedConfig =
    WINDOW_OPTIONS.find((opt) => opt.secs === selectedWindow) ?? WINDOW_OPTIONS[3];

  const basePrice = useMemo(() => {
    if (priceFromQuery > 0) return priceFromQuery;
    if (balance > 0 && balanceUSD > 0) return balanceUSD / balance;
    return 1;
  }, [balance, balanceUSD, priceFromQuery]);

  const seedKey = `${symbol}:${tokenAddress ?? name}`;
  const resolvedTokenAddress = useMemo(
    () => normalizeTokenAddressForMoralis(tokenAddress, symbol),
    [symbol, tokenAddress]
  );

  useEffect(() => {
    if (!address) return;
    if (queryTokenAddress && querySymbol && queryName) return;

    let cancelled = false;
    const controller = new AbortController();
    const slug = tokenSlugFromNameOrSymbol(tokenNameParam);

    const hydrateFromWallet = async () => {
      try {
        const res = await fetch(`/api/moralis/portfolio?address=${address}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        const tokens = Array.isArray(data?.tokens) ? (data.tokens as WalletPortfolioToken[]) : [];
        const match =
          tokens.find((t) => tokenSlugFromNameOrSymbol(t.symbol) === slug) ??
          tokens.find((t) => tokenSlugFromNameOrSymbol(t.name) === slug);
        if (!cancelled && match) {
          setHydratedWalletToken(match);
        }
      } catch {
        // best effort; page can still render from symbol fallback + Moralis insights
      }
    };

    void hydrateFromWallet();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [address, queryName, querySymbol, queryTokenAddress, tokenNameParam]);

  useEffect(() => {
    setEffectiveCandleWidthSecs(selectedConfig.candleWidth);
    setChartLoadedWindowSecs(null);
  }, [selectedConfig.candleWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => {
      setIsTouchDevice(media.matches || "ontouchstart" in window);
    };
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsPageVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadInsights = async (background = false) => {
      if (!resolvedTokenAddress) {
        if (!background) {
          setChart(
            buildSeededChartState({
              seedKey,
              basePrice,
              windowSecs: selectedConfig.secs,
              candleWidth: selectedConfig.candleWidth,
            })
          );
        }
        return;
      }

      if (!background && !chart) setIsChartLoading(true);
      try {
        const qs = new URLSearchParams({
          tokenAddress: resolvedTokenAddress,
          chain: "base",
          windowSecs: String(selectedConfig.secs),
        });
        const res = await fetch(`/api/moralis/token-insights?${qs.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Failed to load token insights");
        const data = (await res.json()) as TokenInsightsResponse;
        const insightsPair =
          typeof data.pairAddress === "string" && data.pairAddress
            ? data.pairAddress.toLowerCase()
            : null;

        const rows = Array.isArray(data.candles) ? data.candles : [];
        const sorted = [...rows].sort((a, b) => a.time - b.time);

        if (sorted.length > 0) {
          const latest = sorted[sorted.length - 1];
          const committed = sorted.slice(0, -1);
          const mappedCommitted: CandlePoint[] = committed.map((c) => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }));
          const liveCandle: CandlePoint = {
            time: latest.time,
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,
          };
          const ticks: LivelinePoint[] = [...mappedCommitted, liveCandle].map((c) => ({
            time: c.time,
            value: c.close,
          }));
          if (!cancelled) {
            if (
              typeof data.candleWidthSecs === "number" &&
              Number.isFinite(data.candleWidthSecs) &&
              data.candleWidthSecs > 0
            ) {
              setEffectiveCandleWidthSecs(data.candleWidthSecs);
            }
            setChart({
              candles: mappedCommitted,
              liveCandle,
              ticks,
              value: latest.close,
            });
            setChartLoadedWindowSecs(selectedConfig.secs);
          }
        } else if (!cancelled && !background) {
          setChart(
            buildSeededChartState({
              seedKey,
              basePrice: data.price > 0 ? data.price : basePrice,
              windowSecs: selectedConfig.secs,
              candleWidth: data.candleWidthSecs || selectedConfig.candleWidth,
            })
          );
          setChartLoadedWindowSecs(selectedConfig.secs);
        }

        if (!cancelled) {
          setActivePairAddress(insightsPair);
          setMarketCapReal(
            typeof data.marketCap === "number" && Number.isFinite(data.marketCap)
              ? data.marketCap
              : null
          );
          setVolume24hReal(
            typeof data.volume24h === "number" && Number.isFinite(data.volume24h)
              ? data.volume24h
              : null
          );
          setChange24hPctReal(
            typeof data.change24hPct === "number" && Number.isFinite(data.change24hPct)
              ? data.change24hPct
              : null
          );
        }
      } catch {
        if (!cancelled && !background) {
          setChart(
            buildSeededChartState({
              seedKey,
              basePrice,
              windowSecs: selectedConfig.secs,
              candleWidth: selectedConfig.candleWidth,
            })
          );
          setChartLoadedWindowSecs(selectedConfig.secs);
        }
      } finally {
        if (!cancelled) setIsChartLoading(false);
      }
    };

    void loadInsights(false);
    const pollId = isPageVisible
      ? window.setInterval(() => {
          void loadInsights(true);
        }, 45_000)
      : null;

    return () => {
      cancelled = true;
      controller.abort();
      if (pollId !== null) window.clearInterval(pollId);
    };
  }, [
    basePrice,
    isPageVisible,
    resolvedTokenAddress,
    seedKey,
    selectedConfig.candleWidth,
    selectedConfig.secs,
  ]);

  useEffect(() => {
    if (!resolvedTokenAddress) return;
    if (!isPageVisible) return;
    if (!lineMode) return;

    let cancelled = false;

    const applyQuoteToChart = (price: number, quoteMs?: number | null) => {
      if (!Number.isFinite(price) || price <= 0) return;
      setChart((prev) => {
        if (!prev) return prev;

        const nowSec = Math.floor(
          (typeof quoteMs === "number" && Number.isFinite(quoteMs) && quoteMs > 0
            ? quoteMs
            : Date.now()) / 1000
        );
        const bucketStart =
          Math.floor(nowSec / effectiveCandleWidthSecs) * effectiveCandleWidthSecs;

        let candles = prev.candles;
        let liveCandle = prev.liveCandle;

        if (!liveCandle || bucketStart > liveCandle.time) {
          if (liveCandle) candles = [...candles, liveCandle];
          candles = candles.filter(
            (c) => c.time >= bucketStart - selectedConfig.secs - effectiveCandleWidthSecs
          );
          const open = prev.value > 0 ? prev.value : price;
          liveCandle = {
            time: bucketStart,
            open,
            high: Math.max(open, price),
            low: Math.min(open, price),
            close: price,
          };
        } else {
          liveCandle = {
            ...liveCandle,
            close: price,
            high: Math.max(liveCandle.high, price),
            low: Math.min(liveCandle.low, price),
          };
        }

        const ticks = [...candles, liveCandle]
          .map((c) => ({ time: c.time, value: c.close }))
          .filter((p) => p.time >= bucketStart - selectedConfig.secs);

        return {
          candles,
          liveCandle,
          ticks,
          value: price,
        };
      });
    };

    const fetchQuote = async () => {
      try {
        const qs = new URLSearchParams({
          tokenAddress: resolvedTokenAddress,
          chain: "base",
        });
        const res = await fetch(`/api/moralis/token-quote?${qs.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          price?: number | null;
          pairAddress?: string | null;
          blockTimestamp?: string | null;
        };
        const price = Number(data?.price);
        const quoteMs = Number(data?.blockTimestamp);
        const quotePair =
          typeof data?.pairAddress === "string" && data.pairAddress
            ? data.pairAddress.toLowerCase()
            : null;

        if (
          !cancelled &&
          Number.isFinite(price) &&
          price > 0 &&
          chartLoadedWindowSecs === selectedConfig.secs &&
          (!activePairAddress || !quotePair || quotePair === activePairAddress)
        ) {
          applyQuoteToChart(
            price,
            Number.isFinite(quoteMs) && quoteMs > 0 ? quoteMs : null
          );
        }
      } catch {
        // ignore transient quote failures
      }
    };

    const quotePollMs =
      selectedConfig.secs <= 5 * 60
        ? 2_000
        : selectedConfig.secs <= 60 * 60
          ? 5_000
          : selectedConfig.secs <= 4 * 60 * 60
            ? 10_000
            : 15_000;

    void fetchQuote();
    const id = window.setInterval(() => {
      void fetchQuote();
    }, quotePollMs);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    activePairAddress,
    chartLoadedWindowSecs,
    effectiveCandleWidthSecs,
    isPageVisible,
    lineMode,
    resolvedTokenAddress,
    selectedConfig.secs,
  ]);

  const fallbackWindowChangePct = useMemo(() => {
    if (!chart) return 0;
    const firstCandle = chart.candles[0];
    const baseline = firstCandle?.open ?? chart.liveCandle?.open ?? basePrice;
    const latest = Number(chart?.value ?? basePrice);
    if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(latest)) return 0;
    return ((latest - baseline) / baseline) * 100;
  }, [basePrice, chart]);
  const pctChange = Number.isFinite(change24hPctReal ?? Number.NaN)
    ? (change24hPctReal as number)
    : fallbackWindowChangePct;
  const isUp = pctChange >= 0;
  const formatPct = (v: number) =>
    `${v >= 0 ? "+" : ""}${v.toLocaleString("en-US", {
      minimumFractionDigits: Math.abs(v) < 0.1 ? 3 : 2,
      maximumFractionDigits: Math.abs(v) < 0.1 ? 3 : 2,
    })}%`;
  const chartWindowSecs = lineMode
    ? selectedConfig.secs
    : Math.max(selectedConfig.secs, effectiveCandleWidthSecs * 3);

  return (
    <ReceiveDrawerController>
      {({ openReceiveDrawer }) => (
        <div className="min-h-screen w-full p-4 pt-[calc(4.5rem+env(safe-area-inset-top))] pb-[calc(8rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-md">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={symbol}
                className="w-10 h-10 rounded-full object-cover border border-white/10 bg-white/5"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-white/10 text-white/70 flex items-center justify-center text-xs border border-white/10">
                {symbol.slice(0, 3)}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-lg leading-tight font-semibold text-white truncate">{name}</p>
              <p className="text-sm leading-tight text-white/50 truncate">{symbol}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[34px] sm:text-[38px] leading-none font-semibold tracking-tight text-white">
              ${formatUsd(chart?.value ?? basePrice)}
            </p>
            <p className={`mt-1.5 text-base font-medium ${isUp ? "text-emerald-400" : "text-red-400"}`}>
              {formatPct(pctChange)}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[14px] text-white/70">
              <span className="text-white/40 uppercase tracking-wide">MCAP</span>{" "}
              <span className="text-white/90">
                {formatCompactUsd(
                  marketCapReal ?? (Number.isFinite(marketCap) ? marketCap : Number.NaN)
                )}
              </span>
            </p>
            <p className="text-[14px] text-white/70 mt-1">
              <span className="text-white/40 uppercase tracking-wide">VOL</span>{" "}
              <span className="text-white/90">
                {formatCompactUsd(
                  volume24hReal ?? (Number.isFinite(volume) ? volume : Number.NaN)
                )}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-4 p-0">
          <div className="relative">
            <div className="absolute top-2 left-0 z-10 flex items-center gap-2">
              {WINDOW_OPTIONS.map((option) => {
                const active = selectedWindow === option.secs;
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => setSelectedWindow(option.secs)}
                    className={[
                      "px-1 py-0.5 text-[13px] transition",
                      active ? "text-white font-semibold" : "text-white/45 hover:text-white/75",
                    ].join(" ")}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="hidden absolute top-1.5 right-0 z-10 inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
              <button
                type="button"
                onClick={() => setLineMode((prev) => !prev)}
                aria-label={lineMode ? "Switch to candlestick chart" : "Switch to line chart"}
                className={[
                  "px-2.5 py-1 rounded-lg transition inline-flex items-center justify-center",
                  "bg-white/10 text-white hover:bg-white/15",
                ].join(" ")}
              >
                {lineMode ? (
                  <ChartCandlestick className="w-3.5 h-3.5" />
                ) : (
                  <ChartLine className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <div className="h-[290px] sm:h-[310px] w-full touch-pan-y">
            {!chart || isChartLoading ? (
              <div className="h-full w-full flex items-center justify-center">
                <Skeleton className="h-full w-full rounded-sm bg-transparent border-none p-3" />
              </div>
            ) : (
              <Liveline
                mode="candle"
                theme="dark"
                color={isUp ? APP_POSITIVE_HEX : APP_NEGATIVE_HEX}
                data={chart.ticks}
                value={chart.value}
                candles={chart.candles}
                liveCandle={chart.liveCandle}
                candleWidth={effectiveCandleWidthSecs}
                lineMode={lineMode}
                lineData={chart.ticks}
                lineValue={chart.value}
                window={chartWindowSecs}
                grid={false}
                fill={false}
                badge={false}
                badgeVariant="minimal"
                pulse
                scrub={!isTouchDevice}
                exaggerate={lineMode}
                formatValue={(v) => `$${formatUsd(v)}`}
                padding={{ top: 26, right: 10, bottom: 34, left: 8 }}
              />
            )}
          </div>
          </div>
        </div>
        <Button
          type="button"
          onClick={openReceiveDrawer}
          className="mt-4 w-full"
        >
          Deposit
        </Button>
          </div>
        </div>
      )}
    </ReceiveDrawerController>
  );
}
