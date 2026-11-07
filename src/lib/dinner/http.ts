import { z, ZodError } from "zod";
import {
  Actor,
  DinnerError,
  entityId,
  expenseInput,
  fail,
  messageInput,
  roomView,
  retryId,
} from "./model";
import { DinnerService } from "./service";
import { Attachments } from "./attachments";

export type DinnerDependencies = {
  enabled: boolean;
  actor: (request: Request) => Promise<Actor>;
  service: DinnerService;
  attachments: Attachments;
  friends?: (request: Request) => Promise<unknown>;
};
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
}
async function body(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > 32_000)
    fail(413, "Request too large");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "Missing request body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > 32_000) {
      await reader.cancel();
      fail(413, "Request too large");
    }
    chunks.push(next.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return fail(400, "Invalid JSON");
  }
}
export async function handleDinner(
  request: Request,
  path: string[],
  deps: DinnerDependencies,
): Promise<Response> {
  try {
    if (!deps.enabled)
      return json({ error: "Dinner rooms are not enabled" }, 404);
    const method = request.method;
    if (
      path[0] === "invites" &&
      path[1] &&
      path.length === 2 &&
      method === "GET"
    )
      return json(await deps.service.preview(path[1]));
    const actor = await deps.actor(request);
    if (
      path.length === 1 &&
      path[0] === "friends" &&
      method === "GET" &&
      deps.friends
    )
      return json(await deps.friends(request));
    if (path.length === 1 && path[0] === "me" && method === "GET")
      return json({ id: actor.id, name: actor.name });
    if (path.length === 1 && path[0] === "rooms") {
      if (method === "GET") return json(await deps.service.list(actor));
      if (method === "POST")
        return json(await deps.service.create(actor, await body(request)), 201);
    }
    if (
      path[0] === "invites" &&
      path[1] &&
      path[2] === "respond" &&
      path.length === 3 &&
      method === "POST"
    ) {
      const input = z
        .object({ decision: z.enum(["accepted", "declined"]) })
        .strict()
        .parse(await body(request));
      return json(
        await deps.service.respond(actor, { token: path[1] }, input.decision),
      );
    }
    if (path[0] !== "rooms" || !path[1]) fail(404, "Not found");
    const roomId = entityId.parse(path[1]);
    if (path.length === 2 && method === "GET")
      return json(roomView(await deps.service.memberRoom(roomId, actor)));
    if (path.length === 3 && path[2] === "respond" && method === "POST") {
      const input = z
        .object({
          invitationId: entityId,
          decision: z.enum(["accepted", "declined"]),
        })
        .strict()
        .parse(await body(request));
      return json(
        await deps.service.respond(
          actor,
          { roomId, invitationId: input.invitationId },
          input.decision,
        ),
      );
    }
    await deps.service.memberRoom(roomId, actor);
    if (path[2] === "invites" && path.length === 3 && method === "POST")
      return json(
        await deps.service.invite(roomId, actor, await body(request)),
        201,
      );
    if (
      path[2] === "invites" &&
      path[3] &&
      path.length === 4 &&
      method === "DELETE"
    )
      return json(
        await deps.service.revoke(roomId, actor, entityId.parse(path[3])),
      );
    if (path[2] === "messages" && path.length === 3) {
      if (method === "GET") {
        const query = new URL(request.url).searchParams;
        const after = z.coerce
          .number()
          .int()
          .min(0)
          .parse(query.get("after") ?? 0);
        const before = z.coerce
          .number()
          .int()
          .min(1)
          .optional()
          .parse(query.get("before") ?? undefined);
        const room = await deps.service.memberRoom(roomId, actor);
        const eligible = room.messages.filter(
          (m) => m.seq > after && (!before || m.seq < before),
        );
        const messages = eligible.slice(0, 100);
        return json({ messages, hasMore: eligible.length > messages.length });
      }
      if (method === "POST") {
        const input = messageInput.parse(await body(request));
        await deps.attachments.assertInRoom(roomId, actor, input.attachmentIds);
        return json(await deps.service.send(roomId, actor, input), 201);
      }
    }
    if (
      path[2] === "messages" &&
      path[3] &&
      path[4] === "reaction" &&
      path.length === 5 &&
      method === "PUT"
    ) {
      const input = z
        .object({ emoji: z.string(), active: z.boolean() })
        .strict()
        .parse(await body(request));
      return json(
        await deps.service.react(
          roomId,
          actor,
          entityId.parse(path[3]),
          input.emoji,
          input.active,
        ),
      );
    }
    if (path[2] === "read" && path.length === 3 && method === "PUT") {
      const input = z
        .object({ seq: z.number().int().min(0) })
        .strict()
        .parse(await body(request));
      return json(await deps.service.read(roomId, actor, input.seq));
    }
    if (
      (path[2] === "expenses" && method === "POST" && path.length === 3) ||
      (path[2] === "expenses" && method === "PATCH" && path.length === 4)
    ) {
      const input = expenseInput.parse(await body(request));
      await deps.attachments.assertInRoom(
        roomId,
        actor,
        input.attachmentId ? [input.attachmentId] : [],
      );
      return json(
        await deps.service.draft(
          roomId,
          actor,
          input,
          path[3] ? entityId.parse(path[3]) : undefined,
        ),
        201,
      );
    }
    if (
      path[2] === "expenses" &&
      path[3] &&
      path[4] === "confirm" &&
      path.length === 5 &&
      method === "POST"
    ) {
      const input = z
        .object({ clientId: retryId, expectedVersion: z.number().int().min(0) })
        .strict()
        .parse(await body(request));
      return json(
        await deps.service.confirm(
          roomId,
          actor,
          entityId.parse(path[3]),
          input.clientId,
          input.expectedVersion,
        ),
      );
    }
    if (
      path[2] === "expenses" &&
      path[3] &&
      path[4] === "flag" &&
      path.length === 5 &&
      method === "POST"
    ) {
      const input = z
        .object({ reason: z.string().trim().min(1).max(400) })
        .strict()
        .parse(await body(request));
      return json(
        await deps.service.flag(
          roomId,
          actor,
          entityId.parse(path[3]),
          input.reason,
        ),
      );
    }
    if (path[2] === "attachments" && path.length === 3 && method === "POST")
      return json(await deps.attachments.upload(roomId, actor, request), 201);
    if (
      path[2] === "attachments" &&
      path[3] &&
      path.length === 4 &&
      method === "GET"
    )
      return await deps.attachments.download(
        roomId,
        entityId.parse(path[3]),
        actor,
      );
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof DinnerError)
      return json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return json(
        { error: error.issues.map((i) => i.message).join("; ") },
        400,
      );
    console.error("dinner_request_failed", {
      path: path[0],
      error: error instanceof Error ? error.name : "unknown",
    });
    return json(
      { error: "Rooms are temporarily unavailable. Retry safely in a moment." },
      503,
    );
  }
}
