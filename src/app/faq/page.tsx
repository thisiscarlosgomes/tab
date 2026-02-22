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
            Split, pay, pick, and airdrop — inside group chats
          </h1>

          <p className="text-md text-white/50 mt-1">
            Add <span className="text-primary font-medium">tab agent</span> to a
            Base group. Use simple messages like split bills, pay, pick someone,
            or airdrop.
          </p>

          <button
            onClick={handleOpenChat}
            className="mt-6 w-full bg-white/20 transition-colors text-black py-3 rounded-lg text-base font-semibold col-span-2"
          >
            {openingChat ? "Opening..." : "Chat - Soon"}
          </button>
        </div>

        {/* EXAMPLE 1 — SIMPLE SPLIT */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>tab agent was added to the group</ChatBubble>

          <ChatBubble>
            Split tonight's dinner with everyone for $84.4
          </ChatBubble>

          <ChatBubble from="tab">
            Split created. 4 people owe $21.1 each.
          </ChatBubble>

          {/* <ChatBubble from="tab"><span className="text-white font-medium">@carlos</span> pay</ChatBubble> */}

          <ChatBubble from="tab">✅ Carlos paid. Waiting on 2.</ChatBubble>
        </div>

        {/* EXAMPLE 2 — SELECTED USERS */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>Same group, different split</ChatBubble>

          <ChatBubble>split 0.2 eth @alex @rita</ChatBubble>

          <ChatBubble from="tab">Split created for @alex and @rita.</ChatBubble>
        </div>

        {/* EXAMPLE 3 — ROULETTE */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>Late night drinks</ChatBubble>

          <ChatBubble>
            pick someone to pay 10 eurc for this morning coffee
          </ChatBubble>

          <ChatBubble from="tab">
            🎰 Picked: @alex you were picked to cover the tab
          </ChatBubble>

          <ChatBubble from="tab">✅ @alex marked as paid</ChatBubble>
        </div>

        {/* EXAMPLE 4 — AIRDROP */}
        <div className="border border-white/10 rounded-lg p-6 flex flex-col gap-2">
          <ChatBubble system>Celebrating a win</ChatBubble>

          <ChatBubble>airdrop $10 to everyone, random amount.</ChatBubble>

          <ChatBubble from="tab">Review and confirm to send.</ChatBubble>

          <ChatBubble from="tab">✅ Sent, @carlos $2, @maria $8</ChatBubble>
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
              <p className="text-white/80 font-medium">Payments</p>
              <p>• USDC by default</p>
              <p>• ETH + other local coins supported</p>

              <p className="pt-2 text-white/80 font-medium">Airdrops</p>
              <p>• Send to everyone in the group</p>
              <p>• Equal or random distribution</p>
              <p>• No setup, one message</p>

              <p className="pt-2 text-white/80 font-medium">Automation</p>
              <p>• Mini app support</p>
              <p>• Auto-reminders</p>
              <p>• Auto-settles when complete</p>
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
