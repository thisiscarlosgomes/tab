import { DinnerAgentService } from "@/lib/dinner/agent/service";
import { NextRequest } from "next/server";
import { handleDinner } from "@/lib/dinner/http";
import { verifyDinnerSession } from "@/lib/dinner/auth";
import { actorForProfile, MongoRoomStore } from "@/lib/dinner/mongo-store";
import { DinnerService } from "@/lib/dinner/service";
import { Attachments } from "@/lib/dinner/attachments";

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
    const { default: clientPromise } = await import("@/lib/mongodb");
    const db = (await clientPromise).db();
    const service = new DinnerService(new MongoRoomStore(db));
    return handleDinner(request, (await context.params).path ?? [], {
      enabled: true,
      actor: async (req) => actorForProfile(db, await verifyDinnerSession(req)),
      service,
      agent: new DinnerAgentService(db, service),
      attachments: new Attachments(db, service),
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
