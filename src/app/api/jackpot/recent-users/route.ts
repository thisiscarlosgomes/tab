// /app/api/jackpot/recent-users/route.ts
export const runtime = "nodejs";

import clientPromise from "@/lib/mongodb";
import { fetchFarcasterUsersByAddresses } from "@/lib/proxy";
import { NextResponse } from "next/server";

type FarcasterProfile = {
  username?: string | null;
  pfp_url?: string | null;
  pfp?: { url?: string | null } | null;
};

function resolveProfileByAddress(
  profilesByAddress: Record<string, unknown>,
  address: string
): FarcasterProfile | null {
  const normalized = address.toLowerCase();
  const direct =
    profilesByAddress[address] ??
    profilesByAddress[normalized] ??
    profilesByAddress[address.trim()];

  if (direct && typeof direct === "object") {
    const directRecord = direct as Record<string, unknown>;
    const maybeNestedUser = directRecord.user;
    if (maybeNestedUser && typeof maybeNestedUser === "object") {
      return maybeNestedUser as FarcasterProfile;
    }
    return direct as FarcasterProfile;
  }

  // Fallback for providers that return a single-entry map with non-matching key case.
  const values = Object.values(profilesByAddress);
  if (values.length === 1 && values[0] && typeof values[0] === "object") {
    const first = values[0] as Record<string, unknown>;
    if (first.user && typeof first.user === "object") {
      return first.user as FarcasterProfile;
    }
    return first as FarcasterProfile;
  }

  return null;
}

function getPfpUrl(profile: FarcasterProfile | null): string | null {
  if (!profile) return null;
  if (typeof profile.pfp_url === "string" && profile.pfp_url.length > 0) {
    return profile.pfp_url;
  }
  const nested = profile.pfp?.url;
  if (typeof nested === "string" && nested.length > 0) return nested;
  return null;
}

export async function GET() {
  const client = await clientPromise;
  const db = client.db();

  const deposits = db.collection("a-jackpot-deposit");

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 1. Get last 5 unique addresses based on most recent deposit
  const raw = await deposits
    .aggregate([
      { $match: { timestamp: { $gte: since30d } } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: "$address",
          address: { $first: "$address" },
          timestamp: { $first: "$timestamp" },
        },
      },
      { $sort: { timestamp: -1 } },
      { $limit: 5 },
    ])
    .toArray();

  const addresses = raw
    .map((u) => String(u.address || "").trim().toLowerCase())
    .filter(Boolean);
  const uniqueAddresses = [...new Set(addresses)];

  let profilesByAddress: Record<string, unknown> = {};
  if (uniqueAddresses.length > 0) {
    profilesByAddress = await fetchFarcasterUsersByAddresses(
      uniqueAddresses.join(",")
    );
  }

  const enriched = [];

  // 2. For each recent jackpot user -> fetch Farcaster profile
  for (const u of raw) {
    const profile = resolveProfileByAddress(profilesByAddress, u.address);
    const username = profile?.username ?? null;
    const pfp_url = getPfpUrl(profile);

    enriched.push({
      address: u.address,
      timestamp: u.timestamp,
      username,
      pfp_url,
    });
  }

  return NextResponse.json({ users: enriched });
}
