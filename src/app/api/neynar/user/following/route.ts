import { neynarApi } from "@/lib/neynar";
import { FollowSortType } from "@neynar/nodejs-sdk/build/api";
import type { NextRequest } from "next/server";
import { fetchFarcasterUsersByAddresses } from "@/lib/proxy";

export const GET = async (req: NextRequest) => {
  const fidParam = req.nextUrl.searchParams.get("fid");
  const username = req.nextUrl.searchParams.get("username");
  const address = req.nextUrl.searchParams.get("address")?.toLowerCase();
  const fidFromParam = fidParam ? Number(fidParam) : null;

  if (!username && !address && !fidFromParam) {
    return Response.json([]);
  }

  try {
    let fid: number | null = null;

    if (Number.isFinite(fidFromParam) && fidFromParam! > 0) {
      fid = fidFromParam!;
    } else if (username) {
      try {
        const { user } = await neynarApi.lookupUserByUsername({ username });
        fid = user?.fid ?? null;
      } catch {
        // Username not found or Neynar unavailable: return no following.
        return Response.json([]);
      }
    } else if (address) {
      const farcasterUser = await fetchFarcasterUsersByAddresses(address);
      fid = farcasterUser?.[address]?.fid ?? null;
    }

    if (!fid) {
      return Response.json([]);
    }

    // Then, get their following list
    try {
      const { users } = await neynarApi.fetchUserFollowing({
        fid,
        sortType: FollowSortType.Algorithmic,
      });

      if (!Array.isArray(users)) return Response.json([]);

      type FollowingEntry = {
        user?: unknown;
      };

      const normalized = users
        .map((entry: unknown) => {
          const maybeEntry = entry as FollowingEntry;
          return maybeEntry?.user ? maybeEntry : { user: entry };
        })
        .filter((entry: FollowingEntry) => Boolean(entry?.user));

      return Response.json(normalized);
    } catch {
      return Response.json([]);
    }
  } catch {
    return Response.json([]);
  }
};
