// xmtp/index.ts
import "dotenv/config";
import { Agent } from "@xmtp/agent-sdk";

async function main() {
  console.log("⚡ Starting XMTP agent…");

  /* ----------------------------
     VALIDATE ENV
  ----------------------------- */
  if (!process.env.TAB_API_URL) {
    console.error("❌ TAB_API_URL missing – set it in .env.local");
    process.exit(1);
  }

  const rawEnv = process.env.XMTP_ENV;
  const ENV: "production" | "dev" | "local" =
    rawEnv === "production" || rawEnv === "dev" || rawEnv === "local"
      ? rawEnv
      : "production";

  const agent = await Agent.createFromEnv({ env: ENV });

  agent.on("start", () => {
    console.log("🟢 Agent started and listening for text messages…");
  });

  /* ----------------------------
     /split COMMAND HANDLER
  ----------------------------- */
  async function handleSplit(ctx: any) {
    const raw = ctx.message?.content;
    const text = typeof raw === "string" ? raw.trim() : "";

    const parts = text.split(" ");

    if (parts.length < 2 || isNaN(Number(parts[1]))) {
      await ctx.sendText("Usage: `/split <amount> <optional description>`");
      return;
    }

    const amount = Number(parts[1]);
    const description = parts.slice(2).join(" ") || "Group split";

    // Get all members in the XMTP chat
    const members = await ctx.conversation.getMembers();
    const participantAddresses = members
      .map((m: any) => m.identity?.identifier?.toLowerCase())
      .filter(Boolean);

    const creator = ctx.message.sender.identity?.identifier;

    /* CALL TAB BACKEND */
    const res = await fetch(`${process.env.TAB_API_URL}/api/xmtp/create-split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creator,
        participants: participantAddresses,
        amount,
        description,
      }),
    });

    if (!res.ok) {
      console.error("❌ Tab API error:", await res.text());
      await ctx.sendText("❌ Failed to create split. Try again.");
      return;
    }

    const data = await res.json();
    const url = `https://usetab.app/split/${data.splitId}`;

    await ctx.sendText(`🎉 Split created!\n${url}`);
  }

  /* ----------------------------
     TEXT LISTENER
  ----------------------------- */
  agent.on("text", async (ctx) => {
    try {
      const raw = ctx.message?.content;
      const content = typeof raw === "string" ? raw.trim().toLowerCase() : "";

      if (content.startsWith("/split")) {
        return await handleSplit(ctx);
      }

      await ctx.sendText("Try `/split 20 dinner`");
    } catch (err) {
      console.error("Error handling incoming message:", err);
    }
  });

  await agent.start();
}

main();
