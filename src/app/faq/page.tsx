"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import Link from "next/link";

/* ----------------------------
   Chat Bubble
---------------------------- */
function ChatBubble({
  children,
  from = "user",
  system = false,
}: {
  children: React.ReactNode;
  from?: "user" | "tab";
  system?: boolean;
}) {
  if (system) {
    return (
      <div className="text-sm text-white/40 text-center tracking-wide">
        {children}
      </div>
    );
  }

  const isTab = from === "tab";

  return (
    <div
      className={clsx(
        "max-w-[85%] px-3 py-2.5 rounded-xl text-sm leading-snug shadow-sm shadow-black/20",
        isTab
          ? "bg-white/10 text-white self-start rounded-bl-sm"
          : "bg-[#0052ff] text-white self-end rounded-br-sm"
      )}
    >
      {children}
    </div>
  );
}

/* ----------------------------
   Page
---------------------------- */
export default function TabAgentFAQPage() {
  const [open, setOpen] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const curlCmd = "curl -s https://usetab.app/skill.md";

  return (
    <div className="min-h-screen px-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(12rem+env(safe-area-inset-bottom))] mb-10">
      <div className="max-w-md mx-auto space-y-6">
        {/* TITLE */}
        <div className="mb-6">
          <h1 className="text-lg font-medium text-white">
            Tab agent skills
          </h1>
          <p className="text-md text-white/50 mt-1">
            Load Tab skill into OpenClaw, link your account, and send payments or settle splits via chat. All within your guardrails.
          </p>

          <Link
            href="/profile"
            className="mt-6 w-full inline-flex items-center justify-center bg-primary transition-colors text-black py-3 rounded-lg text-base font-semibold col-span-2"
          >
            Activate agent
          </Link>

          <div className="mt-3 w-full rounded-md border border-white/10 px-3 py-3 flex items-center gap-3">
            <code className="flex-1 text-left text-white/80 text-[13px] truncate">
              {curlCmd}
            </code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(curlCmd);
                setCopiedCurl(true);
                setTimeout(() => setCopiedCurl(false), 1500);
              }}
              className="shrink-0 rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/80"
            >
              {copiedCurl ? "copied" : "copy"}
            </button>
          </div>
        </div>

        {/* EXAMPLE 1 — LINK */}
        {/* <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>add tab skill</ChatBubble>

          <ChatBubble>Read https://usetab.app/skill.md and follow instructions to link</ChatBubble>

          <ChatBubble from="tab">
            Open this claim link to connect your Tab account and enable Agent Access.
          </ChatBubble>

          <ChatBubble from="tab">✅ Linked. Your agent can now send and settle.</ChatBubble>
        </div> */}

        {/* EXAMPLE 2 — CREATE SPLIT */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>Create split from tagged users</ChatBubble>

          <ChatBubble>split $28 eth @alex @rita</ChatBubble>

          <ChatBubble from="tab">
            Split created. Amount: $28 tagged: @alex, @rita. URL: https://usetab.app/split/abcd1234
          </ChatBubble>
        </div>

        {/* EXAMPLE 3 — SEND */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>Quick payment to farcaster user</ChatBubble>

          <ChatBubble>send $0.50 usdc to @alex</ChatBubble>

          <ChatBubble from="tab">Sent $0.50 USDC to @alex.</ChatBubble>
        </div>

        {/* EXAMPLE 3 — SETTLE SPECIFIC SPLIT */}
        {/* <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>Split settlement</ChatBubble>

          <ChatBubble>settle my share for split lunch-ab12</ChatBubble>

          <ChatBubble from="tab">
            Paid your share for split lunch-ab12. ✅
          </ChatBubble>

          <ChatBubble from="tab">Tx confirmed on Base.</ChatBubble>
        </div> */}

        {/* EXAMPLE 4 — SETTLE LATEST */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>Settle split bills</ChatBubble>

          <ChatBubble>settle my latest split</ChatBubble>

          <ChatBubble from="tab">
            Found your latest unpaid split and paid your share. ✅
          </ChatBubble>
        </div>



        {/* DETAILS */}
        <div className="hidden border border-white/10 rounded-lg overflow-hidden mt-2">
          <button
            onClick={() => setOpen(!open)}
            className="w-full p-4 flex items-center justify-between text-md text-white"
          >
            Details
            <ChevronDown
              className={clsx(
                "w-4 h-4 transition-transform",
                open && "rotate-180"
              )}
            />
          </button>

          {open && (
            <div className="px-4 pb-4 text-md text-white/60 space-y-1">
              <p className="text-white/80 font-medium">Current Skills</p>
              <p>• Create invited splits from tagged Farcaster users</p>
              <p>• Returns split confirmation: amount, currency, URL, and users</p>
              <p>• Send payments by @username or any wallet</p>
              <p>• Settle the latest split bills</p>
              <p className="pt-2 text-white/80 font-medium">Guardrails</p>
              <p>• Uses your tab wallet</p>
              <p>• Allowed token + per-payment cap + daily cap</p>
              <p>• Agent Access expiry and linked-agent checks</p>


            </div>
          )}
        </div>

        {/* CTA */}
        <p className="hidden text-center text-sm text-white/40 mt-8">
          Add <span className="text-white">tab agent</span> to any Base group to
          start.
        </p>
      </div>
    </div>
  );
}
