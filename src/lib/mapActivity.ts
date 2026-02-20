export function mapActivity(a: any) {
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
      return {
        type: "bill_paid",
        splitId: a.refId,
        amount: a.amount,
        token: a.token,
        counterparty: a.counterparty?.name ?? null,
        pfp: a.counterparty?.pfp ?? null, // ✅ recipient avatar
        description: `Sent ${a.amount} ${a.token}`,
        timestamp: a.timestamp,
      };

    case "bill_received":
      return {
        type: "bill_received",
        splitId: a.refId,
        amount: a.amount,
        token: a.token,
        counterparty: a.counterparty?.name ?? null,
        pfp: a.counterparty?.pfp ?? null, // ✅ payer avatar
        description: `Received ${a.amount} ${a.token}`,
        timestamp: a.timestamp,
      };

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
