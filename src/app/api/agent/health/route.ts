import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";

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

  let mongoReady = false;
  let mongoError: string | null = null;
  try {
    const client = await clientPromise;
    await client.db().command({ ping: 1 });
    mongoReady = true;
  } catch (error) {
    mongoError = error instanceof Error ? error.message : "Mongo ping failed";
  }

  return Response.json({
    status: sendSkillReady && mongoReady ? "ready" : "not_ready",
    sendSkillReady: sendSkillReady && mongoReady,
    readiness: {
      ...readiness,
      hasMongo: mongoReady,
    },
    diagnostics: mongoError ? { mongoError } : undefined,
  });
}
