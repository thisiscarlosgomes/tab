import { neynarApi } from "@/lib/neynar";
import type { NextRequest } from "next/server";
import { fetchFarcasterUsersByAddresses } from "@/lib/proxy";

const NEYNAR_RECIPROCAL_FOLLOWERS_URL =
  "https://api.neynar.com/v2/farcaster/followers/reciprocal/";

async function resolveFarcasterFid(input: {
  fidParam: string | null;
  username: string | null;
  address: string | null;
}) {
  const fidFromParam = input.fidParam ? Number(input.fidParam) : null;

  if (Number.isFinite(fidFromParam) && fidFromParam! > 0) {
    return fidFromParam!;
  }

  if (input.username) {
    try {
      const { user } = await neynarApi.lookupUserByUsername({
        username: input.username,
      });
      return user?.fid ?? null;
    } catch {
      return null;
    }
  }

  if (input.address) {
    const farcasterUser = await fetchFarcasterUsersByAddresses(input.address);
    return farcasterUser?.[input.address]?.fid ?? null;
  }

  return null;
}

function normalizeReciprocalFollowers(payload: unknown) {
  const users = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === "object" &&
        Array.isArray((payload as { users?: unknown[] }).users)
      ? (payload as { users: unknown[] }).users
      : [];

  type UserEntry = { user?: unknown };

  return users
    .map((entry: unknown) => {
      const maybeEntry = entry as UserEntry;
      return maybeEntry?.user ? maybeEntry : { user: entry };
    })
    .filter((entry: UserEntry) => Boolean(entry?.user));
}

export const GET = async (req: NextRequest) => {
  const fidParam = req.nextUrl.searchParams.get("fid");
  const username = req.nextUrl.searchParams.get("username");
  const address = req.nextUrl.searchParams.get("address")?.toLowerCase() ?? null;
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(100, Math.floor(limitParam)))
    : 50;

  if (!username && !address && !fidParam) {
    return Response.json([]);
  }

  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) {
    return Response.json([]);
  }

  try {
    const fid = await resolveFarcasterFid({ fidParam, username, address });
    if (!fid) {
      return Response.json([]);
    }

    const url = new URL(NEYNAR_RECIPROCAL_FOLLOWERS_URL);
    url.searchParams.set("fid", String(fid));
    url.searchParams.set("limit", String(limit));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
          "x-neynar-experimental": "true",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      if (!res.ok) {
        return Response.json([]);
      }

      const data = await res.json().catch(() => null);
      return Response.json(normalizeReciprocalFollowers(data));
    } catch {
      return Response.json([]);
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return Response.json([]);
  }
};
