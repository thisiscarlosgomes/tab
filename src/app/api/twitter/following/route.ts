import { NextRequest } from "next/server";
import { requireTrustedRequest } from "@/lib/security";
import { getPrivyAuthedUserFromAuthorization } from "@/lib/user-profile";
import { fetchTwitterFollowingForUser } from "@/lib/twitter";
import { SocialUser } from "@/lib/social";

function getTwitterSubjectFromAuth(input: {
  user: { twitter?: { subject?: string | null } | null };
  linkedAccounts: Array<{ type?: string; subject?: string | null }>;
}) {
  const direct =
    input.user?.twitter && typeof input.user.twitter.subject === "string"
      ? input.user.twitter.subject
      : null;
  if (direct) return direct;

  const linked = input.linkedAccounts.find(
    (account) => account.type === "twitter_oauth" && typeof account.subject === "string"
  );
  return linked?.subject ?? null;
}

export async function GET(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "twitter-following-get",
    limit: 80,
    windowMs: 60_000,
    allowBearerAuthorization: true,
  });
  if (denied) return denied;

  const authed = await getPrivyAuthedUserFromAuthorization(
    req.headers.get("authorization")
  );
  if (!authed.ok) return authed.response;

  const subject = getTwitterSubjectFromAuth({
    user: authed.user,
    linkedAccounts: authed.linkedAccounts,
  });

  if (!subject) {
    return Response.json([]);
  }

  try {
    const profiles = await fetchTwitterFollowingForUser({
      userId: String(authed.user.id ?? "").trim(),
      subject,
      limit: Number(req.nextUrl.searchParams.get("limit") ?? 50),
    });

    const users: SocialUser[] = profiles.map((profile) => ({
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
    }));

    return Response.json(users);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch Twitter following",
      },
      { status: 400 }
    );
  }
}
