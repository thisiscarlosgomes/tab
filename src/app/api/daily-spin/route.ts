import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

// const REWARDS = [
//   { reward: "100 $TAB", type: "erc20", amount: 500 },
//   { reward: "Tab Points +10", type: "points", amount: 10 },
//   { reward: "The wheel said nah.", type: "Nothing today", amount: 0 },
// ];

// const REWARDS = [
//   { reward: "1000 $tab", type: "erc20", amount: 1000 },
//   { reward: "Tab Points +10", type: "points", amount: 10 },
//   { reward: "Nothing today", type: "none", amount: 0 },
// ];

const REWARDS = [
  { reward: "1000 $tab", type: "erc20", amount: 1000 },
  { reward: "Tab Points +10", type: "points", amount: 10 },
  { reward: "Nothing today", type: "none", amount: 0 },
  { reward: "Today's pool is empty", type: "pool_depleted", amount: 0 }, // new
];

const TOKEN_DECIMALS = 18;
const TOKEN_ADDRESS = "0x154af0cc4df0c1744edc0b4b916f6aa028d009b0";
const DAILY_TOKEN_LIMIT = 100_000; // total token units (before decimals)

function pickReward(canGiveToken: boolean) {
  const r = Math.random();

  if (canGiveToken && r < 0.05) return REWARDS[0]; // 5% → 1000 $tab
  if (r < 0.25) return REWARDS[1]; // 20% → Tab Points +10
  return REWARDS[2]; // 75% → Nothing today
}
const collectionName = "a-daily-spins";
const rewardLogCollection = "a-daily-rewards";

const tokenTrackerCollection = "a-daily-token-tracker";

type SpinEntry = {
  timestamp: string;
  reward: string;
};

type UserSpinDoc = {
  fid: number;
  spins: Record<string, SpinEntry[]>;
  lastSpinAt?: string;
  totalSpins?: number;
  streak?: number;
  address?: string; // ✅ NEW
};

type TokenTrackerDoc = {
  date: string;
  total: number;
  txs?: {
    hash: string;
    to: string;
    amount: number;
    reason: string;
    timestamp: string;
    send?: boolean; // ✅ optional flag
  }[];
};

export async function POST(req: NextRequest) {
  let fid;
  let address: string | null = null;

  // try {
  //   const body = await req.json();
  //   fid = body.fid ?? 2201;
  //   address = body.address?.toLowerCase() ?? null; // ✅ Now scoped properly
  // } catch {
  //   fid = 2201;
  // }

  try {
    const body = await req.json();
    fid = body.fid;
    address = body.address?.toLowerCase() ?? null;

    if (typeof fid !== "number") {
      return new Response(JSON.stringify({ error: "Missing or invalid fid" }), {
        status: 400,
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
    });
  }

  if (!fid) {
    return new Response(JSON.stringify({ error: "Missing fid" }), {
      status: 400,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const client = await clientPromise;
  const db = client.db();
  const spins = db.collection<UserSpinDoc>(collectionName);

  const user = await spins.findOne({ fid });
  const spinsToday = user?.spins?.[today] ?? [];

  const isTestFID = fid === 2201;
  if (!isTestFID) {
    if (spinsToday.length >= 3) {
      return new Response(
        JSON.stringify({ alreadySpun: true, limitReached: true }),
        { status: 403 }
      );
    }

    const lastWin = spinsToday.findLast((s) => s.reward !== "Nothing today");
    if (lastWin) {
      const last = new Date(lastWin.timestamp);
      if (now.getTime() - last.getTime() < 8 * 60 * 60 * 1000) {
        return new Response(
          JSON.stringify({ alreadySpun: true, limitReached: true }),
          { status: 403 }
        );
      }
    }
  }

  const tokenTracker = db.collection<TokenTrackerDoc>(tokenTrackerCollection);
  const tracker = await tokenTracker.findOne({ date: today });
  const totalTokensGiven = tracker?.total ?? 0;

  // const initialReward = pickReward(true);

  // const canGiveToken =
  //   initialReward.type !== "erc20" ||
  //   totalTokensGiven + initialReward.amount <= DAILY_TOKEN_LIMIT;

  // const finalReward = canGiveToken ? initialReward : REWARDS[2];

  const initialReward = pickReward(true);

  const canGiveToken =
    initialReward.type !== "erc20" ||
    totalTokensGiven + initialReward.amount <= DAILY_TOKEN_LIMIT;

  const finalReward = canGiveToken ? initialReward : REWARDS[3]; // <— use new one

  let streak = user?.streak ?? 0;
  if (user?.lastSpinAt) {
    const last = new Date(user.lastSpinAt);
    const daysDiff = Math.floor(
      (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysDiff === 1) streak += 1;
    else if (daysDiff > 1) streak = 1;
  } else {
    streak = 1;
  }

  const spinEntry: SpinEntry = {
    timestamp: now.toISOString(),
    reward: finalReward.reward,
  };

  await spins.updateOne(
    { fid },
    {
      $set: {
        [`spins.${today}`]: [...spinsToday, spinEntry],
        lastSpinAt: now.toISOString(),
        streak,
        ...(address && { address }), // ✅ store address if present
      },
      $inc: { totalSpins: 1 },
    },
    { upsert: true }
  );

  if (finalReward.type === "erc20") {
    // Log reward
    await db.collection(rewardLogCollection).insertOne({
      fid,
      type: "erc20",
      amount: finalReward.amount,
      timestamp: now.toISOString(),
    });

    const recipientAddress = user?.address ?? address;

    if (recipientAddress) {
      try {
        const sendRes = await fetch(`${process.env.PUBLIC_URL}/api/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: recipientAddress,
            amount: finalReward.amount,
            reason: `daily_spin_${today}`,
            type: "erc20",
            tokenAddress: TOKEN_ADDRESS,
            decimals: TOKEN_DECIMALS,
          }),
        });

        const sendJson = await sendRes.json();
        const txHash = sendJson?.hash;

        const trackerUpdate: {
          $inc: { total: number };
          $push?: {
            txs: {
              hash: string;
              to: string;
              amount: number;
              reason: string;
              timestamp: string;
              send: boolean;
            };
          };
        } = {
          $inc: { total: finalReward.amount },
        };

        if (txHash) {
          trackerUpdate.$push = {
            txs: {
              hash: txHash,
              to: recipientAddress,
              amount: finalReward.amount,
              reason: `daily_spin_${today}`,
              timestamp: now.toISOString(),
              send: true, // ✅ new field
            },
          };
        }

        await tokenTracker.updateOne({ date: today }, trackerUpdate, {
          upsert: true,
        });
      } catch (e) {
        console.error("Auto-send failed", e);
      }
    }
  }

  return new Response(
    JSON.stringify({ alreadySpun: false, reward: finalReward })
  );
}

export async function GET(req: NextRequest) {
  const fid = parseInt(req.nextUrl.searchParams.get("fid") || "", 10);
  if (!fid) {
    return new Response(JSON.stringify({ error: "Missing fid" }), {
      status: 400,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const client = await clientPromise;
  const db = client.db();
  const spins = db.collection<UserSpinDoc>(collectionName);

  const user = await spins.findOne({ fid });
  const spinsToday = user?.spins?.[today] ?? [];
  const latestResult = spinsToday.length
    ? spinsToday[spinsToday.length - 1]
    : null;

  let canSpin = true;
  let nextEligibleSpinAt: Date | null = null;

  const isTestFID = fid === 2201;

  if (!isTestFID) {
    if (spinsToday.length >= 3) {
      canSpin = false;
      const last = new Date(spinsToday[spinsToday.length - 1].timestamp);
      nextEligibleSpinAt = new Date(last.getTime() + 8 * 60 * 60 * 1000);
    } else {
      const lastWin = spinsToday.findLast((s) => s.reward !== "Nothing today");
      if (lastWin) {
        const last = new Date(lastWin.timestamp);
        const diff = now.getTime() - last.getTime();
        if (diff < 8 * 60 * 60 * 1000) {
          canSpin = false;
          nextEligibleSpinAt = new Date(last.getTime() + 8 * 60 * 60 * 1000);
        }
      }
    }
  }

  return new Response(
    JSON.stringify({
      canSpin,
      nextEligibleSpinAt: nextEligibleSpinAt?.toISOString() ?? null,
      latestResult,
      totalSpins: user?.totalSpins ?? 0,
      streak: user?.streak ?? 0,
      spinsToday: spinsToday.length,
    })
  );
}
