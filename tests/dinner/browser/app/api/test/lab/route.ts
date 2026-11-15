import { z } from "zod";
import { actor, sessions } from "../../../../state";
import {
  labStatus,
  runRound,
  stopRound,
  resumeReplies,
} from "../../../../live-lab";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(labStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(request: Request) {
  if (!labStatus().enabled)
    return Response.json({ error: "Not enabled" }, { status: 404 });
  const user = await actor(request);
  if (user.id !== sessions[0].actor.id)
    return Response.json({ error: "Host only" }, { status: 403 });
  const { action } = z
    .object({ action: z.enum(["round", "chat", "stop", "resume"]) })
    .strict()
    .parse(await request.json());
  if (action === "stop") stopRound();
  else if (action === "resume") resumeReplies();
  else await runRound(undefined, action === "chat" ? "chat" : undefined);
  return Response.json(labStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
