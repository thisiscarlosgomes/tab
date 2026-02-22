import { NextRequest } from "next/server";

function isNonEmpty(value: string | undefined) {
  return Boolean(value && value.trim().length > 0);
}

export async function GET(req: NextRequest) {
  void req;

  const readiness = {
    hasPrivyAppId: isNonEmpty(
      process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID
    ),
    hasPrivySecret: isNonEmpty(process.env.PRIVY_APP_SECRET),
    hasAgentExecutorKey: isNonEmpty(process.env.AGENT_EXECUTOR_KEY),
    hasPrivyAuthorizationKey: isNonEmpty(
      process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY
    ),
    hasAlchemyUrl: isNonEmpty(
      process.env.ALCHEMY_URL ?? process.env.NEXT_PUBLIC_ALCHEMY_URL
    ),
    hasNeynarApiKey: isNonEmpty(process.env.NEYNAR_API_KEY),
  };

  const sendSkillReady =
    readiness.hasPrivyAppId &&
    readiness.hasPrivySecret &&
    readiness.hasAgentExecutorKey &&
    readiness.hasPrivyAuthorizationKey &&
    readiness.hasAlchemyUrl;

  return Response.json({
    status: sendSkillReady ? "ready" : "not_ready",
    sendSkillReady,
    readiness,
  });
}
