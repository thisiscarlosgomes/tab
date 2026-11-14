import { actor, sessions } from "../../../../state";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return Response.json(await actor(request));
  } catch {
    return Response.json(null, { status: 401 });
  }
}
export async function POST(request: Request) {
  const body = await request.json();
  const session = sessions.find(
    (s) =>
      s.actor.name === body.name &&
      (process.env.TAB_LIVE_LAB !== "1" || s === sessions[0]),
  );
  if (!session)
    return Response.json(
      { error: "Unknown fixture identity" },
      { status: 400 },
    );
  return Response.json(
    { name: session.actor.name },
    {
      headers: {
        "Set-Cookie": `tab-test-session=${session.token}; HttpOnly; SameSite=Strict; Path=/`,
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function DELETE() {
  return Response.json(
    { signedOut: true },
    {
      headers: {
        "Set-Cookie":
          "tab-test-session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        "Cache-Control": "no-store",
      },
    },
  );
}
