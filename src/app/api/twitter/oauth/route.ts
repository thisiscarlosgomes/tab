import { NextRequest } from "next/server";
import { requireTrustedRequest } from "@/lib/security";
import { getPrivyAuthedUserFromAuthorization } from "@/lib/user-profile";
import { saveTwitterOAuthTokensForUser } from "@/lib/twitter";

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "twitter-oauth-post",
    limit: 60,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  const authed = await getPrivyAuthedUserFromAuthorization(
    req.headers.get("authorization")
  );
  if (!authed.ok) return authed.response;

  const body = await req.json().catch(() => ({}));
  const tokens =
    body && typeof body === "object" && body.tokens && typeof body.tokens === "object"
      ? body.tokens
      : null;

  if (!tokens) {
    return Response.json({ error: "Missing tokens" }, { status: 400 });
  }

  await saveTwitterOAuthTokensForUser({
    userId: String(authed.user.id ?? "").trim(),
    user: authed.user,
    tokens: tokens as {
      provider: string;
      accessToken: string;
      accessTokenExpiresInSeconds?: number;
      refreshToken?: string;
      refreshTokenExpiresInSeconds?: number;
      scopes?: string[];
    },
  });

  return Response.json({ success: true });
}
