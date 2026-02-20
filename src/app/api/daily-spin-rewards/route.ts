// app/api/daily-spin-rewards/route.ts

import { NextRequest } from "next/server";

const REWARDS = [
  { label: "Tab 50", type: "erc20", amount: 50 },
  { label: "Tab 200", type: "erc20", amount: 200 },
  { label: "Tab 300", type: "erc20", amount: 300 },
  { label: "Nothing", type: "none", amount: 0 },
  { label: "spin", type: "spin", amount: 0 },
  { label: "Tab 500", type: "erc20", amount: 500 },
  { label: "Tab 1000", type: "erc20", amount: 1000 },
  { label: "Tab 10000", type: "erc20", amount: 10000 },
  { label: "Nothing", type: "none", amount: 0 },
];

export async function GET(_req: NextRequest) {
  return new Response(JSON.stringify(REWARDS), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
