type MoralisPortfolioToken = {
  symbol?: string;
  balance?: number;
  networkName?: string | null;
};

type MoralisPortfolioResponse = {
  totalBalanceUSD?: number;
  tokens?: MoralisPortfolioToken[];
};

const CACHE_TTL_MS = 12_000;

const portfolioCache = new Map<
  string,
  { ts: number; value: MoralisPortfolioResponse }
>();

function isBaseNetwork(networkName: string | null | undefined) {
  return (networkName ?? "").toLowerCase().includes("base");
}

function symbolKey(symbol: string | undefined) {
  return (symbol ?? "").trim().toUpperCase();
}

export async function fetchMoralisPortfolio(
  address: string,
  options?: { force?: boolean }
): Promise<MoralisPortfolioResponse> {
  const normalized = address.toLowerCase();
  const cached = portfolioCache.get(normalized);

  if (!options?.force && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const res = await fetch(`/api/moralis/portfolio?address=${normalized}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return cached?.value ?? { totalBalanceUSD: 0, tokens: [] };
    }

    const data = (await res.json()) as MoralisPortfolioResponse;
    const normalizedData: MoralisPortfolioResponse = {
      totalBalanceUSD: Number(data?.totalBalanceUSD ?? 0),
      tokens: Array.isArray(data?.tokens) ? data.tokens : [],
    };

    portfolioCache.set(normalized, { ts: Date.now(), value: normalizedData });
    return normalizedData;
  } catch {
    return cached?.value ?? { totalBalanceUSD: 0, tokens: [] };
  }
}

export async function getMoralisTokenBalances(
  address: string,
  options?: { baseOnly?: boolean; force?: boolean }
): Promise<Record<string, string>> {
  const baseOnly = options?.baseOnly ?? true;
  const portfolio = await fetchMoralisPortfolio(address, { force: options?.force });
  const balancesBySymbol: Record<string, number> = {};

  for (const token of portfolio.tokens ?? []) {
    if (baseOnly && !isBaseNetwork(token.networkName)) continue;
    const key = symbolKey(token.symbol);
    if (!key) continue;
    const numericBalance = Number(token.balance ?? 0);
    if (!Number.isFinite(numericBalance)) continue;
    balancesBySymbol[key] = (balancesBySymbol[key] ?? 0) + numericBalance;
  }

  return Object.fromEntries(
    Object.entries(balancesBySymbol).map(([key, value]) => [key, String(value)])
  );
}

export async function getMoralisBalanceForSymbol(
  address: string,
  symbol: string,
  options?: { baseOnly?: boolean; force?: boolean }
): Promise<string> {
  const balances = await getMoralisTokenBalances(address, options);
  return balances[symbolKey(symbol)] ?? "0";
}

