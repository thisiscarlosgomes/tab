type ActivityRecord = {
  type?: string;
  refId?: string;
  refType?: string;
  amount?: number;
  token?: string;
  timestamp?: string | Date;
  executionMode?: "user_session" | "service_agent" | null;
  agentId?: string | null;
  ticketCount?: number;
  rewarded?: boolean;
  rewardAmount?: number;
  summary?: string;
  recipient?: string;
  recipientUsername?: string;
  recipientResolutionSource?: "address" | "ens" | "tab" | "farcaster" | null;
  counterparty?: {
    address?: string | null;
    name?: string | null;
    pfp?: string | null;
  } | null;
};

export function mapActivity(a: ActivityRecord) {
  switch (a.type) {
    /* ---------------- Bills ---------------- */

    case "bill_created":
      return {
        type: "bill_created",
        splitId: a.refId,
        description: "Created split bill",
        timestamp: a.timestamp,
      };

    case "bill_joined":
      return {
        type: "bill_joined",
        splitId: a.refId,
        counterparty: a.counterparty?.name ?? null,
        pfp: a.counterparty?.pfp ?? null,
        description: `Joined split bill`,
        timestamp: a.timestamp,
      };

    case "bill_paid":
      {
        const hasAmountToken =
          typeof a.amount === "number" &&
          Number.isFinite(a.amount) &&
          Boolean(a.token);
        const description =
          typeof a.summary === "string" && a.summary.trim()
            ? a.summary.trim()
            : hasAmountToken
              ? `Sent ${a.amount} ${a.token}`
              : "Sent transfer";
      return {
        type: "bill_paid",
        splitId: a.refType === "bill" ? a.refId : undefined,
        amount: a.amount,
        token: a.token,
        recipient: a.recipient ?? a.counterparty?.address ?? undefined,
        recipientUsername: a.recipientUsername,
        recipientResolutionSource: a.recipientResolutionSource ?? null,
        counterparty: a.counterparty?.name ?? null,
        counterpartyAddress: a.counterparty?.address ?? null,
        pfp: a.counterparty?.pfp ?? null, // ✅ recipient avatar
        executionMode: a.executionMode ?? null,
        agentId: a.agentId ?? null,
        description,
        timestamp: a.timestamp,
      };
      }

    case "bill_received":
      {
        const hasAmountToken =
          typeof a.amount === "number" &&
          Number.isFinite(a.amount) &&
          Boolean(a.token);
        const description =
          typeof a.summary === "string" && a.summary.trim()
            ? a.summary.trim()
            : hasAmountToken
              ? `Received ${a.amount} ${a.token}`
              : "Received transfer";
      return {
        type: "bill_received",
        splitId: a.refType === "bill" ? a.refId : undefined,
        amount: a.amount,
        token: a.token,
        counterparty: a.counterparty?.name ?? null,
        counterpartyAddress: a.counterparty?.address ?? null,
        pfp: a.counterparty?.pfp ?? null, // ✅ payer avatar
        executionMode: a.executionMode ?? null,
        agentId: a.agentId ?? null,
        description,
        timestamp: a.timestamp,
      };
      }

    /* ---------------- Rooms ---------------- */

    case "room_created":
      return {
        type: "room_created",
        roomId: a.refId,
        description: `Created spin the tab`,
        timestamp: a.timestamp,
      };

    case "room_joined":
      return {
        type: "room_joined",
        roomId: a.refId,
        counterparty: a.counterparty?.name ?? null,
        pfp: a.counterparty?.pfp ?? null,
        description: "Joined spin the tab",
        timestamp: a.timestamp,
      };

    case "room_paid":
      return {
        type: "room_paid",
        roomId: a.refId,
        amount: a.amount,
        token: a.token,
        counterparty: a.counterparty?.name ?? null,
        pfp: a.counterparty?.pfp ?? null,
        description: `You paid ${a.amount} ${a.token}`,
        timestamp: a.timestamp,
      };

    case "room_received":
      return {
        type: "room_received",
        roomId: a.refId,
        amount: a.amount,
        token: a.token,
        counterparty: a.counterparty?.name ?? null,
        pfp: a.counterparty?.pfp ?? null,
        description: `Received ${a.amount} ${a.token}`,
        timestamp: a.timestamp,
      };

    /* ---------------- Jackpot ---------------- */

    case "jackpot_deposit":
      return {
        type: "jackpot_deposit",
        amount: a.amount,
        token: a.token ?? "USDC",
        description: `Purchased ${a.amount} jackpot ticket`,
        timestamp: a.timestamp,
      };

    /* ---------------- Earn ---------------- */

    case "earn_deposit":
      return {
        type: "earn_deposit",
        amount: a.amount,
        description: `Deposited ${a.amount} USDC into earn`,
        timestamp: a.timestamp,
      };

    default:
      return null;
  }
}
