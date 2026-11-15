import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { DinnerService } from "../../src/lib/dinner/service";
import { MongoRoomStore } from "../../src/lib/dinner/mongo-store";
import { DinnerAgentService } from "../../src/lib/dinner/agent/service";
import { AgentJobs, type JobDelivery } from "../../src/lib/dinner/agent/jobs";

async function fixture() {
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  const db = client.db("durable-tasks");
  const dinner = new DinnerService(new MongoRoomStore(db));
  const alice = { id: randomUUID(), name: "Alice", twitterSubject: null };
  const bob = { id: randomUUID(), name: "Bob", twitterSubject: null };
  const room = await dinner.create(alice, {
    clientId: randomUUID(),
    name: "Dinner",
    purpose: "Test",
  });
  const invite = await dinner.invite(room.id, alice, {
    clientId: randomUUID(),
  });
  await dinner.respond(bob, { token: invite.token }, "accepted");
  const send = (text: string, actor = alice) =>
    dinner.send(room.id, actor, { clientId: randomUUID(), text });
  return {
    db,
    dinner,
    alice,
    bob,
    room,
    send,
    close: async () => {
      await client.close();
      await mongo.stop();
    },
  };
}

test("manual bill slots survive restart and more than 25 messages, with one proposal after interrupted delivery", async () => {
  const f = await fixture();
  try {
    let prepare = false;
    let failOnce = false;
    const runner: import("../../src/lib/dinner/agent/capabilities").AgentRunner =
      async (context) => {
        assert.ok(
          context.conversation.some((m) =>
            m.content.includes("Saved bill task"),
          ),
        );
        if (!prepare) return "Who should share this bill?";
        const result = await context.prepareExpense({
          roomId: f.room.id,
          description: "Dinner",
          totalCents: 99900,
          payerId: f.bob.id,
          shares: [
            { userId: f.alice.id, cents: 3000 },
            { userId: f.bob.id, cents: 3000 },
          ],
        });
        assert.ok(!("kind" in result));
        if (failOnce) {
          failOnce = false;
          throw new Error("lost response after saved proposal");
        }
        return "Your bill is ready to review.";
      };
    let agent = new DinnerAgentService(f.db, f.dinner, runner);
    const first = await f.send("Tab create a dinner bill. USD 60. I paid.");
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, first.id);
    const stored = await f.db
      .collection("dinner-bill-tasks")
      .findOne({ roomId: f.room.id });
    assert.equal(stored?.fields.totalCents, 6000);
    assert.equal(stored?.fields.payerId, f.alice.id);
    assert.equal(stored?.question, "Who should share this bill?");
    for (let i = 0; i < 30; i++)
      await f.send(`Unrelated conversation ${i}`, f.bob);
    agent = new DinnerAgentService(f.db, f.dinner, runner);
    prepare = true;
    failOnce = true;
    const answer = await f.send("@Tab everyone, split equally");
    await assert.rejects(
      agent.respond(f.alice, { kind: "room", roomId: f.room.id }, answer.id),
      /could not finish/,
    );
    agent = new DinnerAgentService(f.db, f.dinner, runner);
    const retry = await f.send("@Tab resume the same bill");
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, retry.id);
    const proposals = await agent.roomProposals(f.alice, f.room.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].fields.totalCents, 6000);
    assert.equal(proposals[0].fields.payerId, f.alice.id);
    assert.equal(
      (await f.dinner.memberRoom(f.room.id, f.alice)).expenses.length,
      0,
    );
    assert.equal(
      await f.db
        .collection("dinner-bill-tasks")
        .countDocuments({ roomId: f.room.id }),
      1,
    );
  } finally {
    await f.close();
  }
});

test("durable work executes without a client, retries safely and refuses forged or removed-member jobs", async () => {
  const f = await fixture();
  try {
    let runs = 0;
    const agent = new DinnerAgentService(f.db, f.dinner, async () => {
      runs++;
      if (runs === 1) throw new Error("transient model failure");
      return "Who should share the bill?";
    });
    const jobs = new AgentJobs(f.db, f.dinner, agent);
    const deliveries: JobDelivery[] = [];
    const source = await f.send("Tab create a dinner bill for USD 60. I paid.");
    await jobs.enqueue(f.alice, f.room.id, source, async (d) => {
      deliveries.push(d);
    });
    await jobs.enqueue(f.alice, f.room.id, source, async (d) => {
      deliveries.push(d);
    });
    assert.deepEqual(deliveries[0], deliveries[1]);
    await assert.rejects(
      jobs.process({ ...deliveries[0], token: randomUUID() }),
      /Unknown/,
    );
    await assert.rejects(jobs.process(deliveries[0]), /could not finish/);
    const restarted = new AgentJobs(f.db, f.dinner, agent);
    await restarted.process(deliveries[0]);
    await restarted.process(deliveries[0]);
    assert.equal(runs, 2);
    assert.equal(
      (await f.dinner.memberRoom(f.room.id, f.alice)).messages.filter(
        (m) => m.kind === "tab" && m.runId === source.id,
      ).length,
      1,
    );
    assert.equal(
      (
        await f.db
          .collection<{ _id: string; status: string }>("dinner-agent-jobs")
          .findOne({ _id: deliveries[0].jobId })
      )?.status,
      "complete",
    );
    const otherSource = await f.send("@Tab hello", f.bob);
    await jobs.enqueue(f.bob, f.room.id, otherSource, async (d) => {
      deliveries.push(d);
    });
    await f.dinner.change(f.room.id, f.alice, (room) => {
      room.members = room.members.filter((m) => m.userId !== f.bob.id);
    });
    await jobs.process(deliveries.at(-1)!);
    assert.equal(
      (
        await f.db
          .collection<{ _id: string; status: string }>("dinner-agent-jobs")
          .findOne({ _id: deliveries.at(-1)!.jobId })
      )?.status,
      "cancelled",
    );
  } finally {
    await f.close();
  }
});

test("action-first creation rejects invented fields and reuses its route after a retry", async () => {
  const f = await fixture();
  try {
    await f.dinner.setAssistance(f.room.id, f.alice, "mentions");
    let classifications = 0;
    let attempts = 0;
    const agent = new DinnerAgentService(f.db, f.dinner, async context => {
      const proposal = await context.prepareExpense({ roomId: f.room.id, totalCents: 100, payerId: f.alice.id,
        shares: [{ userId: f.alice.id, cents: 50 }, { userId: f.bob.id, cents: 50 }] });
      assert.ok("kind" in proposal, "Model guesses must not create a proposal");
      if (++attempts === 1) throw new Error("Interrupted after validation");
      return "Who paid and who is sharing this bill?";
    }, undefined, undefined, async () => { classifications++; return { action: "create" }; });
    const message = await f.send("@Tab put together a $1 dinner split");
    await assert.rejects(agent.respond(f.alice, { kind: "room", roomId: f.room.id }, message.id));
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, message.id);
    assert.equal(classifications, 1);
    assert.equal(await f.db.collection("dinner-bill-tasks").countDocuments(), 1);
    assert.equal((await agent.roomProposals(f.alice, f.room.id)).length, 0);
    const task = await f.db.collection("dinner-bill-tasks").findOne({});
    assert.equal(task?.fields.totalCents, 100);
    assert.equal(task?.fields.payerId, undefined);
    assert.equal(task?.participantIds, null);
  } finally { await f.close(); }
});

test("an adjacent answer selects its question's bill despite other unfinished manual bills", async () => {
  const f = await fixture();
  try {
    await f.dinner.setAssistance(f.room.id, f.alice, "mentions");
    const makeAgent = () => new DinnerAgentService(f.db, f.dinner, async context => {
      if (!context.readyBill) return "Who paid, who is sharing the bill, and how should it be split?";
      const result = await context.prepareExpense(context.readyBill);
      assert.ok(!("kind" in result));
      return "Ready to confirm.";
    }, undefined, undefined, async input => ({ action: input.current.startsWith("tab create") ? "create" : "continue" }));
    let agent = makeAgent();
    for (const text of ["tab create a split bill for $20", "tab create a split bill for $1"]) {
      const source = await f.send(text);
      await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, source.id);
    }
    const old = await f.db.collection("dinner-bill-tasks").findOne({ "fields.totalCents": 2000 });
    agent = makeAgent(); // Task binding must survive a process restart.
    const answer = await f.send("i paid, everyone and split it equally");
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, answer.id);
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, answer.id);
    const proposals = await agent.roomProposals(f.alice, f.room.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].fields.totalCents, 100);
    assert.equal(proposals[0].fields.payerId, f.alice.id);
    assert.deepEqual(proposals[0].fields.shares.map(s => s.cents), [50, 50]);
    assert.deepEqual(await f.db.collection("dinner-bill-tasks").findOne({ _id: old!._id }), old);
    assert.equal((await f.dinner.memberRoom(f.room.id, f.alice)).expenses.length, 0);
  } finally { await f.close(); }
});

test("smart-assistance creation context cannot override a new read-only question", async () => {
  const f = await fixture();
  try {
    await f.dinner.setAssistance(f.room.id, f.alice, "smart");
    let lookup = false;
    const agent = new DinnerAgentService(f.db, f.dinner, async context => {
      if (!lookup) return "Who paid and who is sharing this bill?";
      assert.equal(context.action, "lookup");
      assert.deepEqual(await context.lookupSummary?.(), { awaitingPayment: 0, awaitingConfirmation: 0, outstandingCents: 0 });
      assert.ok(!context.conversation.some(m => m.content.startsWith("The current requester accepted Tab's offer")));
      assert.equal(context.readyBill, undefined);
      assert.equal(await context.pendingExpense?.(), null);
      const facts = await context.readContext() as { billCounts: unknown };
      assert.deepEqual(facts.billCounts, { awaitingPayment: 0, awaitingConfirmation: 0 });
      const attempt = await context.prepareExpense({ roomId: f.room.id, totalCents: 100, payerId: f.alice.id, shares: [{ userId: f.alice.id, cents: 50 }, { userId: f.bob.id, cents: 50 }] });
      assert.ok("kind" in attempt);
      return "There are no confirmed bills awaiting payment.";
    }, undefined, undefined, async input => {
      assert.ok(!input.conversation.some(m => m.content.startsWith("The current requester accepted Tab's offer")));
      return { action: lookup ? "lookup" : "create", lookupKind: lookup ? "room_summary" : "not_applicable" };
    });
    const start = await f.send("tab create a split bill for $1");
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, start.id);
    const before = await f.db.collection("dinner-bill-tasks").find({}).toArray();
    lookup = true;
    const question = await f.send("hey tab how many split bills are pending");
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, question.id);
    assert.deepEqual(await f.db.collection("dinner-bill-tasks").find({}).toArray(), before);
    assert.equal((await agent.roomProposals(f.alice, f.room.id)).length, 0);
  } finally { await f.close(); }
});

test("semantic payer evidence survives restart, stays separate from participants, and cannot be overwritten by tool guesses", async () => {
  const f = await fixture();
  try {
    const { BillTasks } = await import("../../src/lib/dinner/agent/bill-tasks");
    let tasks = new BillTasks(f.db);
    let calls = 0;
    const first = await f.send("@Tab create a dinner bill for USD 60. I covered it.");
    let task = await tasks.open(await f.dinner.memberRoom(f.room.id, f.alice), f.alice, first, null, false, "create", async () => {
      calls++; return { decision: "set", messageId: first.id, quote: "I covered it", reference: "speaker" };
    });
    assert.ok(task); assert.equal(task.fields.payerId, f.alice.id); assert.equal(task.participantIds, null);
    const reply = await f.dinner.botReply(f.room.id, f.alice, first.id, "Who is sharing the bill and should it be split equally?");
    await tasks.recordReply(task, reply, null);
    tasks = new BillTasks(f.db);
    const answer = await f.send("Everyone, equally");
    const unchanged = async () => { calls++; return { decision: "unchanged" as const, messageId: null, quote: null, reference: null }; };
    task = await tasks.open(await f.dinner.memberRoom(f.room.id, f.alice), f.alice, answer, null, false, "continue", unchanged);
    assert.ok(task); assert.equal(task.fields.payerId, f.alice.id); assert.equal(task.payerEvidence?.messageId, first.id);
    const room = await f.dinner.memberRoom(f.room.id, f.alice);
    await tasks.open(room, f.alice, answer, null, false, "continue", unchanged);
    assert.equal(calls, 2, "Retry must reuse saved evidence");
    const prepared = await tasks.prepare(task, { roomId: room.id, totalCents: 99999, payerId: f.bob.id }, room, true);
    assert.equal(prepared.fields.totalCents, 6000); assert.equal(prepared.fields.payerId, f.alice.id);
    assert.deepEqual(prepared.fields.shares?.map(s => s.cents), [3000, 3000]);
    assert.equal(room.expenses.length, 0);
  } finally { await f.close(); }
});

test("saved question order binds a tagged terse answer after restart without model guessing", async () => {
  const f = await fixture();
  try {
    const { BillTasks } = await import("../../src/lib/dinner/agent/bill-tasks");
    let tasks = new BillTasks(f.db);
    const first = await f.send("@Tab create a bill for $1");
    const unchanged = async () => ({ decision: "unchanged" as const, messageId: null, quote: null, reference: null });
    let task = await tasks.open(await f.dinner.memberRoom(f.room.id, f.alice), f.alice, first, null, false, "create", unchanged);
    assert.ok(task);
    const reply = await f.dinner.botReply(f.room.id, f.alice, first.id, "Who paid, who is sharing, and how should it be split?");
    await tasks.recordReply(task, reply, null, ["payer", "participants", "split"]);
    tasks = new BillTasks(f.db);
    const answer = await f.send("@Tab me, everyone, equally");
    task = await tasks.open(await f.dinner.memberRoom(f.room.id, f.alice), f.alice, answer, null, false, "continue", async () => { throw new Error("Structured answer must not require a model guess"); });
    assert.ok(task);
    assert.equal(task.fields.payerId, f.alice.id);
    assert.equal(task.payerEvidence?.messageId, answer.id);
    assert.equal(task.fields.totalCents, 100);
    assert.equal(task.equal, true);
    assert.deepEqual(new Set(task.participantIds), new Set([f.alice.id, f.bob.id]));
  } finally { await f.close(); }
});


test("explicit old question binds its own bill across interleaved tasks and does not replace the answer text", async () => {
  const f = await fixture();
  try {
    const { BillTasks } = await import("../../src/lib/dinner/agent/bill-tasks");
    const tasks = new BillTasks(f.db);
    const first = await f.send("@Tab create a dinner bill for $60");
    const dinner = (await tasks.open(await f.dinner.memberRoom(f.room.id, f.alice), f.alice, first, null, false, "create"))!;
    const oldQuestion = await f.dinner.botReply(f.room.id, f.alice, first.id, "Who paid for dinner?", true);
    await tasks.recordReply(dinner, oldQuestion, null);
    const second = await f.send("@Tab create a taxi bill for $20");
    const taxi = (await tasks.open(await f.dinner.memberRoom(f.room.id, f.alice), f.alice, second, null, false, "create"))!;
    const taxiQuestion = await f.dinner.botReply(f.room.id, f.alice, second.id, "Who paid for the taxi?", true);
    await tasks.recordReply(taxi, taxiQuestion, null);
    for (let i = 0; i < 30; i++) await f.send(`Other chat ${i}`, f.bob);
    const answer = await f.dinner.send(f.room.id, f.alice, { clientId: randomUUID(), text: "I paid. Actually $90", replyTo: oldQuestion.id });
    const updated = (await tasks.open(await f.dinner.memberRoom(f.room.id, f.alice), f.alice, answer, null, false, "continue"))!;
    assert.equal(updated.id, dinner.id);
    assert.equal(updated.fields.totalCents, 9000);
    assert.equal(updated.fields.payerId, f.alice.id);
    const newerQuestion = await f.dinner.botReply(f.room.id, f.alice, answer.id, "Who is sharing dinner?", true);
    await tasks.recordReply(updated, newerQuestion, null);
    const oldAgain = await f.dinner.send(f.room.id, f.alice, { clientId: randomUUID(), text: "Actually $100", replyTo: oldQuestion.id });
    const again = (await tasks.open(await f.dinner.memberRoom(f.room.id, f.alice), f.alice, oldAgain, null, false, "continue"))!;
    assert.equal(again.id, dinner.id);
    assert.equal(again.fields.totalCents, 10000);
    assert.equal((await f.db.collection("dinner-bill-tasks").findOne({ id: taxi.id }))!.fields.totalCents, 2000);
    const fresh = await f.dinner.send(f.room.id, f.alice, { clientId: randomUUID(), text: "Create another bill for $30", replyTo: oldQuestion.id });
    const separate = (await tasks.open(await f.dinner.memberRoom(f.room.id, f.alice), f.alice, fresh, null, false, "create"))!;
    assert.notEqual(separate.id, dinner.id);
    assert.equal(separate.fields.totalCents, 3000);
    assert.equal(separate.fields.payerId, undefined);
  } finally { await f.close(); }
});
