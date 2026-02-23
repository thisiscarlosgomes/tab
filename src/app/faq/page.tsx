"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import { isFrameRuntime } from "@/lib/isFrame";

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
  const [openingChat, setOpeningChat] = useState(false);

  const handleOpenChat = async () => {
    const targetUrl =
      "bwallet://messaging/0x6b13e4babaffc0337f68ac4635cb2cb43f8a46cd";
    if (!isFrameRuntime()) {
      window.open(targetUrl, "_self");
      return;
    }

    try {
      setOpeningChat(true);
      const { default: sdk } = await import("@farcaster/frame-sdk");
      await sdk.actions.openUrl(targetUrl);
    } finally {
      setOpeningChat(false);
    }
  };

  return (
    <div className="min-h-screen px-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(12rem+env(safe-area-inset-bottom))] mb-16">
      <div className="max-w-md mx-auto space-y-6">
        {/* TITLE */}
        <div className="mb-6 ml-1">
          <h1 className="text-lg font-medium text-white">
            Send and settle splits with tab agent in chat
          </h1>

          <p className="text-md text-white/50 mt-1">
            Add <span className="text-primary font-medium">tab agent</span> to a
            Base group, then link your account and use simple messages to send
            payments or settle split shares.
          </p>

          <button
            onClick={handleOpenChat}
            className="mt-6 w-full bg-white/20 transition-colors text-black py-3 rounded-lg text-base font-semibold col-span-2"
          >
            {openingChat ? "Opening..." : "Open Base Chat"}
          </button>
        </div>

        {/* EXAMPLE 1 — LINK */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>tab agent was added to the group</ChatBubble>

          <ChatBubble>link tab agent to my account</ChatBubble>

          <ChatBubble from="tab">
            Open this claim link to connect your Tab account and enable Agent Access.
          </ChatBubble>

          <ChatBubble from="tab">✅ Linked. Your agent can now send and settle.</ChatBubble>
        </div>

        {/* EXAMPLE 2 — SEND */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>Quick payment</ChatBubble>

          <ChatBubble>send $0.50 usdc to @alex</ChatBubble>

          <ChatBubble from="tab">Sent $0.50 USDC to @alex. ✅</ChatBubble>
        </div>

        {/* EXAMPLE 3 — SETTLE SPECIFIC SPLIT */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>Split settlement</ChatBubble>

          <ChatBubble>settle my share for split lunch-ab12</ChatBubble>

          <ChatBubble from="tab">
            Paid your share for split lunch-ab12. ✅
          </ChatBubble>

          <ChatBubble from="tab">Tx confirmed on Base.</ChatBubble>
        </div>

        {/* EXAMPLE 4 — SETTLE LATEST */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>Latest pending split</ChatBubble>

          <ChatBubble>settle my latest split</ChatBubble>

          <ChatBubble from="tab">
            Found your latest unpaid split and paid your share. ✅
          </ChatBubble>

          <ChatBubble from="tab">Use split id/code/url if you want a specific one.</ChatBubble>
        </div>

        {/* DETAILS */}
        <div className="border border-white/10 rounded-lg overflow-hidden mt-2">
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
            <div className="px-4 pb-4 text-md text-white/60 space-y-2">
              <p className="text-white/80 font-medium">Current Skills</p>
              <p>• Link agent to a Tab account (claim link flow)</p>
              <p>• Send payments by @username, ENS, or wallet address</p>
              <p>• Settle a split by splitId, code, or URL</p>
              <p>• Settle the latest pending eligible split</p>

              <p className="pt-2 text-white/80 font-medium">Guardrails</p>
              <p>• Uses delegated Privy wallet (Base)</p>
              <p>• Allowed token + per-payment cap + daily cap</p>
              <p>• Agent Access expiry and linked-agent checks</p>

              <p className="pt-2 text-white/80 font-medium">Not Yet</p>
              <p>• Pick/roulette flows</p>
              <p>• Airdrops in chat</p>
              <p>• Farcaster follow / unfollow actions</p>
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
