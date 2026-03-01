import { NextRequest } from "next/server";
import { requireTrustedRequest } from "@/lib/security";
import {
  getCanonicalUserProfileByUserId,
  getPrivyAuthedUserFromAuthorization,
  syncCanonicalUserProfileFromPrivyUser,
} from "@/lib/user-profile";

function normalizeUsername(value: string | null | undefined) {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/^@+/, "").toLowerCase()
    : null;
}

function normalizeFid(value: number | string | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "user-me-get",
    limit: 120,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  const authed = await getPrivyAuthedUserFromAuthorization(
    req.headers.get("authorization")
  );
  if (!authed.ok) return authed.response;

  const userId = authed.user.id;
  if (!userId) {
    return Response.json({ error: "Invalid user" }, { status: 401 });
  }

  const profile = await getCanonicalUserProfileByUserId(userId);
  const linkedTwitterUsername =
    normalizeUsername(authed.user.twitter?.username) ??
    normalizeUsername(
      Array.isArray(authed.linkedAccounts)
        ? (authed.linkedAccounts.find((account) => account.type === "twitter_oauth") as {
            username?: string | null;
          } | null)?.username
        : null
    );
  const linkedFid =
    normalizeFid(authed.user.farcaster?.fid) ??
    normalizeFid(
      Array.isArray(authed.linkedAccounts)
        ? (authed.linkedAccounts.find((account) => account.type === "farcaster") as {
            fid?: number | string | null;
          } | null)?.fid
        : null
    );

  const profileNeedsSync =
    !profile ||
    (linkedFid !== null && profile.fid !== linkedFid) ||
    (linkedTwitterUsername !== null &&
      normalizeUsername(profile.twitterUsername) !== linkedTwitterUsername) ||
    (linkedTwitterUsername !== null && typeof profile.twitterBio === "undefined");

  if (profile && !profileNeedsSync) return Response.json(profile);

  const result = await syncCanonicalUserProfileFromPrivyUser({
    user: authed.user,
    linkedAccounts: authed.linkedAccounts,
  });
  if (!result.ok) return result.response;

  return Response.json(result.profile);
}
