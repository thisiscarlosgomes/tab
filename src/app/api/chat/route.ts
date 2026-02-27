import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  getInternalRequestHeaders,
  requireTrustedRequest,
} from "@/lib/security";
import { getPrivyAuthedUserFromAuthorization } from "@/lib/user-profile";

export const maxDuration = 30;

type LinkedAccountLike = {
  type?: string;
  chain_type?: string;
  chainType?: string;
  wallet_client_type?: string;
  walletClientType?: string;
  address?: string | null;
  fid?: number | string | null;
  username?: string | null;
};

type ChatRouteBody = {
  messages?: UIMessage[];
  context?: {
    pathname?: string;
  };
};

type ActivityRecord = {
  type?: string;
  amount?: number;
  token?: string;
  timestamp?: string | Date;
  recipient?: string;
  recipientUsername?: string;
  counterparty?: string;
  counterpartyAddress?: string;
};

function toLinkedAccounts(input: unknown): LinkedAccountLike[] {
  if (!input || typeof input !== "object") return [];
  const maybe =
    (input as { linked_accounts?: unknown; linkedAccounts?: unknown }).linked_accounts ??
    (input as { linked_accounts?: unknown; linkedAccounts?: unknown }).linkedAccounts;
  return Array.isArray(maybe) ? (maybe as LinkedAccountLike[]) : [];
}

function normalizeAddress(value: unknown) {
  const v = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(v) ? v : null;
}

function findPrimaryPrivyAddress(accounts: LinkedAccountLike[]) {
  for (const account of accounts) {
    const isWallet = account.type === "wallet";
    const isEth =
      account.chain_type === "ethereum" || account.chainType === "ethereum";
    const isPrivy =
      account.wallet_client_type === "privy" || account.walletClientType === "privy";
    const address = normalizeAddress(account.address);
    if (isWallet && isEth && isPrivy && address) return address;
  }
  return null;
}

function findFarcasterIdentity(user: unknown, accounts: LinkedAccountLike[]) {
  const userObj = (user && typeof user === "object" ? user : {}) as {
    farcaster?: { fid?: number | string | null; username?: string | null } | null;
  };
  const fromUser = userObj.farcaster ?? null;
  const userFid = Number(fromUser?.fid);
  if (Number.isFinite(userFid) && userFid > 0) {
    return {
      fid: userFid,
      username:
        typeof fromUser?.username === "string" ? fromUser.username.trim() || null : null,
    };
  }

  for (const account of accounts) {
    if (account.type !== "farcaster") continue;
    const fid = Number(account.fid);
    if (!Number.isFinite(fid) || fid <= 0) continue;
    return {
      fid,
      username:
        typeof account.username === "string" ? account.username.trim() || null : null,
    };
  }

  return { fid: null, username: null };
}

function getBaseUrl(req: NextRequest) {
  return req.nextUrl.origin.replace(/\/$/, "");
}

async function callJson(req: NextRequest, path: string, init?: RequestInit) {
  const res = await fetch(`${getBaseUrl(req)}${path}`, init);
  const data = (await res.json().catch(() => null)) as unknown;
  return { ok: res.ok, status: res.status, data };
}

function asErrorMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const err = (data as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return err.trim();
  }
  return fallback;
}

function classifyToolError(status: number | undefined, message: string) {
  const m = message.toLowerCase();
  const mentionsCredentials =
    /credential|auth|authorization|token|identity token|invalid auth/.test(m);

  if (mentionsCredentials || status === 401) return "credentials";
  if (status === 403) return "permissions";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limit";
  if (status === 503) return "temporary_unavailable";
  if (status && status >= 500) return "server_error";
  return "request_error";
}

function toolFailure(
  source: string,
  status: number | undefined,
  data: unknown,
  fallback: string
) {
  const message = asErrorMessage(data, fallback);
  return {
    ok: false,
    source,
    status: status ?? null,
    errorCategory: classifyToolError(status, message),
    error: message,
    assistantHandlingHint:
      "Use the exact error text. Do not say 'missing credentials' unless the error explicitly mentions auth/token/credentials.",
  };
}

function isOutgoingActivity(activity: ActivityRecord) {
  const t = String(activity.type ?? "").toLowerCase();
  return t === "bill_paid" || t === "room_paid";
}

function usdAmountFromActivity(activity: ActivityRecord) {
  const amount = Number(activity.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const token = String(activity.token ?? "").trim().toUpperCase();
  if (["USDC", "USDC.E", "USDT", "DAI", "EURC", "USD"].includes(token)) {
    return amount;
  }
  return 0;
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfWeekUtc() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day + 6) % 7;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function parseTimestamp(value: unknown) {
  const d = new Date(String(value ?? ""));
  return Number.isNaN(d.getTime()) ? null : d;
}

async function fetchActivity(req: NextRequest, address: string, limit = 100) {
  const params = new URLSearchParams({ address, limit: String(limit) });
  const result = await callJson(req, `/api/activity?${params.toString()}`, {
    headers: { ...getInternalRequestHeaders() },
  });
  if (!result.ok) return result;

  const payload = (result.data ?? {}) as {
    activity?: ActivityRecord[];
  };

  return {
    ok: true,
    status: result.status,
    data: {
      activity: Array.isArray(payload.activity) ? payload.activity : [],
    },
  };
}

function computeSpendingInsights(activity: ActivityRecord[]) {
  const outgoing = activity.filter(isOutgoingActivity);
  const todayStart = startOfTodayUtc();
  const weekStart = startOfWeekUtc();

  let todayUsd = 0;
  let weekUsd = 0;
  let allTimeUsd = 0;
  let todayCount = 0;
  let weekCount = 0;
  let allTimeCount = 0;

  const sentCounterparty = new Map<string, { txCount: number; totalUsd: number }>();

  for (const item of outgoing) {
    const ts = parseTimestamp(item.timestamp);
    const usd = usdAmountFromActivity(item);
    const labelRaw =
      item.recipientUsername || item.counterparty || item.recipient || item.counterpartyAddress;
    const label = String(labelRaw ?? "").trim();

    if (usd > 0) {
      allTimeUsd += usd;
      allTimeCount += 1;
      if (ts && ts >= weekStart) {
        weekUsd += usd;
        weekCount += 1;
      }
      if (ts && ts >= todayStart) {
        todayUsd += usd;
        todayCount += 1;
      }

      if (label) {
        const prev = sentCounterparty.get(label) ?? { txCount: 0, totalUsd: 0 };
        prev.txCount += 1;
        prev.totalUsd += usd;
        sentCounterparty.set(label, prev);
      }
    }
  }

  const topSentWallet = [...sentCounterparty.entries()]
    .map(([target, value]) => ({ target, ...value }))
    .sort((a, b) => b.totalUsd - a.totalUsd)[0] ?? null;

  return {
    todayUsd,
    weekUsd,
    allTimeUsd,
    todayCount,
    weekCount,
    allTimeCount,
    topSentWallet,
  };
}

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "chat-post",
    limit: 30,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "Missing OPENAI_API_KEY for inline assistant" },
      { status: 500 }
    );
  }

  const authed = await getPrivyAuthedUserFromAuthorization(
    req.headers.get("authorization")
  );
  if (!authed.ok) return authed.response;

  const body = (await req.json().catch(() => ({}))) as ChatRouteBody;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    return Response.json({ error: "Missing messages" }, { status: 400 });
  }

  const linkedAccounts = toLinkedAccounts(authed.user);
  const primaryAddress = findPrimaryPrivyAddress(linkedAccounts);
  const farcaster = findFarcasterIdentity(authed.user, linkedAccounts);

  const tools = {
    check_portfolio_balance: tool({
      description:
        "Get the user's current portfolio balances for their primary Tab wallet on Base.",
      inputSchema: z.object({
        symbol: z.string().optional().describe("Optional symbol filter like USDC or ETH"),
        breakdown: z
          .boolean()
          .optional()
          .describe("Set true only when user explicitly asks for token-by-token breakdown/cards."),
        topTokens: z.number().int().min(1).max(10).optional(),
        forceRefresh: z.boolean().optional(),
      }),
      execute: async (input) => {
        if (!primaryAddress) {
          return {
            ok: false,
            error: "No Privy wallet address found for this account.",
          };
        }

        const params = new URLSearchParams({ address: primaryAddress });
        if (input?.forceRefresh) params.set("force", "1");
        const result = await callJson(req, `/api/moralis/portfolio?${params.toString()}`, {
          headers: { ...getInternalRequestHeaders() },
        });
        if (!result.ok) {
          return toolFailure(
            "check_portfolio_balance",
            result.status,
            result.data,
            "Failed to fetch portfolio"
          );
        }

        const payload = (result.data ?? {}) as {
          totalBalanceUSD?: number;
          tokens?: Array<{
            symbol?: string;
            balance?: number;
            balanceUSD?: number;
            portfolioPercent?: number;
          }>;
        };

        const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
        const symbol = input?.symbol?.trim().toUpperCase();
        const wantsBreakdown = input?.breakdown === true;
        const topTokens = Number.isFinite(input?.topTokens)
          ? Math.min(Math.max(Number(input?.topTokens ?? 3), 1), 10)
          : 3;
        const filtered = symbol
          ? tokens.filter((t) => String(t.symbol ?? "").toUpperCase() === symbol)
          : tokens;
        const totalUsd = Number(payload.totalBalanceUSD ?? 0);

        return {
          ok: true,
          address: primaryAddress,
          totalBalanceUSD: totalUsd,
          totalUsd,
          currency: "USD",
          showCards: wantsBreakdown,
          tokens: wantsBreakdown ? filtered.slice(0, topTokens) : [],
          requestedSymbol: symbol ?? null,
          portfolioMode: wantsBreakdown ? "breakdown" : "summary",
          preferToolCardOnly: true,
        };
      },
    }),

    get_spending_overview: tool({
      description:
        "Get spending for today, this week, or all-time and identify top sent wallet based on outgoing activity.",
      inputSchema: z.object({
        period: z.enum(["today", "week", "all"]).optional(),
        includeTopSentWallet: z.boolean().optional(),
      }),
      execute: async (input) => {
        if (!primaryAddress) {
          return {
            ok: false,
            error: "No Privy wallet address found for this account.",
          };
        }

        const activityResult = await fetchActivity(req, primaryAddress, 100);
        if (!activityResult.ok) {
          return toolFailure(
            "get_spending_overview",
            activityResult.status,
            activityResult.data,
            "Failed to fetch activity"
          );
        }

        const activity = ((activityResult.data as { activity?: ActivityRecord[] })?.activity ?? []) as ActivityRecord[];
        const insights = computeSpendingInsights(activity);
        const period = input?.period ?? "today";
        const periodTotalUsd =
          period === "today"
            ? insights.todayUsd
            : period === "week"
              ? insights.weekUsd
              : insights.allTimeUsd;

        return {
          ok: true,
          address: primaryAddress,
          period,
          periodTotalUsd,
          totals: {
            todayUsd: insights.todayUsd,
            weekUsd: insights.weekUsd,
            allTimeUsd: insights.allTimeUsd,
          },
          counts: {
            today: insights.todayCount,
            week: insights.weekCount,
            all: insights.allTimeCount,
          },
          topSentWallet: input?.includeTopSentWallet ? insights.topSentWallet : insights.topSentWallet,
          preferToolCardOnly: true,
        };
      },
    }),

    get_split_overview: tool({
      description:
        "Get latest splits for this user, including paid and unpaid split status.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: async (input) => {
        if (!primaryAddress && !farcaster.fid) {
          return {
            ok: false,
            error: "Missing wallet address and Farcaster account for split lookup.",
          };
        }

        const params = new URLSearchParams();
        if (primaryAddress) params.set("address", primaryAddress);
        if (farcaster.fid) params.set("fid", String(farcaster.fid));
        params.set("limit", String(input?.limit ?? 10));

        const result = await callJson(req, `/api/user-bills?${params.toString()}`, {
          headers: { ...getInternalRequestHeaders() },
        });

        if (!result.ok) {
          return toolFailure(
            "get_split_overview",
            result.status,
            result.data,
            "Failed to fetch splits"
          );
        }

        const payload = (result.data ?? {}) as {
          bills?: Array<{
            splitId?: string;
            description?: string;
            token?: string;
            totalAmount?: number;
            perPersonAmount?: number;
            hasPaid?: boolean;
            isSettled?: boolean;
            createdAt?: string;
            userStatus?: string | null;
            paidCount?: number;
            debtors?: number;
          }>;
        };

        const bills = Array.isArray(payload.bills) ? payload.bills : [];
        const latestSplits = bills.slice(0, 5);
        const paidSplits = bills.filter((b) => b.hasPaid === true);
        const pendingSplits = bills.filter((b) => b.hasPaid === false);

        return {
          ok: true,
          latestSplits,
          totalSplits: bills.length,
          paidSplitCount: paidSplits.length,
          pendingSplitCount: pendingSplits.length,
          latestPaidSplit: paidSplits[0] ?? null,
          preferToolCardOnly: true,
        };
      },
    }),

    get_jackpot_status: tool({
      description:
        "Get whether jackpot/spin is active for the user and their latest spin status.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!farcaster.fid) {
          return {
            ok: false,
            error: "Missing Farcaster account required for jackpot status.",
          };
        }

        const [spinResult, recentResult] = await Promise.all([
          callJson(req, `/api/daily-spin?fid=${farcaster.fid}`, {
            headers: { ...getInternalRequestHeaders() },
          }),
          callJson(req, "/api/jackpot", {
            headers: { ...getInternalRequestHeaders() },
          }),
        ]);

        if (!spinResult.ok) {
          return toolFailure(
            "get_jackpot_status",
            spinResult.status,
            spinResult.data,
            "Failed to fetch jackpot status"
          );
        }

        const spin = (spinResult.data ?? {}) as {
          canSpin?: boolean;
          nextEligibleSpinAt?: string | null;
          latestResult?: { reward?: string } | null;
          spinsToday?: number;
          totalSpins?: number;
          streak?: number;
        };

        const recentUsers =
          recentResult.ok && recentResult.data && typeof recentResult.data === "object"
            ? Array.isArray((recentResult.data as { users?: unknown[] }).users)
              ? (recentResult.data as { users?: unknown[] }).users!.length
              : 0
            : 0;

        return {
          ok: true,
          canSpin: Boolean(spin.canSpin),
          nextEligibleSpinAt: spin.nextEligibleSpinAt ?? null,
          latestResult: spin.latestResult ?? null,
          spinsToday: Number(spin.spinsToday ?? 0),
          totalSpins: Number(spin.totalSpins ?? 0),
          streak: Number(spin.streak ?? 0),
          recentParticipants: recentUsers,
          active: Boolean(spin.canSpin),
          preferToolCardOnly: true,
        };
      },
    }),

    get_earnings_overview: tool({
      description:
        "Get earnings/earn deposits summary for the user's wallet, including latest entries and active status.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async (input) => {
        if (!primaryAddress) {
          return {
            ok: false,
            error: "No Privy wallet address found for this account.",
          };
        }

        const limit = input?.limit ?? 10;
        const result = await callJson(req, `/api/earn/${primaryAddress}?limit=${limit}`, {
          headers: { ...getInternalRequestHeaders() },
        });

        if (!result.ok) {
          return toolFailure(
            "get_earnings_overview",
            result.status,
            result.data,
            "Failed to fetch earnings"
          );
        }

        const payload = (result.data ?? {}) as {
          total?: number;
          deposits?: Array<{ amount?: number; timestamp?: string; txHash?: string | null }>;
        };

        const deposits = Array.isArray(payload.deposits) ? payload.deposits : [];
        const total = Number(payload.total ?? 0);

        return {
          ok: true,
          address: primaryAddress,
          totalDepositedUsd: total,
          depositCount: deposits.length,
          latestDeposit: deposits[0] ?? null,
          deposits,
          active: total > 0 || deposits.length > 0,
          preferToolCardOnly: true,
        };
      },
    }),

    get_account_overview: tool({
      description:
        "Fetch a combined read-only overview: portfolio, spending, splits, jackpot, and earnings.",
      inputSchema: z.object({
        includeBreakdown: z.boolean().optional(),
      }),
      execute: async (input) => {
        if (!primaryAddress) {
          return {
            ok: false,
            error: "No Privy wallet address found for this account.",
          };
        }

        const portfolioParams = new URLSearchParams({ address: primaryAddress });
        const splitParams = new URLSearchParams();
        splitParams.set("address", primaryAddress);
        if (farcaster.fid) splitParams.set("fid", String(farcaster.fid));
        splitParams.set("limit", "10");

        const [portfolioResult, activityResult, splitResult, earnResult, spinResult] = await Promise.all([
          callJson(req, `/api/moralis/portfolio?${portfolioParams.toString()}`, {
            headers: { ...getInternalRequestHeaders() },
          }),
          fetchActivity(req, primaryAddress, 100),
          callJson(req, `/api/user-bills?${splitParams.toString()}`, {
            headers: { ...getInternalRequestHeaders() },
          }),
          callJson(req, `/api/earn/${primaryAddress}?limit=10`, {
            headers: { ...getInternalRequestHeaders() },
          }),
          farcaster.fid
            ? callJson(req, `/api/daily-spin?fid=${farcaster.fid}`, {
                headers: { ...getInternalRequestHeaders() },
              })
            : Promise.resolve({ ok: false, status: 400, data: { error: "Missing fid" } }),
        ]);

        if (!portfolioResult.ok) {
          return toolFailure(
            "get_account_overview",
            portfolioResult.status,
            portfolioResult.data,
            "Failed to build account overview"
          );
        }

        const portfolio = (portfolioResult.data ?? {}) as {
          totalBalanceUSD?: number;
          tokens?: Array<{ symbol?: string; balance?: number; balanceUSD?: number; portfolioPercent?: number }>;
        };

        const activity = activityResult.ok
          ? (((activityResult.data as { activity?: ActivityRecord[] })?.activity ?? []) as ActivityRecord[])
          : [];
        const spending = computeSpendingInsights(activity);

        const bills = splitResult.ok && splitResult.data && typeof splitResult.data === "object"
          ? Array.isArray((splitResult.data as { bills?: unknown[] }).bills)
            ? ((splitResult.data as { bills?: unknown[] }).bills as Array<Record<string, unknown>>)
            : []
          : [];

        const earn = (earnResult.ok ? earnResult.data : null) as
          | { total?: number; deposits?: Array<{ amount?: number; timestamp?: string; txHash?: string | null }> }
          | null;

        const spin = (spinResult.ok ? spinResult.data : null) as
          | { canSpin?: boolean; nextEligibleSpinAt?: string | null; spinsToday?: number; totalSpins?: number; streak?: number }
          | null;

        const tokens = Array.isArray(portfolio.tokens) ? portfolio.tokens : [];

        return {
          ok: true,
          portfolio: {
            totalUsd: Number(portfolio.totalBalanceUSD ?? 0),
            showCards: Boolean(input?.includeBreakdown),
            tokens: input?.includeBreakdown ? tokens.slice(0, 5) : [],
          },
          spending: {
            todayUsd: spending.todayUsd,
            weekUsd: spending.weekUsd,
            allTimeUsd: spending.allTimeUsd,
            topSentWallet: spending.topSentWallet,
          },
          splits: {
            total: bills.length,
            latest: bills.slice(0, 3),
            paidCount: bills.filter((b) => b.hasPaid === true).length,
          },
          earnings: {
            totalDepositedUsd: Number(earn?.total ?? 0),
            depositCount: Array.isArray(earn?.deposits) ? earn!.deposits!.length : 0,
            latestDeposit:
              Array.isArray(earn?.deposits) && earn!.deposits!.length > 0
                ? earn!.deposits![0]
                : null,
          },
          jackpot: {
            active: Boolean(spin?.canSpin),
            canSpin: Boolean(spin?.canSpin),
            nextEligibleSpinAt: spin?.nextEligibleSpinAt ?? null,
            spinsToday: Number(spin?.spinsToday ?? 0),
            totalSpins: Number(spin?.totalSpins ?? 0),
            streak: Number(spin?.streak ?? 0),
          },
        };
      },
    }),
  };

  const contextText = body.context
    ? JSON.stringify(
        {
          pathname: body.context.pathname ?? null,
        },
        null,
        0
      )
    : "{}";

  const result = streamText({
    model: openai(process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini"),
    system: [
      "You are Tab Assistant inside the Tab app.",
      "You are currently in READ-ONLY mode.",
      "Never execute or suggest executing writes (send, split creation/settlement, jackpot entry, transfers).",
      "If user asks to perform a write action, say read-only mode and offer to show relevant data instead.",
      "Primary goals: answer wallet analytics questions with tools: portfolio, portfolio change, spending today/week/all-time, top sent wallet, latest/paid splits, jackpot status, earnings.",
      "Use tools instead of guessing outcomes.",
      "For portfolio questions: default to summary mode (show total in USD, no cards).",
      "Use breakdown=true only if user explicitly asks for breakdown/by token/cards/top tokens.",
      "When summary mode is used and UI shows big number, keep text minimal.",
      "If UI shows breakdown cards, avoid repeating a long token list in text.",
      "Be super casual and short.",
      "Keep responses to 1-2 short sentences by default.",
      "Do not use long numbered lists unless the user asks for a checklist.",
      "If info is missing, ask only one quick follow-up question.",
      "When a tool returns ok=false, use the exact error text and do not invent causes.",
      "Only say credentials/auth are missing if error explicitly mentions auth, token, authorization, credentials, or status is 401.",
      "For 403 errors, use permission language. For 404, say not found. For 503/500, say temporary/internal issue.",
      `Current authenticated user context: wallet=${primaryAddress ?? "unknown"}, fid=${farcaster.fid ?? "unknown"}, username=${farcaster.username ?? "unknown"}.`,
      `UI context: ${contextText}`,
    ].join("\n"),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(6),
  });

  return result.toUIMessageStreamResponse();
}
