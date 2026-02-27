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
    draftRecipient?: string;
    draftAmount?: string;
    draftToken?: string;
    splitUrl?: string;
  };
  allowMutations?: boolean;
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
  // Use request origin for internal API hops to avoid cross-origin redirects
  // that can strip Authorization headers.
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

function asErrorCode(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
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
  const errorCode = asErrorCode(data);
  return {
    ok: false,
    source,
    status: status ?? null,
    errorCode,
    errorCategory: classifyToolError(status, message),
    error: message,
    // Strong hint for the model to avoid inventing causes.
    assistantHandlingHint:
      "Use the exact error text. Do not say 'missing credentials' unless the error explicitly mentions auth/token/credentials.",
  };
}

function makePreviewResult(
  action: string,
  summary: string,
  payload: Record<string, unknown>
) {
  return {
    ok: true,
    requiresConfirmation: true,
    action,
    summary,
    payload,
    confirmInstruction:
      "Ask the user to confirm. After they confirm, run the same action again.",
  };
}

function resolveTokenSymbol(inputToken: unknown, amount: unknown) {
  const token = String(inputToken ?? "").trim().toUpperCase();
  const amountText = String(amount ?? "").trim();

  if (!token) return "USDC";
  if (token === "$" || token === "USD") return "USDC";
  if (amountText.includes("$") && (token === "USDT" || token === "DAI")) return token;
  if (amountText.includes("$") && token === "USDC.E") return "USDC";
  return token;
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
  const allowMutations = body.allowMutations === true;
  const commonAgentHeaders = {
    Authorization: `Bearer ${authed.token}`,
    "x-tab-user-id": String(authed.user.id ?? ""),
    "Content-Type": "application/json",
    ...getInternalRequestHeaders(),
  };

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
        const result = await callJson(
          req,
          `/api/moralis/portfolio?${params.toString()}`,
          { headers: { ...getInternalRequestHeaders() } }
        );
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
        };
      },
    }),

    send_payment: tool({
      description:
        "Send a token payment from the user's delegated wallet under server access guardrails.",
      inputSchema: z.object({
        recipient: z.string().min(1),
        amount: z.string().min(1),
        token: z.string().optional(),
        note: z.string().optional(),
        requestId: z.string().optional(),
      }),
      execute: async (input) => {
        const token = resolveTokenSymbol(input?.token, input?.amount);
        const payload = { ...input, token };

        if (!allowMutations) {
          return makePreviewResult(
            "send_payment",
            `Send ${input.amount} ${token} to ${input.recipient}`,
            payload
          );
        }

        const result = await callJson(req, "/api/server/send", {
          method: "POST",
          headers: commonAgentHeaders,
          body: JSON.stringify({
            ...payload,
            requestId: input.requestId ?? crypto.randomUUID(),
          }),
        });

        if (!result.ok) {
          return toolFailure("send_payment", result.status, result.data, "Send failed");
        }

        return result.data;
      },
    }),

    create_split: tool({
      description:
        "Create an invited split with Farcaster usernames and return a Tab split URL.",
      inputSchema: z.object({
        amount: z.string().min(1),
        users: z.array(z.string().min(1)).min(1).max(20),
        token: z.string().optional(),
        description: z.string().optional(),
      }),
      execute: async (input) => {
        const token = resolveTokenSymbol(input?.token, input?.amount);
        const payload = { ...input, token };

        if (!allowMutations) {
          return makePreviewResult(
            "create_split",
            `Create a split for ${input.amount} ${token} with ${input.users.join(", ")}`,
            payload
          );
        }

        const result = await callJson(req, "/api/server/split/create", {
          method: "POST",
          headers: commonAgentHeaders,
          body: JSON.stringify(payload),
        });

        if (!result.ok) {
          return toolFailure(
            "create_split",
            result.status,
            result.data,
            "Split creation failed"
          );
        }

        return result.data;
      },
    }),

    settle_split: tool({
      description:
        "Settle the user's split share for a specific split (id/code/url) or the latest eligible pending split.",
      inputSchema: z.object({
        splitId: z.string().optional(),
        splitCode: z.string().optional(),
        splitUrl: z.string().url().optional(),
      }),
      execute: async (input) => {
        if (!allowMutations) {
          return makePreviewResult(
            "settle_split",
            input.splitUrl || input.splitCode || input.splitId
              ? "Settle the specified split share"
              : "Settle the latest eligible split share",
            input
          );
        }

        const result = await callJson(req, "/api/server/settle", {
          method: "POST",
          headers: commonAgentHeaders,
          body: JSON.stringify(input),
        });

        if (!result.ok) {
          return toolFailure(
            "settle_split",
            result.status,
            result.data,
            "Settlement failed"
          );
        }

        return result.data;
      },
    }),

    enter_jackpot: tool({
      description:
        "Record a jackpot/spin entry in Tab for the authenticated user (requires explicit user confirmation).",
      inputSchema: z.object({
        amount: z.number().positive(),
        ticketCount: z.number().int().positive().optional(),
      }),
      execute: async (input) => {
        if (!primaryAddress || !farcaster.fid) {
          return {
            ok: false,
            error: "Missing wallet address or Farcaster account required for jackpot entry.",
          };
        }

        if (!allowMutations) {
          return makePreviewResult(
            "enter_jackpot",
            `Record jackpot entry for $${input.amount} (${input.ticketCount ?? 0} tickets)`,
            input
          );
        }

        const result = await callJson(req, "/api/jackpot", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalRequestHeaders(),
          },
          body: JSON.stringify({
            address: primaryAddress,
            fid: farcaster.fid,
            amount: input.amount,
            ticketCount: input.ticketCount ?? 0,
          }),
        });

        if (!result.ok) {
          return toolFailure(
            "enter_jackpot",
            result.status,
            result.data,
            "Jackpot entry failed"
          );
        }

        return {
          ok: true,
          success: true,
          amount: input.amount,
          ticketCount: input.ticketCount ?? 0,
          address: primaryAddress,
          fid: farcaster.fid,
        };
      },
    }),
  };

  const contextText = body.context
    ? JSON.stringify(
        {
          pathname: body.context.pathname ?? null,
          draftRecipient: body.context.draftRecipient ?? null,
          draftAmount: body.context.draftAmount ?? null,
          draftToken: body.context.draftToken ?? null,
          splitUrl: body.context.splitUrl ?? null,
        },
        null,
        0
      )
    : "{}";

  const result = streamText({
    model: openai(process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini"),
    system: [
      "You are Tab Assistant inside the Tab app.",
      "Primary goals: help users send money, create/split bills, settle split shares, check portfolio balances, and enter jackpot/spin.",
      "Use tools instead of guessing outcomes for balances and actions.",
      "For portfolio questions: default to summary mode (show total in USD, no cards).",
      "For payment/split amounts in dollars (e.g. '$12', '12 dollars', 'USD'), default token to USDC unless user explicitly asks for another token.",
      "Use breakdown=true only if user explicitly asks for breakdown/by token/cards/top tokens.",
      "When summary mode is used, reply with total only and keep it short (example: 'you've got $234.00').",
      "Avoid repeating the same portfolio amount in both text and UI.",
      "If UI shows the big portfolio metric, keep text to a short lead-in and do not restate the exact number.",
      "If UI shows breakdown cards, do not also dump a long token-by-token list in text.",
      "Be super casual and short.",
      "Keep responses to 1-2 short sentences by default.",
      "Do not use long numbered lists unless the user explicitly asks for a checklist.",
      "If info is missing, ask only one quick follow-up question.",
      "Never claim a payment/split/jackpot action executed unless a tool returns success.",
      "When a tool returns ok=false, use the tool's exact `error` text in your response and avoid inventing causes.",
      "Only say credentials/auth are missing if the tool error explicitly mentions auth, token, authorization, or credentials (or status is 401).",
      "For 403 errors, prefer permission/policy language. For 404 errors, say not found. For 503/500 errors, say temporary/internal issue.",
      allowMutations
        ? "The user explicitly confirmed a pending action in this turn. You may execute one matching mutating tool if appropriate."
        : "Mutating tools are in preview mode this turn. If a mutating tool returns requiresConfirmation=true, ask for confirmation before execution.",
      `Current authenticated user context: wallet=${primaryAddress ?? "unknown"}, fid=${farcaster.fid ?? "unknown"}, username=${farcaster.username ?? "unknown"}.`,
      `UI context: ${contextText}`,
      "If a user asks to 'spin', interpret that as jackpot entry/logging unless they clarify another game action.",
    ].join("\n"),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(6),
  });

  return result.toUIMessageStreamResponse();
}
