import { neynarApi } from "@/lib/neynar";
import { FollowSortType } from "@neynar/nodejs-sdk/build/api";
import type { NextRequest } from "next/server";

export const GET = async (req: NextRequest) => {
  const username = req.nextUrl.searchParams.get("username");
  if (!username)
    return Response.json({ error: "Missing username" }, { status: 400 });

  try {
    // First, resolve username to FID
    const { user } = await neynarApi.lookupUserByUsername({ username });

    // Then, get their following list
    const { users } = await neynarApi.fetchUserFollowers({
      fid: user.fid,
      sortType: FollowSortType.Algorithmic,
    });

    return Response.json(users);
  } catch {
    return Response.json(
      { error: "Failed to fetch following" },
      { status: 500 }
    );
  }
};
