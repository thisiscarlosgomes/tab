import { tokenList } from "@/lib/tokens";

export type AgentSkill = {
  name: string;
  description: string;
  endpoint: string;
  method: "POST";
  headers: string[];
  inputSchema: {
    type: "object";
    required: string[];
    properties: Record<string, unknown>;
  };
  examples: string[];
};

const tokenSymbols = Array.from(
  new Set(tokenList.map((token) => String(token.name ?? "").toUpperCase()))
).filter(Boolean);

export const AGENT_SKILLS: AgentSkill[] = [
  {
    name: "tab_create_split",
    description:
      "Create an invited Tab split with tagged users and return a split confirmation URL. Mentions default to the user's linked Twitter or Farcaster graph.",
    endpoint: "https://usetab.app/api/agent/split/create",
    method: "POST",
    headers: ["x-agent-key", "Content-Type: application/json"],
    inputSchema: {
      type: "object",
      required: ["agentId", "userId", "amount", "users"],
      properties: {
        agentId: {
          type: "string",
          description:
            "Your registered agent id. Must be linked by the user via claim flow.",
        },
        userId: {
          type: "string",
          description:
            "Privy user id that owns the delegated wallet and Agent Access policy.",
        },
        amount: {
          type: "string",
          description: "Total split amount, e.g. '0.2' or '$84.40'.",
        },
        token: {
          type: "string",
          enum: tokenSymbols,
          description: "Optional token symbol. Defaults to USDC.",
        },
        users: {
          type: "array",
          description: "Tagged usernames to split with.",
          items: {
            type: "string",
          },
        },
        recipientProvider: {
          type: "string",
          enum: ["twitter", "farcaster"],
          description:
            "Optional override for @username resolution. If omitted, Tab uses the user's linked social graph.",
        },
        description: {
          type: "string",
          description: "Optional split description shown on the split.",
        },
      },
    },
    examples: [
      "split 0.2 eth @alex @rita",
      "Create a $84.40 USDC split with @alex @rita @maya",
    ],
  },
  {
    name: "tab",
    description:
      "Send a payment from the user's delegated Privy wallet under Agent Access guardrails.",
    endpoint: "https://usetab.app/api/agent/send",
    method: "POST",
    headers: ["x-agent-key", "Content-Type: application/json"],
    inputSchema: {
      type: "object",
      required: ["agentId", "userId", "recipient", "amount"],
      properties: {
        agentId: {
          type: "string",
          description:
            "Your registered agent id. Must be linked by the user via claim flow.",
        },
        userId: {
          type: "string",
          description:
            "Privy user id that owns the delegated wallet and Agent Access policy.",
        },
        recipient: {
          type: "string",
          description:
            "Recipient identifier. Supports @username, 0x wallet address, or ENS (.eth). @username defaults to the user's linked social graph.",
        },
        amount: {
          type: "string",
          description: "Token amount, e.g. '0.50' or '$0.50'.",
        },
        token: {
          type: "string",
          enum: tokenSymbols,
          description:
            "Optional token symbol. Must match the user's allowedToken policy.",
        },
        note: {
          type: "string",
          description: "Optional reason/metadata for logging.",
        },
        requestId: {
          type: "string",
          description:
            "Optional idempotency key from agent orchestration layer.",
        },
        recipientEns: {
          type: "string",
          description:
            "Optional ENS name override (for example vitalik.eth).",
        },
        recipientProvider: {
          type: "string",
          enum: ["twitter", "farcaster"],
          description:
            "Optional override for @username resolution. If omitted, Tab uses the user's linked social graph.",
        },
      },
    },
    examples: [
      "Send $0.50 USDC to @alice",
      "Pay 0.5 USDC to 0xabc...123 from my tab wallet",
      "Send 0.5 USDC to vitalik.eth",
    ],
  },
  {
    name: "tab_link_account",
    description:
      "Create a one-time claim link so a human can link your agent to their Tab account.",
    endpoint: "https://usetab.app/api/agent/link/start",
    method: "POST",
    headers: ["x-agent-key", "Content-Type: application/json"],
    inputSchema: {
      type: "object",
      required: ["agentId"],
      properties: {
        agentId: {
          type: "string",
          description: "Stable identifier for your agent.",
        },
        agentName: {
          type: "string",
          description: "Human-readable name shown on claim screen.",
        },
        expiresInMinutes: {
          type: "number",
          description:
            "Optional claim expiry in minutes (min 5, max 1440). Default 30.",
        },
      },
    },
    examples: [
      "Create claim link for agent YourAgentName",
      "Generate a 15 minute link so user can connect their Tab account",
    ],
  },
  {
    name: "tab_settle_split",
    description:
      "Pay the caller's share for a Tab split using their delegated Privy wallet under Agent Access guardrails (or auto-select the latest pending split).",
    endpoint: "https://usetab.app/api/agent/settle",
    method: "POST",
    headers: ["x-agent-key", "Content-Type: application/json"],
    inputSchema: {
      type: "object",
      required: ["agentId", "userId"],
      properties: {
        agentId: {
          type: "string",
          description:
            "Your registered agent id. Must be linked by the user via claim flow.",
        },
        userId: {
          type: "string",
          description:
            "Privy user id that owns the delegated wallet and Agent Access policy.",
        },
        splitId: {
          type: "string",
          description:
            "Optional split id (preferred when available). If omitted with splitCode/splitUrl, the API settles the latest pending eligible split.",
        },
        splitCode: {
          type: "string",
          description: "Optional split code (for example lunch-ab12).",
        },
        splitUrl: {
          type: "string",
          description: "Optional split URL (for example https://usetab.app/split/abc123).",
        },
      },
    },
    examples: [
      "Pay my share for splitId abcd1234",
      "Settle my share for split code lunch-ab12",
      "Pay my share from https://usetab.app/split/abcd1234",
      "Settle my latest split",
    ],
  },
];
