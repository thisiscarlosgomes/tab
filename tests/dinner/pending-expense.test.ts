import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { MockLanguageModelV3 } from "ai/test";
import sharp from "sharp";
import { runPendingExpenseAgent } from "../../src/lib/dinner/agent/pending-runtime";
import { DinnerAgentService } from "../../src/lib/dinner/agent/service";
import { DinnerService } from "../../src/lib/dinner/service";
import { MongoRoomStore } from "../../src/lib/dinner/mongo-store";
import { Attachments } from "../../src/lib/dinner/attachments";

test("production pending flow preserves payer across restart and renders grounded shares without debts", async () => {
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
    let patch = {
      totalUsd: null,
      payer: "me",
      participants: ["everyone"],
      splitEqually: true,
    };
    let modelCalls = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        modelCalls++;
        const callTool = true;
        return {
          content: callTool
            ? [
                {
                  type: "tool-call",
                  toolCallId: randomUUID(),
                  toolName: "update_pending_expense",
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
        async (context) => {
          const pending = await context.pendingExpense?.();
          assert.ok(pending);
          return runPendingExpenseAgent(context, pending, model);
        },
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
      .collection("dinner-pending-expenses")
      .findOne({ userId: alice.id });
    assert.equal(task?.payerId, null);
    assert.equal(task?.participantIds, null);
    patch = {
      totalUsd: null,
      payer: "Bob",
      participants: ["everyone"],
      splitEqually: true,
    };
    const payer = await dinner.send(room.id, alice, {
      clientId: randomUUID(),
      text: "@Tab Bob paid",
    });
    await service().respond(alice, { kind: "room", roomId: room.id }, payer.id);
    task = await db
      .collection("dinner-pending-expenses")
      .findOne({ userId: alice.id });
    assert.equal(task?.payerId, bob.id);
    assert.equal(task?.participantIds, null);
    for (let i = 0; i < 30; i++)
      await dinner.send(room.id, bob, {
        clientId: randomUUID(),
        text: `Chatter ${i}`,
      });
    patch = {
      totalUsd: null,
      payer: "me",
      participants: ["Alice", "Bob"],
      splitEqually: true,
    };
    const final = await dinner.send(room.id, alice, {
      clientId: randomUUID(),
      text: "@Tab split it equally between Alice and Bob",
      replyTo: source.id,
    });
    const deltas: string[] = [];
    const response = await service().respond(
      alice,
      { kind: "room", roomId: room.id },
      final.id,
      (text) => deltas.push(text),
    );
    assert.match(response.text, /Bob paid/);
    assert.match(response.text, /Shares:/);
    assert.doesNotMatch(response.text, /owes?|owed/i);
    assert.equal(deltas.join(""), response.text);
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
    assert.equal(modelCalls, 3);
    assert.equal(
      await db.collection("dinner-agent-proposals").countDocuments({}),
      1,
    );
    assert.equal(
      await db
        .collection("dinner-pending-expenses")
        .countDocuments({ userId: bob.id }),
      0,
    );
  } finally {
    await client.close();
    await mongo.stop();
  }
});

import { openPendingExpense } from "../../src/lib/dinner/agent/pending-expense";
import type { Proposal } from "../../src/lib/dinner/agent/model";

test("pending proposal recovers a lost acknowledgement under the same task key across source messages", async () => {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db("pending-recovery");
    const dinner = new DinnerService(new MongoRoomStore(db));
    const alice = { id: randomUUID(), name: "Alice", twitterSubject: null };
    const bob = { id: randomUUID(), name: "Bob", twitterSubject: null };
    const room = await dinner.create(alice, {
      clientId: randomUUID(),
      name: "Test",
      purpose: "Recovery",
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
    const attachment = await new Attachments(db, dinner).upload(
      room.id,
      alice,
      new Request(`http://test?clientId=${randomUUID()}`, {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(bytes),
      }),
    );
    const source = await dinner.send(room.id, alice, {
      clientId: randomUUID(),
      text: "@Tab split this receipt equally between Alice and Bob. Bob paid.",
      attachmentIds: [attachment.id],
    });
    let loseAck = true;
    const keys: string[] = [];
    const open = (sourceId: string) =>
      openPendingExpense({
        db,
        actor: alice,
        sourceId,
        room: () => dinner.memberRoom(room.id, alice),
        extract: async () => null,
        prepare: async (input, key) => {
          keys.push(key);
          let proposal: Proposal | null = await db
            .collection<Proposal>("dinner-agent-proposals")
            .findOne({ runKey: key });
          if (!proposal) {
            proposal = {
              id: randomUUID(),
              userId: alice.id,
              roomId: room.id,
              runKey: key,
              visibility: "room",
              members: [
                { userId: alice.id, name: "Alice" },
                { userId: bob.id, name: "Bob" },
              ],
              createdAt: new Date().toISOString(),
              appliedExpenseId: null,
              fields: {
                description: input.description!,
                payerId: input.payerId!,
                totalCents: input.totalCents!,
                shares: input.shares!,
                attachmentId: input.attachmentId,
              },
            };
            await db
              .collection<Proposal>("dinner-agent-proposals")
              .insertOne(proposal!);
          }
          if (loseAck) {
            loseAck = false;
            throw new Error("Lost proposal acknowledgement");
          }
          return proposal!;
        },
      });
    const continuation = await dinner.send(room.id, alice, {
      clientId: randomUUID(),
      text: "@Tab continue this split",
      replyTo: source.id,
    });
    const first = await open(continuation.id);
    assert.ok(first);

    const guessed = await first.update({
      payer: "Bob",
      participants: ["Alice", "Bob"],
      splitEqually: true,
      totalUsd: "99.99",
    });
    assert.equal(
      guessed.total,
      null,
      "A model cannot invent the unreadable total",
    );
    const amount = await dinner.send(room.id, alice, {
      clientId: randomUUID(),
      text: "@Tab 84.81",
      replyTo: source.id,
    });
    const withAmount = await open(amount.id);
    assert.ok(withAmount);
    await assert.rejects(
      withAmount.update({
        payer: null,
        participants: null,
        splitEqually: null,
        totalUsd: "84.81",
      }),
      /Lost proposal/,
    );
    const retry = await dinner.send(room.id, alice, {
      clientId: randomUUID(),
      text: "@Tab retry this split",
      replyTo: source.id,
    });
    const resumed = await open(retry.id);
    assert.ok(resumed);
    const result = await resumed.current();
    assert.equal(result.status, "ready");
    assert.match(result.reply, /Bob paid/);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.equal(
      await db.collection("dinner-agent-proposals").countDocuments({}),
      1,
    );
    assert.equal((await dinner.memberRoom(room.id, alice)).expenses.length, 0);
    await assert.rejects(first.current(), /newer clarification/i);
    // Simulate rollout into a conversation that already has a proposal but no task record.
    await db.collection("dinner-pending-expenses").deleteMany({});
    const migrated = await open(retry.id);
    assert.ok(migrated);
    assert.equal((await migrated.current()).status, "ready");
    assert.equal(
      keys.length,
      2,
      "Migration must reuse the proposal without another preparation call",
    );
    assert.equal(
      await db.collection("dinner-agent-proposals").countDocuments({}),
      1,
    );
  } finally {
    await client.close();
    await mongo.stop();
  }
});

test("pending expenses recheck membership, reject other authors and can be cancelled before preparation", async () => {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  try {
    const db = client.db("pending-members");
    const dinner = new DinnerService(new MongoRoomStore(db));
    const alice = { id: randomUUID(), name: "Alice", twitterSubject: null };
    const bob = { id: randomUUID(), name: "Bob", twitterSubject: null };
    const room = await dinner.create(alice, {
      clientId: randomUUID(),
      name: "Test",
      purpose: "Membership",
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
    const upload = await new Attachments(db, dinner).upload(
      room.id,
      alice,
      new Request(`http://test?clientId=${randomUUID()}`, {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(bytes),
      }),
    );
    const source = await dinner.send(room.id, alice, {
      clientId: randomUUID(),
      text: "@Tab split this receipt equally. Bob paid",
      attachmentIds: [upload.id],
    });
    let preparations = 0;
    const deps = {
      db,
      actor: alice,
      sourceId: source.id,
      room: () => dinner.memberRoom(room.id, alice),
      extract: async () => ({
        merchant: "Test",
        totalAmount: 20,
        currency: "USD",
        confidence: 0.99,
        items: [],
      }),
      prepare: async (): Promise<Proposal> => {
        preparations++;
        throw new Error("Must not prepare");
      },
    };
    const flow = await openPendingExpense(deps);
    assert.ok(flow);
    await flow.update({
      payer: "Bob",
      participants: null,
      splitEqually: true,
      totalUsd: null,
    });
    await assert.rejects(
      openPendingExpense({ ...deps, actor: bob }),
      /addressed message/i,
    );
    await dinner.removeMember(room.id, alice, bob.id, randomUUID());
    const current = await flow.current();
    assert.equal(current.payer, null);
    assert.match(current.reply, /Who paid/);
    assert.equal(preparations, 0);
    const cancel = await dinner.send(room.id, alice, {
      clientId: randomUUID(),
      text: "@Tab cancel this split",
      replyTo: source.id,
    });
    const cancelled = await openPendingExpense({
      ...deps,
      sourceId: cancel.id,
    });
    assert.ok(cancelled);
    assert.equal((await cancelled.current()).status, "cancelled");
    assert.equal(preparations, 0);
  } finally {
    await client.close();
    await mongo.stop();
  }
});
