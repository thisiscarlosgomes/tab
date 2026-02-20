import type { NextRequest } from "next/server";
import { NeynarAPIClient, Configuration } from "@neynar/nodejs-sdk";

const client = new NeynarAPIClient(
  new Configuration({ apiKey: process.env.NEYNAR_API_KEY! })
);

export const GET = async (req: NextRequest) => {
  const fidsParam = req.nextUrl.searchParams.get("fids") ?? "";
  if (!fidsParam) return Response.json(null, { status: 400 });

  // Convert "123,456,789" → [123, 456, 789]
  const fidStrings = fidsParam.split(",").map((s) => s.trim());
  const fids = fidStrings
    .map((s) => Number(s))
    .filter((n) => !Number.isNaN(n));

  if (fids.length === 0) {
    return Response.json({ error: "Invalid fids" }, { status: 400 });
  }

  try {
    const res = await client.fetchBulkUsers({
      fids, // number[]
    });

    return Response.json(res.users ?? []);
  } catch (err) {
    return Response.json([], { status: 404 });
  }
};
