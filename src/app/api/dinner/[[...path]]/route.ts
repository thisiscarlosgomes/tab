import { PlanService } from "@/lib/dinner/plans/service";
import { getDinnerServices } from "@/lib/dinner/services";
import { AgentJobs } from "@/lib/dinner/agent/jobs";
import { publishAgentJob } from "@/lib/dinner/agent/queue";
import { after, NextRequest } from "next/server";
import { handleDinner } from "@/lib/dinner/http";
import { verifyDinnerSession } from "@/lib/dinner/auth";
import { actorForProfile } from "@/lib/dinner/mongo-store";

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
) {
  if (process.env.DINNER_ROOMS_ENABLED !== "true")
    return Response.json(
      { error: "Dinner rooms are not enabled" },
      { status: 404 },
    );
  try {
    const { db, service, agent, attachments } = await getDinnerServices();
    return handleDinner(request, (await context.params).path ?? [], {
      enabled: true,
      actor: async (req) => actorForProfile(db, await verifyDinnerSession(req)),
      service,
      plans: new PlanService(db, service),
      agent,
      attachments,
      enqueueAgent: async (actor, roomId, source) => {
        const jobs = new AgentJobs(db, service, agent);
        await jobs.enqueue(actor, roomId, source, process.env.VERCEL === "1" ? publishAgentJob : async delivery => {
          // Plain next dev has no hosted queue worker. Persistence stays identical.
          after(async () => { try { await jobs.process(delivery); } catch { console.warn("Local agent work remains retryable"); } });
        });
      },
      friends: async (req) => {
        const profile = await verifyDinnerSession(req);
        if (!profile.twitterSubject) return [];
        const { fetchTwitterFollowingForUser } = await import("@/lib/twitter");
        const friends = await fetchTwitterFollowingForUser({
          userId: profile.privyId,
          subject: profile.twitterSubject,
          limit: 50,
        });
        const known = await db
          .collection<{ twitterSubject: string }>("dinner-users")
          .find(
            {
              twitterSubject: { $in: friends.map((friend) => friend.subject) },
            },
            { projection: { twitterSubject: 1 } },
          )
          .toArray();
        return friends.map((friend) => ({
          subject: friend.subject,
          username: friend.username,
          name: friend.name,
          onTab: known.some((user) => user.twitterSubject === friend.subject),
        }));
      },
    });
  } catch {
    return Response.json(
      {
        error: "Rooms are temporarily unavailable. Check server configuration.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export {
  handler as GET,
  handler as POST,
  handler as PATCH,
  handler as PUT,
  handler as DELETE,
};
