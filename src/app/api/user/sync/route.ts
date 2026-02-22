import { NextRequest } from "next/server";
import { requireTrustedRequest } from "@/lib/security";
import {
  getPrivyAuthedUserFromAuthorization,
  syncCanonicalUserProfileFromPrivyUser,
} from "@/lib/user-profile";

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "user-sync-post",
    limit: 80,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  const authed = await getPrivyAuthedUserFromAuthorization(
    req.headers.get("authorization")
  );
  if (!authed.ok) return authed.response;

  const result = await syncCanonicalUserProfileFromPrivyUser({
    user: authed.user,
    linkedAccounts: authed.linkedAccounts,
  });
  if (!result.ok) return result.response;

  return Response.json(result.profile);
}
