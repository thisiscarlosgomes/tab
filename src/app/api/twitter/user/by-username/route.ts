import { NextRequest } from "next/server";
import { requireTrustedRequest } from "@/lib/security";
import { getPrivyAuthedUserFromAuthorization } from "@/lib/user-profile";
import { fetchTwitterUserByUsername } from "@/lib/twitter";
import { SocialUser } from "@/lib/social";

export async function GET(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "twitter-user-by-username-get",
    limit: 120,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  const username = req.nextUrl.searchParams.get("username")?.trim() ?? "";
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const authed = await getPrivyAuthedUserFromAuthorization(
    req.headers.get("authorization")
  );

  const profile = await fetchTwitterUserByUsername(username, {
    actorUserId: authed.ok ? String(authed.user.id ?? "").trim() : null,
  }).catch(() => null);

  if (!profile) {
    return Response.json({ user: null });
  }

  const user: SocialUser = {
    id: `twitter:${profile.subject}`,
    provider: "twitter",
    twitter_subject: profile.subject,
    username: profile.username,
    display_name: profile.name,
    pfp_url: profile.profilePictureUrl ?? undefined,
    verified_addresses: {
      primary: {
        eth_address: null,
      },
    },
  };

  return Response.json({ user });
}
