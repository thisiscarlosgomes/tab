import { DinnerAgentService } from "./agent/service";
import { z, ZodError } from "zod";
import {
  Actor,
  DinnerError,
  entityId,
  expenseInput,
  correctionInput,
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
  agent?: DinnerAgentService;
  friends?: (request: Request) => Promise<unknown>;
};
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
}
type Reply = { status: string; text: string };
/**
 * Streams addressed agent replies as NDJSON when the client asks for it. The member message is
 * already persisted; the reply is persisted by the service before the final `done` line. Errors
 * raised before any text keep their normal JSON status so authorization failures stay visible.
 */
function agentReply(
  request: Request,
  run: (onDelta?: (text: string) => void) => Promise<Reply>,
): Promise<Response> {
  if (!request.headers.get("accept")?.includes("application/x-ndjson"))
    return run().then((reply) => json(reply));
  const encoder = new TextEncoder();
  return new Promise<Response>((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const queue: Uint8Array[] = [];
    let opened = false;
    let finished = false;
    const write = (value: unknown) => {
      const line = encoder.encode(JSON.stringify(value) + "\n");
      if (controller) controller.enqueue(line);
      else queue.push(line);
    };
    const finish = () => {
      finished = true;
      controller?.close();
    };
    const open = () => {
      if (opened) return;
      opened = true;
      resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              controller = c;
              for (const line of queue.splice(0)) c.enqueue(line);
              if (finished) c.close();
            },
          }),
          {
            headers: {
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "Cache-Control": "private, no-store",
              Vary: "Authorization",
            },
          },
        ),
      );
    };
    run((text) => {
      write({ type: "delta", text });
      open();
    }).then(
      (reply) => {
        if (!opened) return resolve(json(reply));
        write({ type: "done", ...reply });
        finish();
      },
      (error: unknown) => {
        if (!opened) return reject(error);
        write({
          type: "error",
          error:
            error instanceof DinnerError
              ? error.message
              : "Tab could not finish this reply. Your message is saved; retry it.",
        });
        finish();
      },
    );
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
      path[0] === "invites" &&
      path[1] &&
      path[2] === "account" &&
      path.length === 3 &&
      method === "GET"
    )
      return json(await deps.service.inviteAccount(path[1], actor));
    if (
      path.length === 1 &&
      path[0] === "friends" &&
      method === "GET" &&
      deps.friends
    )
      return json(await deps.friends(request));
    if (deps.agent) {
      const agent = deps.agent;
      if (path.length === 1 && path[0] === "wallet" && method === "GET")
        return json(await agent.wallet(actor));
      if (path[0] === "agent") {
        if (path.length === 2 && path[1] === "session" && method === "GET")
          return json(await agent.session(actor));
        if (path.length === 2 && path[1] === "messages" && method === "POST")
          return json(
            await agent.personalSend(actor, await body(request)),
            201,
          );
        if (path.length === 2 && path[1] === "respond" && method === "POST") {
          const input = z
            .object({ messageId: entityId })
            .strict()
            .parse(await body(request));
          return await agentReply(request, (onDelta) =>
            agent.respond(
              actor,
              { kind: "personal" },
              input.messageId,
              onDelta,
            ),
          );
        }
        if (path.length === 2 && path[1] === "memory") {
          if (method === "GET")
            return json(
              (await agent.note(actor, { kind: "personal" }, "memory")).value,
            );
          if (method === "PUT")
            return json(
              await agent.saveNote(
                actor,
                { kind: "personal" },
                "memory",
                await body(request),
              ),
            );
        }
        if (path.length === 2 && path[1] === "reminders") {
          if (method === "GET") return json(await agent.reminders(actor));
          if (method === "POST")
            return json(await agent.remind(actor, await body(request)), 201);
        }
        if (path.length === 3 && path[1] === "reminders" && method === "DELETE")
          return json(await agent.dismiss(actor, entityId.parse(path[2])));
        if (
          path.length === 4 &&
          path[1] === "proposals" &&
          path[3] === "apply" &&
          method === "POST"
        ) {
          z.object({ clientId: retryId })
            .strict()
            .parse(await body(request));
          return json(
            await agent.applyProposal(actor, entityId.parse(path[2])),
          );
        }
      }
    }
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
    if (deps.agent && path.length === 3) {
      const scope = {
        kind: "room",
        roomId,
      } satisfies import("./agent/capabilities").AgentScope;
      if (path[2] === "bot" && method === "POST") {
        const input = z
          .object({ messageId: entityId })
          .strict()
          .parse(await body(request));
        const agent = deps.agent;
        return await agentReply(request, (onDelta) =>
          agent.respond(actor, scope, input.messageId, onDelta),
        );
      }
      if (path[2] === "proposals" && method === "GET")
        return json(await deps.agent.roomProposals(actor, roomId));
      if (path[2] === "agreements" || path[2] === "memory") {
        if (method === "GET")
          return json((await deps.agent.note(actor, scope, path[2])).value);
        if (method === "PUT")
          return json(
            await deps.agent.saveNote(
              actor,
              scope,
              path[2],
              await body(request),
            ),
          );
      }
    }

    if (path[2] === "members" && path.length === 4 && method === "DELETE") {
      const input = z
        .object({ clientId: retryId })
        .strict()
        .parse(await body(request));
      return json(
        await deps.service.removeMember(
          roomId,
          actor,
          entityId.parse(path[3]),
          input.clientId,
        ),
      );
    }
    if (
      path[2] === "expenses" &&
      path[4] === "corrections" &&
      method === "POST"
    ) {
      const expenseId = entityId.parse(path[3]);
      if (path.length === 5) {
        const input = correctionInput.parse(await body(request));
        await deps.attachments.assertInRoom(
          roomId,
          actor,
          input.attachmentId ? [input.attachmentId] : [],
        );
        return json(
          await deps.service.proposeCorrection(roomId, actor, expenseId, input),
          201,
        );
      }
      if (path.length === 7) {
        const correctionId = entityId.parse(path[5]);
        if (path[6] === "confirm") {
          const input = z
            .object({ clientId: retryId })
            .strict()
            .parse(await body(request));
          return json(
            await deps.service.confirmCorrection(
              roomId,
              actor,
              expenseId,
              correctionId,
              input.clientId,
            ),
          );
        }
        if (path[6] === "flag") {
          const input = z
            .object({ reason: z.string().trim().min(1).max(400) })
            .strict()
            .parse(await body(request));
          return json(
            await deps.service.disputeCorrection(
              roomId,
              actor,
              expenseId,
              correctionId,
              input.reason,
            ),
          );
        }
      }
    }
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
    if (
      path[2] === "obligations" &&
      path[3] &&
      path[4] === "reports" &&
      method === "POST"
    ) {
      const obligationId = entityId.parse(path[3]);
      const input = z
        .object({ clientId: retryId })
        .strict()
        .parse(await body(request));
      if (path.length === 5)
        return json(
          await deps.service.reportOutside(
            roomId,
            actor,
            obligationId,
            input.clientId,
          ),
          201,
        );
      if (path.length === 7) {
        const decision = z
          .enum(["confirmed", "rejected", "cancelled"])
          .parse(path[6]);
        return json(
          await deps.service.resolveOutside(
            roomId,
            actor,
            obligationId,
            entityId.parse(path[5]),
            decision,
            input.clientId,
          ),
        );
      }
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
