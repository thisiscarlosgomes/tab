import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { DinnerService } from "../../src/lib/dinner/service";
import { MongoRoomStore } from "../../src/lib/dinner/mongo-store";
import { DinnerAgentService } from "../../src/lib/dinner/agent/service";
import { registerBurst, type BurstClassifier } from "../../src/lib/dinner/agent/bursts";
import { type AgentRunner } from "../../src/lib/dinner/agent/capabilities";
import { type PayerExtractor } from "../../src/lib/dinner/agent/payer-extraction";
const runTabAgent: AgentRunner = async context => {
  if (!context.readyBill) return `Missing: ${context.missingBillDetails?.join(", ")}`;
  const result = await context.prepareExpense(context.readyBill);
  assert.ok(!("kind" in result));
  return `Review $${(result.fields.totalCents / 100).toFixed(2)}`;
};
import { AgentJobs, type JobDelivery } from "../../src/lib/dinner/agent/jobs";

async function fixture() {
  const mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
  const client = await MongoClient.connect(mongo.getUri());
  const db = client.db("burst-tests");
  const dinner = new DinnerService(new MongoRoomStore(db));
  const alice = { id: randomUUID(), name: "Alice", twitterSubject: null };
  const bob = { id: randomUUID(), name: "Bob", twitterSubject: null };
  const room = await dinner.create(alice, { clientId: randomUUID(), name: "Dinner", purpose: "Test" });
  const invite = await dinner.invite(room.id, alice, { clientId: randomUUID() });
  await dinner.respond(bob, { token: invite.token }, "accepted");
  await dinner.setAssistance(room.id, alice, "mentions");
  const send = async (text: string, actor = alice) => {
    const m = await dinner.send(room.id, actor, { clientId: randomUUID(), text });
    await registerBurst(db, room.id, actor.id, m.id);
    return m;
  };
  const payer: PayerExtractor = async input => {
    const m = [...input.messages].reverse().find(m => m.text.includes("I paid"));
    return m ? { decision: "set", messageId: m.id, quote: "I paid", reference: "speaker" } : { decision: "unchanged", messageId: null, quote: null, reference: null };
  };
  const classifier: BurstClassifier = async ({ candidates }) => ({ relatedIds: candidates.filter(m => !m.text.includes("weather") && !m.text.includes("another bill")).map(m => m.id) });
  const agent = (runner: AgentRunner = runTabAgent, classify = classifier) => new DinnerAgentService(db, dinner, runner, undefined, undefined, async ({ current }) => ({ action: current.includes("weather") ? "general" : "create" }), payer, classify, 0);
  return { db, dinner, alice, bob, room, send, agent, close: async () => { await client.close(); await mongo.stop(); } };
}

test("a burst creates one corrected proposal, ignores other members, and retries after restart deduplicate", async () => {
  const f = await fixture();
  try {
    const root = await f.send("@Tab create a dinner bill for $60, split equally");
    await f.send("I paid $800", f.bob);
    await f.send("Actually $90");
    const last = await f.send("Just me and Bob, I paid");
    const agent = f.agent();
    assert.equal((await agent.assessRoomMessage(f.alice, f.room.id, last.id)).action, "respond");
    assert.equal((await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, last.id)).status, "coalesced");
    const proposals = await agent.roomProposals(f.alice, f.room.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].fields.totalCents, 9000);
    assert.equal(proposals[0].fields.payerId, f.alice.id);
    assert.deepEqual(proposals[0].fields.shares.map(s => s.cents), [4500, 4500]);
    await f.agent().respond(f.alice, { kind: "room", roomId: f.room.id }, last.id);
    const room = await f.dinner.memberRoom(f.room.id, f.alice);
    assert.equal(room.messages.filter(m => m.kind === "tab").length, 1);
    assert.equal(room.expenses.length, 0);
    assert.equal((await agent.roomProposals(f.alice, f.room.id)).length, 1);
  } finally { await f.close(); }
});

test("correction arriving after proposal preparation hides stale output and rebuilds before publication", async () => {
  const f = await fixture();
  try {
    let injected = false;
    const agent = f.agent(async context => {
      const reply = await runTabAgent(context);
      if (!injected) {
        injected = true;
        assert.equal((await agent.roomProposals(f.alice, f.room.id)).length, 0);
        const hidden = await f.db.collection("dinner-agent-proposals").findOne({});
        assert.ok(hidden);
        await assert.rejects(agent.applyProposal(f.alice, hidden.id), /superseded|prepared/);
        await f.send("Actually $90");
      }
      return reply;
    });
    const root = await f.send("@Tab create a dinner bill for $60. I paid. Everyone, equally.");
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, root.id);
    const proposals = await agent.roomProposals(f.alice, f.room.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].fields.totalCents, 9000);
    const room = await f.dinner.memberRoom(f.room.id, f.alice);
    assert.equal(room.messages.filter(m => m.kind === "tab").length, 1);
    assert.match(room.messages.at(-1)!.text, /90/);
    assert.doesNotMatch(room.messages.at(-1)!.text, /60/);
    assert.equal(room.expenses.length, 0);
  } finally { await f.close(); }
});

test("unrelated addressed questions remain separate and preserve 25-message context", async () => {
  const f = await fixture();
  try {
    for (let n = 0; n < 26; n++) await f.send(`filler ${n}`, f.bob);
    const root = await f.send("@Tab create a dinner bill for $60. I paid. Everyone, equally.");
    const separate = await f.send("@Tab what is the weather?");
    let weather = 0;
    const agent = f.agent(async context => {
      if (context.action === "general") { weather++; assert.equal(context.historyCoverage?.visibleMessages, 25); return "I cannot verify the weather."; }
      return runTabAgent(context);
    });
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, root.id);
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, separate.id);
    assert.equal(weather, 1);
    assert.equal((await agent.roomProposals(f.alice, f.room.id)).length, 1);
    const room = await f.dinner.memberRoom(f.room.id, f.alice);
    assert.equal(room.messages.filter(m => m.kind === "tab").length, 2);
  } finally { await f.close(); }
});

test("durable queue handles an untagged burst in mentions-only mode without duplicate replies", async () => {
  const f = await fixture();
  try {
    const root = await f.send("@Tab create a dinner bill for $60. Everyone, equally.");
    const last = await f.send("Actually $90. I paid");
    const agent = f.agent();
    const jobs = new AgentJobs(f.db, f.dinner, agent);
    const deliveries: JobDelivery[] = [];
    await jobs.enqueue(f.alice, f.room.id, root, async d => { deliveries.push(d); });
    await jobs.enqueue(f.alice, f.room.id, last, async d => { deliveries.push(d); });
    await jobs.process(deliveries[1]);
    await jobs.process(deliveries[0]);
    await jobs.process(deliveries[1]);
    assert.equal((await agent.roomProposals(f.alice, f.room.id)).length, 1);
    const room = await f.dinner.memberRoom(f.room.id, f.alice);
    assert.equal(room.messages.filter(m => m.kind === "tab").length, 1);
  } finally { await f.close(); }
});

test("a correction during receipt extraction is included, OCR is cached, and no old reply is published", async () => {
  const f = await fixture();
  try {
    const { default: sharp } = await import("sharp");
    const { Attachments } = await import("../../src/lib/dinner/attachments");
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
    const image = await new Attachments(f.db, f.dinner).upload(f.room.id, f.alice, new Request(`http://test?clientId=${randomUUID()}`, { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(bytes) }));
    let parsed = 0;
    const agent = new DinnerAgentService(f.db, f.dinner, async context => {
      const pending = await context.pendingExpense?.();
      assert.ok(pending);
      const result = await pending.update({ payer: "me", participants: ["everyone"], totalUsd: "90", splitEqually: true });
      return result.reply;
    }, async () => {
      parsed++;
      await f.send("Actually the total is $90. I paid. Everyone, equally.");
      return { merchant: "Dinner", totalAmount: 60, currency: "USD", confidence: 1, items: [] };
    }, undefined, async () => ({ action: "receipt" }), undefined, async ({ candidates }) => ({ relatedIds: candidates.map(m => m.id) }), 0);
    const root = await f.dinner.send(f.room.id, f.alice, { clientId: randomUUID(), text: "@Tab split this receipt", attachmentIds: [image.id] });
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, root.id);
    assert.equal(parsed, 1);
    const proposals = await agent.roomProposals(f.alice, f.room.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].fields.totalCents, 9000, JSON.stringify(await f.db.collection("dinner-pending-expenses").find({}).toArray()));
    assert.equal(proposals[0].fields.attachmentId, image.id);
    const room = await f.dinner.memberRoom(f.room.id, f.alice);
    assert.equal(room.messages.filter(m => m.kind === "tab").length, 1);
    assert.equal(room.expenses.length, 0);
  } finally { await f.close(); }
});

test("concurrent workers cannot publish twice; a crashed runner can recover its prepared draft", async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    let entered!: () => void;
    const arrived = new Promise<void>(r => { entered = r; });
    const gate = new Promise<void>(r => { release = r; });
    const agent = f.agent(async context => {
      await runTabAgent(context);
      entered();
      await gate;
      throw new Error("simulated worker failure");
    });
    const root = await f.send("@Tab create a bill for $60. I paid. Everyone, equally.");
    const first = agent.respond(f.alice, { kind: "room", roomId: f.room.id }, root.id);
    const rejected = assert.rejects(first, /could not finish/);
    await arrived;
    assert.equal((await f.agent().respond(f.alice, { kind: "room", roomId: f.room.id }, root.id)).status, "running");
    assert.equal((await agent.roomProposals(f.alice, f.room.id)).length, 0);
    release(); await rejected;
    await f.agent().respond(f.alice, { kind: "room", roomId: f.room.id }, root.id);
    assert.equal((await agent.roomProposals(f.alice, f.room.id)).length, 1);
    assert.equal((await f.dinner.memberRoom(f.room.id, f.alice)).messages.filter(m => m.kind === "tab").length, 1);
  } finally { await f.close(); }
});

test("the atomic reply write rejects a correction arriving after the last async check", async () => {
  const f = await fixture();
  try {
    const save = f.dinner.botReply.bind(f.dinner);
    let injected = false;
    f.dinner.botReply = async (...args) => {
      if (!injected) { injected = true; await f.send("Actually $90"); }
      return save(...args);
    };
    const root = await f.send("@Tab create a bill for $60. I paid. Everyone, equally.");
    const agent = f.agent();
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, root.id);
    const proposals = await agent.roomProposals(f.alice, f.room.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].fields.totalCents, 9000);
    assert.equal((await f.dinner.memberRoom(f.room.id, f.alice)).messages.filter(m => m.kind === "tab").length, 1);
  } finally { await f.close(); }
});

test("a late cancellation withdraws unpublished work without creating a bill", async () => {
  const f = await fixture();
  try {
    let injected = false;
    const agent = f.agent(async context => {
      const text = await runTabAgent(context);
      if (!injected) { injected = true; await f.send("Cancel that"); }
      return text;
    });
    const root = await f.send("@Tab create a bill for $60. I paid. Everyone, equally.");
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, root.id);
    assert.equal((await agent.roomProposals(f.alice, f.room.id)).length, 0);
    const room = await f.dinner.memberRoom(f.room.id, f.alice);
    assert.equal(room.expenses.length, 0);
    assert.equal(room.messages.at(-1)!.text, "Cancelled this draft.");
  } finally { await f.close(); }
});

test("the model cannot group another author, a foreign reply target, or invented message IDs", async () => {
  const f = await fixture();
  try {
    const root = await f.send("@Tab create a bill for $60. I paid. Everyone, equally.");
    const other = await f.send("Actually $900", f.bob);
    const foreignReply = await f.dinner.send(f.room.id, f.alice, { clientId: randomUUID(), text: "Actually $800", replyTo: other.id });
    const own = await f.send("Actually $90");
    const agent = f.agent(undefined, async () => ({ relatedIds: [other.id, foreignReply.id, own.id, "invented"] }));
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, root.id);
    const proposals = await agent.roomProposals(f.alice, f.room.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].fields.totalCents, 9000);
    const task = await f.db.collection("dinner-bill-tasks").findOne({});
    assert.deepEqual(task!.evidence.map((m: { id: string }) => m.id), [root.id, own.id]);
  } finally { await f.close(); }
});

test("the current assistant question wins over older unfinished receipt requests", async () => {
  const f = await fixture();
  try {
    const { Bursts } = await import("../../src/lib/dinner/agent/bursts");
    await f.send("@Tab split this old receipt");
    const current = await f.send("@Tab create a new bill for $1.20");
    await f.dinner.botReply(f.room.id, f.alice, current.id, "Who paid, who is sharing, and how should it be split?");
    const answer = await f.send("me, everyone, equally");
    const bursts = new Bursts(f.db, f.dinner, async () => { throw new Error("Do not classify an old receipt against a direct answer"); }, 0);
    assert.equal((await bursts.rootFor(await f.dinner.memberRoom(f.room.id, f.alice), answer)).id, answer.id);
    await f.send("Unrelated comment", f.bob);
    const later = await f.send("@Tab everyone");
    // A different explicit target cannot be attached to a request before the newer assistant question.
    const room = await f.dinner.memberRoom(f.room.id, f.alice);
    const safe = new Bursts(f.db, f.dinner, async ({ root, candidates }) => {
      assert.notEqual(root.text, "@Tab split this old receipt");
      return { relatedIds: candidates.map(m => m.id) };
    }, 0);
    await safe.rootFor(room, later);
  } finally { await f.close(); }
});

test("historical mentions without scheduled work cannot capture an ordinary new request", async () => {
  const f = await fixture();
  try {
    const { Bursts } = await import("../../src/lib/dinner/agent/bursts");
    await f.dinner.send(f.room.id, f.alice, { clientId: randomUUID(), text: "@Tab split this receipt" });
    const source = await f.dinner.send(f.room.id, f.alice, { clientId: randomUUID(), text: "Can you create a bill for $1.20?" });
    const bursts = new Bursts(f.db, f.dinner, async () => { throw new Error("An unscheduled historical mention is not an active root"); }, 0);
    assert.equal((await bursts.rootFor(await f.dinner.memberRoom(f.room.id, f.alice), source)).id, source.id);
  } finally { await f.close(); }
});

test("a caret reference preserves the referenced manual bill evidence with burst coordination enabled", async () => {
  const f = await fixture();
  try {
    const details = await f.send("Can you create a bill for $1.20? I paid. Everyone, equally.");
    const root = await f.send("@Tab ^");
    const agent = f.agent();
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, root.id);
    const proposals = await agent.roomProposals(f.alice, f.room.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].fields.totalCents, 120);
    assert.equal(proposals[0].fields.payerId, f.alice.id);
    const task = await f.db.collection("dinner-bill-tasks").findOne({});
    assert.ok(task!.evidence.some((m: { id: string }) => m.id === details.id));
  } finally { await f.close(); }
});

test("a caret pointing to an untagged answer continues its question's task even if routing says create", async () => {
  const f = await fixture();
  try {
    const agent = f.agent();
    const root = await f.send("@Tab create a new bill");
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, root.id);
    const details = await f.dinner.send(f.room.id, f.alice, { clientId: randomUUID(), text: "Everyone in this group. $1 split evenly" });
    const caret = await f.send("@Tab ^");
    await agent.respond(f.alice, { kind: "room", roomId: f.room.id }, caret.id);
    const tasks = await f.db.collection("dinner-bill-tasks").find({}).toArray();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].fields.totalCents, 100);
    assert.deepEqual(new Set(tasks[0].participantIds), new Set([f.alice.id, f.bob.id]));
    assert.ok(tasks[0].evidence.some((m: { id: string }) => m.id === details.id));
    assert.equal(tasks[0].questionFields.length, 1);
    assert.equal(tasks[0].questionFields[0], "payer");
  } finally { await f.close(); }
});
