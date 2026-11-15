import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { MockLanguageModelV3 } from "ai/test";
import sharp from "sharp";
import { pendingExpenseRunner } from "./experiments/pending-runner";
import { DinnerAgentService } from "../../src/lib/dinner/agent/service";
import { DinnerService } from "../../src/lib/dinner/service";
import { MongoRoomStore } from "../../src/lib/dinner/mongo-store";
import { Attachments } from "../../src/lib/dinner/attachments";

test("candidate saves valid payer despite guessed participants, survives restart and rejects an unsupported payer overwrite", async () => {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db("pending-experiment");
    const dinner = new DinnerService(new MongoRoomStore(db));
    const alice = { id: randomUUID(), name: "Alice", twitterSubject: null };
    const bob = { id: randomUUID(), name: "Bob", twitterSubject: null };
    const room = await dinner.create(alice, {
      clientId: randomUUID(),
      name: "Test",
      purpose: "Test",
    });
    const invite = await dinner.invite(room.id, alice, {
      clientId: randomUUID(),
    });
    await dinner.respond(bob, { token: invite.token }, "accepted");
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const image = await new Attachments(db, dinner).upload(
      room.id,
      alice,
      new Request(`http://test?clientId=${randomUUID()}`, {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(bytes),
      }),
    );
    let patch = { payer: "me", participants: ["everyone"], splitEqually: true };
    let modelCalls = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        const callTool = modelCalls++ % 2 === 0;
        return {
          content: callTool
            ? [
                {
                  type: "tool-call",
                  toolCallId: randomUUID(),
                  toolName: "update_expense",
                  input: JSON.stringify(patch),
                },
              ]
            : [{ type: "text", text: "Review the saved details." }],
          finishReason: {
            unified: callTool ? "tool-calls" : "stop",
            raw: undefined,
          },
          usage: {
            inputTokens: {
              total: 1,
              noCache: 1,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const service = () =>
      new DinnerAgentService(
        db,
        dinner,
        pendingExpenseRunner(db, dinner, model),
        async () => ({
          merchant: "Test",
          totalAmount: 84.81,
          currency: "USD",
          confidence: 0.99,
          items: [],
        }),
      );
    const source = await dinner.send(room.id, alice, {
      clientId: randomUUID(),
      text: "@Tab split this receipt equally",
      attachmentIds: [image.id],
    });
    await service().respond(
      alice,
      { kind: "room", roomId: room.id },
      source.id,
    );
    let task = await db
      .collection("experiment-pending-expenses")
      .findOne({ userId: alice.id });
    assert.equal(task?.payerId, null);
    assert.equal(task?.participantIds, null);
    patch = { payer: "Bob", participants: ["everyone"], splitEqually: true };
    const payer = await dinner.send(room.id, alice, {
      clientId: randomUUID(),
      text: "@Tab Bob paid",
    });
    await service().respond(alice, { kind: "room", roomId: room.id }, payer.id);
    task = await db
      .collection("experiment-pending-expenses")
      .findOne({ userId: alice.id });
    assert.equal(task?.payerId, bob.id);
    assert.equal(task?.participantIds, null);
    for (let i = 0; i < 30; i++)
      await dinner.send(room.id, bob, {
        clientId: randomUUID(),
        text: `Chatter ${i}`,
      });
    patch = { payer: "me", participants: ["Alice", "Bob"], splitEqually: true };
    const final = await dinner.send(room.id, alice, {
      clientId: randomUUID(),
      text: "@Tab split it equally between Alice and Bob",
    });
    await service().respond(alice, { kind: "room", roomId: room.id }, final.id);
    const proposal = await db
      .collection("dinner-agent-proposals")
      .findOne({ roomId: room.id });
    assert.equal(proposal?.fields.payerId, bob.id);
    assert.equal(proposal?.fields.totalCents, 8481);
    assert.deepEqual(
      proposal?.fields.shares.map((s: { cents: number }) => s.cents).sort(),
      [4240, 4241],
    );
    assert.equal((await dinner.memberRoom(room.id, alice)).expenses.length, 0);
    await service().respond(alice, { kind: "room", roomId: room.id }, final.id);
    assert.equal(modelCalls, 6);
    assert.equal(
      await db.collection("dinner-agent-proposals").countDocuments({}),
      1,
    );
    assert.equal(
      await db
        .collection("experiment-pending-expenses")
        .countDocuments({ userId: bob.id }),
      0,
    );
  } finally {
    await client.close();
    await mongo.stop();
  }
});
