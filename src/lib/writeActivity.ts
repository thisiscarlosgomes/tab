import clientPromise from "@/lib/mongodb";

export interface ActivityInput {
  address: string;
  type:
    | "bill_created"
    | "bill_invited"
    | "bill_joined"
    | "bill_paid"
    | "bill_received"
    | "room_created"
    | "room_invited"
    | "room_joined"
    | "room_paid"
    | "room_received"
    | "drop_created"
    | "drop_claimed"
    | "jackpot_deposit"
    | "earn_deposit";

  refType: "bill" | "room" | "drop" | "jackpot" | "earn" | "transfer";
  refId: string;

  amount?: number;
  token?: string;
  txHash?: string;
  executionMode?: "user_session" | "service_agent";
  agentId?: string | null;
  recipientResolutionSource?: "address" | "ens" | "tab" | "farcaster" | null;
  note?: string | null;

  counterparty?: {
    address: string;
    name?: string;
    username?: string;
    pfp?: string;
  };

  timestamp: Date;
}

export async function writeActivity(input: ActivityInput) {
  if (!input.refId) {
    console.warn("[writeActivity] missing refId, skipping", input);
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db();

    await db.collection("a-activity").insertOne({
      ...input,
      address: input.address.toLowerCase(),
      createdAt: new Date(),
    });
  } catch (err) {
    // never block core flows
    console.error("[writeActivity] failed", err);
  }
}
