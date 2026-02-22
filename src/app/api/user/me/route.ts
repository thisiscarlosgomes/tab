import { NextRequest } from "next/server";
import { requireTrustedRequest } from "@/lib/security";
import {
  getCanonicalUserProfileByUserId,
  getPrivyAuthedUserFromAuthorization,
  syncCanonicalUserProfileFromPrivyUser,
} from "@/lib/user-profile";

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
  if (profile) return Response.json(profile);

  const result = await syncCanonicalUserProfileFromPrivyUser({
    user: authed.user,
    linkedAccounts: authed.linkedAccounts,
  });
  if (!result.ok) return result.response;

  return Response.json(result.profile);
}
