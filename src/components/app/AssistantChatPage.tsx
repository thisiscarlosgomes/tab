"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  ArrowUp,
  Check,
  Loader2,
  PiggyBank,
  SendHorizonal,
  SplitSquareVertical,
  TrendingDown,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type FormEvent, type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useIdentityToken, usePrivy, useToken } from "@privy-io/react-auth";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

type ToolPreviewPart = {
  type?: string;
  state?: string;
  output?: {
    requiresConfirmation?: boolean;
    summary?: string;
    action?: string;
    [key: string]: unknown;
  };
  input?: Record<string, unknown>;
  errorText?: string;
};

type StarterPrompt = {
  key: string;
  eyebrow: string;
  title: string;
  prompt: string;
  icon: ComponentType<{ className?: string }>;
  iconTone: string;
};

type ActionSuccessDialog = {
  key: string;
  title: string;
  subtitle: string;
  detail?: string;
};

const STARTER_PROMPTS: StarterPrompt[] = [
  {
    key: "balance",
    eyebrow: "Portfolio check",
    title: "Show my balances and what changed today.",
    prompt: "What is my current portfolio balance and top tokens?",
    icon: TrendingDown,
    iconTone: "bg-[#f4ecd8] text-[#7a5d2d]",
  },
  {
    key: "split",
    eyebrow: "Split a bill",
    title: "I found a bill, help me split it with friends.",
    prompt: "Help me create a split",
    icon: SplitSquareVertical,
    iconTone: "bg-[#edf0ff] text-[#3c4c9e]",
  },
  {
    key: "send",
    eyebrow: "Send money",
    title: "Pay someone fast from my Tab wallet.",
    prompt: "Help me send money",
    icon: Wallet,
    iconTone: "bg-[#e7f7e8] text-[#206a34]",
  },
];

function isToolPart(part: unknown): part is ToolPreviewPart {
  return Boolean(
    part &&
      typeof part === "object" &&
      typeof (part as { type?: unknown }).type === "string" &&
      String((part as { type?: string }).type).startsWith("tool-")
  );
}

function getTextParts(message: unknown) {
  if (!message || typeof message !== "object") return [];
  const parts = (message as { parts?: unknown[] }).parts;
  if (!Array.isArray(parts)) return [];
  return parts.filter(
    (part): part is { type: "text"; text: string } =>
      Boolean(
        part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string"
      )
  );
}

function getToolParts(message: unknown) {
  if (!message || typeof message !== "object") return [];
  const parts = (message as { parts?: unknown[] }).parts;
  if (!Array.isArray(parts)) return [];
  return parts.filter(isToolPart);
}

function prettifyToolName(type?: string) {
  return String(type ?? "tool").replace(/^tool-/, "").replace(/_/g, " ").trim();
}

function getToolOutput(part: ToolPreviewPart) {
  return (part.output && typeof part.output === "object" ? part.output : {}) as Record<
    string,
    unknown
  >;
}

function getPreviewSummary(part: ToolPreviewPart) {
  const output = getToolOutput(part);
  return typeof output.summary === "string"
    ? output.summary
    : "Review this action before continuing.";
}

function getConfirmationKey(part: ToolPreviewPart | undefined) {
  if (!part) return null;
  const output = getToolOutput(part);
  return `${part.type ?? "tool"}:${String(output.action ?? "")}:${String(output.summary ?? "")}`;
}

function renderInlineMarkdown(text: string) {
  const nodes: Array<string | JSX.Element> = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(
      <span key={`b-${match.index}`} className="font-semibold text-white">
        {match[1]}
      </span>
    );
    last = regex.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));

  return nodes.length ? nodes : text;
}

function toAmountLabel(output: Record<string, unknown>) {
  const amount = output.amount;
  if (amount === undefined || amount === null) return null;
  const token = String(output.token ?? output.currency ?? "").trim();
  return `${String(amount)}${token ? ` ${token}` : ""}`;
}

function getLatestActionSuccessDialog(messages: unknown[]): ActionSuccessDialog | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    if ((message as { role?: string }).role !== "assistant") continue;
    const parts = getToolParts(message);
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j];
      const type = String(part.type ?? "");
      if (
        type !== "tool-send_payment" &&
        type !== "tool-create_split" &&
        type !== "tool-settle_split"
      ) {
        continue;
      }

      const output = getToolOutput(part);
      if (output.success !== true) continue;

      const uniqueSource =
        String(output.txHash ?? output.requestId ?? output.splitId ?? output.splitCode ?? "");
      const key = `${String((message as { id?: string }).id ?? i)}:${j}:${type}:${uniqueSource}`;

      if (type === "tool-send_payment") {
        const amountLabel = toAmountLabel(output) ?? "Payment sent";
        const recipient = String(output.recipientUsername ?? output.recipientAddress ?? "").trim();
        return {
          key,
          title: amountLabel,
          subtitle: recipient ? `Sent to ${recipient}` : "Payment sent successfully",
          detail: typeof output.txHash === "string" ? `Tx: ${output.txHash}` : undefined,
        };
      }

      if (type === "tool-create_split") {
        const amountLabel = toAmountLabel(output) ?? "Split created";
        const description = String(output.description ?? "").trim();
        return {
          key,
          title: amountLabel,
          subtitle: description || "Split created successfully",
          detail:
            typeof output.splitCode === "string" ? `Code: ${output.splitCode}` : undefined,
        };
      }

      const amountLabel = toAmountLabel(output) ?? "Split settled";
      return {
        key,
        title: amountLabel,
        subtitle: "Split payment completed",
        detail: typeof output.txHash === "string" ? `Tx: ${output.txHash}` : undefined,
      };
    }
  }
  return null;
}

export function AssistantChatPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { getAccessToken } = useToken();

  const [input, setInput] = useState("");
  const [confirmSheetOpen, setConfirmSheetOpen] = useState(false);
  const [actionSuccessDialog, setActionSuccessDialog] = useState<ActionSuccessDialog | null>(null);
  const lastConfirmationKeyRef = useRef<string | null>(null);
  const lastActionSuccessKeyRef = useRef<string | null>(null);

  const context = useMemo(
    () => ({
      pathname: pathname ?? "/assistant",
      splitUrl:
        pathname?.startsWith("/split/") && typeof window !== "undefined"
          ? window.location.href
          : undefined,
      draftRecipient: searchParams?.get("recipient") ?? undefined,
      draftAmount: searchParams?.get("amount") ?? undefined,
      draftToken: searchParams?.get("token") ?? undefined,
    }),
    [pathname, searchParams]
  );

  const greetingName = useMemo(() => {
    const farcaster = user?.farcaster;
    const displayName =
      typeof farcaster?.displayName === "string"
        ? farcaster.displayName
        : typeof farcaster?.display_name === "string"
          ? farcaster.display_name
          : null;
    const username =
      typeof farcaster?.username === "string" ? farcaster.username : null;
    const source = displayName || username || "there";
    const first = source.trim().split(/\s+/)[0] || "there";
    return first;
  }, [user]);

  const { messages, sendMessage, status, error, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const isStreaming = status === "submitted" || status === "streaming";
  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === "assistant");
  const confirmationPreview = getToolParts(lastAssistantMessage).find(
    (part) => part.output?.requiresConfirmation
  );
  const hasToolLoading = useMemo(
    () =>
      messages.some((message) =>
        getToolParts(message).some(
          (part) => Boolean(part.state) && part.state !== "output-available"
        )
      ),
    [messages]
  );
  const confirmationKey = getConfirmationKey(confirmationPreview);
  const shouldShowGlobalLoading = useMemo(() => {
    if (!isStreaming || hasToolLoading) return false;
    if (!lastAssistantMessage) return true;

    const hasAssistantText = getTextParts(lastAssistantMessage).some((part) => part.text.trim().length > 0);
    const hasToolOutput = getToolParts(lastAssistantMessage).some((part) => {
      const hasOutputObject = Boolean(part.output && typeof part.output === "object");
      return part.state === "output-available" || hasOutputObject;
    });

    return !hasAssistantText && !hasToolOutput;
  }, [isStreaming, hasToolLoading, lastAssistantMessage]);

  useEffect(() => {
    if (!confirmationKey) return;
    if (confirmationKey === lastConfirmationKeyRef.current) return;
    lastConfirmationKeyRef.current = confirmationKey;
    setConfirmSheetOpen(true);
  }, [confirmationKey]);

  useEffect(() => {
    const latest = getLatestActionSuccessDialog(messages as unknown[]);
    if (!latest) return;
    if (latest.key === lastActionSuccessKeyRef.current) return;
    lastActionSuccessKeyRef.current = latest.key;
    setActionSuccessDialog(latest);
  }, [messages]);

  async function getBearer() {
    return identityToken ?? (await getAccessToken().catch(() => null));
  }

  async function submitMessage(text: string, allowMutations = false) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const bearer = await getBearer();
    if (!bearer) return;

    await sendMessage(
      { text: trimmed },
      {
        headers: { Authorization: `Bearer ${bearer}` },
        body: { context, allowMutations },
      }
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    const next = input;
    setInput("");
    await submitMessage(next, false);
  }

  async function onQuickPrompt(text: string) {
    if (isStreaming) return;
    await submitMessage(text, false);
  }

  async function onConfirmAction() {
    if (isStreaming) return;
    setConfirmSheetOpen(false);
    await submitMessage("Confirm and execute the last proposed action.", true);
  }

  function onClearChat() {
    if (isStreaming) return;
    setMessages([]);
    setInput("");
    setConfirmSheetOpen(false);
    setActionSuccessDialog(null);
    lastConfirmationKeyRef.current = null;
    lastActionSuccessKeyRef.current = null;
  }

  function renderToolCard(part: ToolPreviewPart, idxKey: string) {
    const output = getToolOutput(part);
    const toolName = prettifyToolName(part.type);
    const requestedBreakdown = Boolean(
      part.input &&
        typeof part.input === "object" &&
        (part.input as { breakdown?: unknown }).breakdown === true
    );
    const isLoadingState = part.state ? part.state !== "output-available" : false;
    const isPreview = output.requiresConfirmation === true;
    const isFailure = output.ok === false || typeof part.errorText === "string";
    const isSuccessLike =
      output.success === true ||
      (output.ok === true && !isPreview) ||
      toolName.includes("check portfolio balance");

    if (isLoadingState) {
      if (String(part.type ?? "").includes("check_portfolio_balance")) {
        if (!requestedBreakdown) {
          return (
            <div key={idxKey} className="inline-flex items-center gap-2 text-sm text-white/65">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking portfolio
            </div>
          );
        }

        return (
          <div
            key={idxKey}
            className="rounded-[24px] border border-white/10 bg-white/5 p-4 shadow-sm"
          >
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-3 w-28 border-white/0 bg-white/10" />
              <Skeleton className="h-10 w-36 border-white/0 bg-white/10" />
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-6 w-full border-white/0 bg-white/10" />
                <Skeleton className="h-6 w-full border-white/0 bg-white/10" />
              </div>
            </div>
          </div>
        );
      }

      return (
        <div
          key={idxKey}
          className="rounded-[20px] border border-white/10 bg-white/5 p-3"
        >
          <div className="space-y-2 w-full">
            <Skeleton className="h-3 w-24 border-white/0 bg-white/10" />
            <Skeleton className="h-5 w-[75%] border-white/0 bg-white/10" />
          </div>
        </div>
      );
    }

    if (isPreview) {
      return (
        <button
          type="button"
          key={idxKey}
          onClick={() => setConfirmSheetOpen(true)}
          className="w-full rounded-[20px] border border-white/10 bg-white/5 p-3 text-left shadow-sm"
        >
          <div className="min-w-0 flex-1">
            <div className="text-xs text-white/45">{toolName}</div>
            <div className="mt-0.5 text-[15px] font-medium leading-tight text-white">
              {getPreviewSummary(part)}
            </div>
            <div className="mt-2 text-xs text-white/50">Review and confirm</div>
          </div>
        </button>
      );
    }

    if (isFailure) {
      return (
        <div
          key={idxKey}
          className="rounded-[20px] border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200"
        >
          <div className="text-xs uppercase tracking-wide text-red-300">{toolName}</div>
          <div className="mt-1 font-medium">
            {String(output.error ?? part.errorText ?? "Something went wrong")}
          </div>
          {typeof output.status === "number" ? (
            <div className="mt-1 text-xs text-red-700/70">Status {output.status}</div>
          ) : null}
        </div>
      );
    }

    if (String(part.type ?? "").includes("check_portfolio_balance")) {
      const showCards = output.showCards === true;
      if (!showCards) {
        const total = Number(output.totalUsd ?? output.totalBalanceUSD ?? 0);

        return (
          <div key={idxKey} className="mt-1">
            <div className="text-[15px] text-white/65">Total wallet balance</div>
            <div className="mt-1 text-[62px] leading-[0.95] font-semibold tracking-tight text-white">
              ${total.toFixed(2)}
            </div>
          </div>
        );
      }
      const total = Number(output.totalBalanceUSD ?? 0);
      const tokens = Array.isArray(output.tokens)
        ? (output.tokens as Array<Record<string, unknown>>)
        : [];
      if (!tokens.length) return null;

        return (
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pr-6 scrollbar-hide">
            {tokens.map((token, i) => {
              const symbol = String(token.symbol ?? "TOKEN");
              const balance = Number(token.balance ?? 0);
              const usd = Number(token.balanceUSD ?? 0);
              return (
                <div
                  key={`${idxKey}-token-${i}`}
                  className="min-w-[88%] max-w-[88%] snap-start rounded-[24px] border border-white/10 bg-white/5 p-4 md:min-w-[82%] md:max-w-[82%] shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-white/45">{symbol}</div>
                    <div className="mt-1 text-[46px] leading-[0.98] font-semibold tracking-tight text-white">
                      {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="text-white/65">USD value</span>
                      <span className="font-medium text-white">${usd.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
            );
          })}
        </div>
      );
    }

    if (isSuccessLike) {
      const summary =
        typeof output.summary === "string"
          ? output.summary
          : typeof output.confirmation === "object" && output.confirmation
            ? "Action completed"
            : null;
      const amount =
        output.amount !== undefined
          ? `${String(output.amount)} ${String(output.token ?? output.currency ?? "").trim()}`.trim()
          : null;

      return (
        <div key={idxKey} className="rounded-[24px] border border-white/10 bg-white/5 p-4 shadow-sm">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-white/45">{toolName}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-white">{amount || "Done"}</div>
            {summary ? <div className="mt-1 text-sm text-white/55">{summary}</div> : null}
            {typeof output.txHash === "string" ? (
              <div className="mt-2 text-xs text-white/45 break-all">Tx: {output.txHash}</div>
            ) : null}
            {typeof output.splitUrl === "string" ? (
              <a
                href={output.splitUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex text-sm font-medium text-white"
              >
                Open split
              </a>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div key={idxKey} className="rounded-[20px] border border-white/10 bg-white/5 p-3 text-xs text-white/70">
        <div className="font-medium text-white">{toolName}</div>
        <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-white/55">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-background text-white pb-48 md:pb-44">
      <div className="fixed inset-x-0 top-0 z-30 px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-3 bg-gradient-to-b from-background via-background/95 to-transparent">
        <div className="mx-auto w-full max-w-3xl flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-white/80">Tab Assistant</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClearChat}
              disabled={isStreaming || messages.length === 0}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white shadow-sm disabled:opacity-40"
              aria-label="Clear chat"
              title="Clear chat"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <Link
              href="/"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white shadow-sm"
              aria-label="Close assistant"
            >
              <X className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 pt-20 md:pt-24">
          <div className="px-1 pt-3 pb-24">
            {messages.length === 0 ? (
              <div className="pt-1">
                <div className="px-1 pb-4">
                  <h2 className="max-w-[12ch] text-[34px] leading-[0.98] tracking-tight font-medium text-white">
                    {`Hi ${greetingName}! A few ideas to start your day.`}
                  </h2>
                </div>
                <div className="space-y-2">
                  {STARTER_PROMPTS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => onQuickPrompt(item.prompt)}
                        disabled={isStreaming}
                        className="w-full rounded-[24px] border border-white/10 bg-white/5 px-4 py-3 text-left shadow-[0_1px_0_rgba(255,255,255,0.03)] disabled:opacity-50"
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn("h-11 w-11 rounded-2xl inline-flex items-center justify-center shrink-0", item.iconTone)}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-white/45">{item.eyebrow}</div>
                            <div className="mt-0.5 text-[15px] font-medium leading-tight text-white">{item.title}</div>
                          </div>
                          <div className="h-8 w-8 rounded-full bg-white text-black inline-flex items-center justify-center shrink-0">
                            <ArrowUp className="h-4 w-4" />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className={cn(messages.length ? "space-y-3 pt-2" : "mt-4")}>
              <AnimatePresence initial={false}>
                {messages.map((message) => {
                const textParts = getTextParts(message);
                const toolParts = getToolParts(message);
                const hasMultipleCards = toolParts.length > 1;
                const suppressTextForPortfolioResponse = toolParts.some((part) => {
                  if (!String(part.type ?? "").includes("check_portfolio_balance")) return false;
                  const output = getToolOutput(part);
                  return output.ok === true;
                });
                const isUser = message.role === "user";
                const fallbackText =
                  typeof (message as { content?: unknown }).content === "string"
                    ? ((message as { content?: string }).content ?? "")
                    : "";

                  return (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className={cn("flex", isUser ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "px-3 py-2 text-sm",
                          isUser
                            ? "max-w-[90%] rounded-[20px] bg-white/10 text-white"
                            : "w-full rounded-none text-white"
                        )}
                      >
                        {!suppressTextForPortfolioResponse
                          ? (textParts.length ? textParts : []).map((part, index) => (
                              <p
                                key={`${message.id}-text-${index}`}
                                className={cn(
                                  "whitespace-pre-wrap",
                                  isUser ? "text-[16px]" : "text-[15px] leading-[1.35] text-white/90"
                                )}
                              >
                                {renderInlineMarkdown(part.text)}
                              </p>
                            ))
                          : null}

                        {!suppressTextForPortfolioResponse && !textParts.length && fallbackText ? (
                          <p className="whitespace-pre-wrap">{renderInlineMarkdown(fallbackText)}</p>
                        ) : null}

                        {toolParts.length ? (
                          hasMultipleCards ? (
                            <div className="mt-2 flex gap-3 overflow-x-auto snap-x snap-mandatory pr-6 scrollbar-hide">
                              {toolParts.map((part, index) => (
                                <div
                                  key={`${message.id}-tool-wrap-${index}`}
                                  className="min-w-[88%] max-w-[88%] snap-start md:min-w-[82%] md:max-w-[82%]"
                                >
                                  {renderToolCard(part, `${message.id}-tool-${index}`)}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-2">
                              {renderToolCard(toolParts[0], `${message.id}-tool-0`)}
                            </div>
                          )
                        ) : null}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {shouldShowGlobalLoading ? (
              <div className="flex justify-start">
                <div className="rounded-[18px] px-3 py-2 text-sm bg-white/5 text-white inline-flex items-center shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-white/70" />
                </div>
              </div>
            ) : null}
          </div>

          {error ? <div className="px-1 pb-2 text-xs text-red-300">{error.message || "Assistant request failed"}</div> : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-3 bg-gradient-to-t from-background via-background/95 to-transparent">
        <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl">
          <div className="relative rounded-[28px] bg-black/30 px-4 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.28)] backdrop-blur-sm">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                if (isStreaming || !input.trim()) return;
                const next = input;
                setInput("");
                void submitMessage(next, false);
              }}
              placeholder="I want to..."
              rows={1}
              className="h-11 w-full resize-none bg-transparent pr-16 pt-[9px] text-[17px] leading-6 text-white outline-none placeholder:text-white/35"
            />
            <button
              type="submit"
              disabled={isStreaming || !input.trim()}
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2 h-11 w-11 shrink-0 rounded-full inline-flex items-center justify-center",
                "bg-white text-black transition disabled:bg-white/20 disabled:text-white/70"
              )}
            >
              {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-5 w-5" />}
            </button>
          </div>
        </form>
      </div>

      <ResponsiveDialog
        open={Boolean(confirmationPreview) && confirmSheetOpen}
        onOpenChange={(next) => setConfirmSheetOpen(next)}
        repositionInputs
      >
        <ResponsiveDialogContent className="border-white/10 bg-background p-0 overflow-hidden text-white">
          <ResponsiveDialogHeader className="px-5 pt-4 pb-2 text-left">
            <ResponsiveDialogTitle className="text-white">Confirm Action</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-white/50">
              Review before executing a payment or split action.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="px-5 pb-5">
            <div className="mt-2 flex items-start gap-3">
              <div className="h-14 w-14 rounded-full bg-[#17e52a] text-white inline-flex items-center justify-center">
                <Check className="h-7 w-7" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-white/45">Ready to confirm</div>
                <div className="mt-1 text-[28px] leading-[0.95] tracking-tight font-semibold text-white">
                  {confirmationPreview
                    ? String(getToolOutput(confirmationPreview).action ?? "Action").replace(/_/g, " ")
                    : "Action"}
                </div>
                <div className="mt-1 text-[15px] leading-tight text-white/55">
                  {confirmationPreview ? getPreviewSummary(confirmationPreview) : ""}
                </div>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setConfirmSheetOpen(false)}
                className="h-12 rounded-full bg-white/10 text-white font-medium inline-flex items-center justify-center gap-2"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmAction}
                disabled={isStreaming}
                className="h-12 rounded-full bg-white text-black font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <PiggyBank className="h-4 w-4" />}
                Confirm
              </button>
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={Boolean(actionSuccessDialog)}
        onOpenChange={(next) => {
          if (!next) setActionSuccessDialog(null);
        }}
        repositionInputs
      >
        <ResponsiveDialogContent className="border-white/10 bg-background p-0 overflow-hidden text-white">
          <ResponsiveDialogHeader className="px-5 pt-4 pb-2 text-left">
            <ResponsiveDialogTitle className="text-white">Done</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-white/50">
              Action confirmed and completed.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="px-5 pb-5">
            <div className="mt-2 flex items-start gap-3">
              <div className="h-14 w-14 rounded-full bg-[#17e52a] text-white inline-flex items-center justify-center">
                <Check className="h-7 w-7" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[38px] leading-[0.95] tracking-tight font-semibold text-white">
                  {actionSuccessDialog?.title ?? "Completed"}
                </div>
                <div className="mt-1 text-[16px] leading-tight text-white/65">
                  {actionSuccessDialog?.subtitle ?? ""}
                </div>
                {actionSuccessDialog?.detail ? (
                  <div className="mt-2 text-xs text-white/45 break-all">
                    {actionSuccessDialog.detail}
                  </div>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActionSuccessDialog(null)}
              className="mt-8 h-12 w-full rounded-full bg-white/10 text-white font-medium"
            >
              Done
            </button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </main>
  );
}
