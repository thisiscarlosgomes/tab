import { extractPayer } from "../../../src/lib/dinner/agent/payer-extraction";
import { observeModelCalls } from "./model-telemetry";
import { classifyAction } from "../../../src/lib/dinner/agent/action-routing";
/** Isolated matched routing experiment. Never calls V1 payment endpoints. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import sharp from "sharp";
import { DinnerService } from "../../../src/lib/dinner/service";
import { MongoRoomStore } from "../../../src/lib/dinner/mongo-store";
import { DinnerAgentService } from "../../../src/lib/dinner/agent/service";
import { Attachments } from "../../../src/lib/dinner/attachments";
import { runTabAgent } from "../../../src/lib/dinner/agent/runtime";
import type { AgentRunner } from "../../../src/lib/dinner/agent/capabilities";

const models = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-5.4-nano", "gpt-5.4-mini"];
const regressionCases = [
  { name: "exact-screenshot", messages: ["ok @tab can you create a split bill for $1"], total: null, receipt: false },
  { name: "complete-split-bill", messages: ["@Tab create a split bill for $1. I paid. Split evenly between everyone in this group."], total: 100, receipt: false },
  { name: "new-bill-control", messages: ["@Tab create a new bill for $1. I paid. Split evenly between everyone."], total: 100, receipt: false },
  { name: "paraphrase", messages: ["@Tab put together a $1 dinner split for everyone here, equally. I paid."], total: 100, receipt: false },
  { name: "clarification", messages: ["ok @tab can you create a split bill for $1", "@Tab I paid. Everyone in this group, split evenly."], total: 100, receipt: false },
  { name: "multi-task-followup", messages: ["@Tab create a bill for $20", "@Tab create a split bill for $1", "@Tab I paid. Everyone in this group, split evenly."], total: 100, receipt: false },
  { name: "receipt-reference", messages: ["@Tab the $100 John Doe receipt: I paid. Everyone in this group, split evenly."], total: 10000, receipt: true },
  { name: "general-question", messages: ["@Tab how do split bills work?"], total: null, receipt: false },
  { name: "latest-bill", messages: ["@Tab I want to pay my last bill"], total: null, receipt: false, allowOld: true },
  { name: "smart-status", messages: ["@Tab create a split bill for $1", "hey tab how many split bills are pending"], total: null, receipt: false },
  { name: "deleted-bills", messages: ["@Tab what bills are pending"], total: null, receipt: false },
  { name: "context-25", messages: ["@Tab which restaurant did Carlos suggest?"], total: null, receipt: false },
  { name: "smart-offer", messages: [], total: null, receipt: false },
  { name: "untagged-silent", messages: [], total: null, receipt: false },
];
const heldoutCases = [
  { name: "natural-payer", messages: ["@Tab create a new dinner split for USD 27.90. I covered the bill. Divide it equally between everyone in this room."], total: 2790, receipt: false, allowOld: false },
  { name: "terse-followup", messages: ["@Tab create a split bill for $1", "@Tab me, everyone, equally"], total: 100, receipt: false, allowOld: false },
];
const cases = process.env.TAB_BENCH_HELDOUT ? heldoutCases : regressionCases;
async function main() {
  assert.ok(process.env.OPENAI_API_KEY, "Requires local model credentials");
  const directory = process.env.TAB_BENCH_DIR ?? `/tmp/tab-model-benchmark-${Date.now()}`;
  const telemetry = observeModelCalls();
  await mkdir(directory, { recursive: true });
  console.log(`Evidence: ${directory}`);
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  const results: Array<Record<string, unknown>> = [];
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  try {
    for (let round = 1; round <= Number(process.env.TAB_BENCH_ROUNDS ?? 2); round++) for (const [index, scenario] of cases.entries()) {
      const order = [...models.slice((round + index) % models.length), ...models.slice(0, (round + index) % models.length)];
      for (const approach of order.filter(m => !process.env.TAB_BENCH_MODEL || m === process.env.TAB_BENCH_MODEL)) {
        process.env.OPENAI_CHAT_MODEL = approach;
        const db = client.db(`comparison_${round}_${index}_${approach.replaceAll(".", "_")}`);
        const dinner = new DinnerService(new MongoRoomStore(db));
        const actor = { id: "11111111-1111-4111-8111-111111111111", name: "Carlos", twitterSubject: null };
        const other = { id: "22222222-2222-4222-8222-222222222222", name: "tab", twitterSubject: null };
        const room = await dinner.create(actor, { clientId: randomUUID(), name: "Isolated comparison", purpose: "Routing test" });
        await dinner.setAssistance(room.id, actor, scenario.name.startsWith("smart") ? "smart" : "mentions");
        const invitation = await dinner.invite(room.id, actor, { clientId: randomUUID() });
        await dinner.respond(other, { token: invitation.token }, "accepted");
        let targetReceipt = "";
        for (const [description, totalCents] of [["John Doe", 10000], ["Lorem Ipsum", 8480]] as const) {
          const attachment = await new Attachments(db, dinner).upload(room.id, actor, new Request(`http://test?clientId=${randomUUID()}`, { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(image) }));
          if (description === "John Doe") targetReceipt = attachment.id;
          const source = await dinner.send(room.id, actor, { clientId: randomUUID(), text: `@Tab split the ${description} receipt`, attachmentIds: [attachment.id] });
          await db.collection<{ _id: string; [key: string]: unknown }>("dinner-pending-expenses").insertOne({ _id: `${room.id}:${actor.id}:${attachment.id}`, taskId: randomUUID(), roomId: room.id, userId: actor.id, attachmentId: attachment.id, startedSeq: source.seq, lastSeq: source.seq, version: 0, status: "collecting", description, totalCents, payerId: null, participantIds: null, equal: false, proposalKey: null });
          await db.collection<{ _id: string; [key: string]: unknown }>("dinner-receipt-extractions").insertOne({ _id: `${room.id}:${attachment.id}`, fields: { merchant: description, totalAmount: totalCents / 100, currency: "USD", confidence: 1, items: [] } });
          await dinner.botReply(room.id, actor, source.id, `Who paid for the ${description} receipt?`);
        }
        await dinner.send(room.id, other, { clientId: randomUUID(), text: "Let's talk about something else." });
        if (scenario.name === "deleted-bills") {
          for (const totalCents of [100, 12000, 120]) {
            const draft = await dinner.draft(room.id, actor, { clientId: randomUUID(), description: `Deleted ${totalCents}`, totalCents, payerId: actor.id, shares: [{ userId: actor.id, cents: totalCents / 2 }, { userId: other.id, cents: totalCents / 2 }] });
            const confirmed = await dinner.confirm(room.id, actor, draft.id, randomUUID(), draft.version);
            await dinner.deleteSplit(room.id, actor, confirmed.id, randomUUID(), confirmed.version);
          }
          const old = await dinner.send(room.id, actor, { clientId: randomUUID(), text: "@Tab previous balances?" });
          await dinner.botReply(room.id, actor, old.id, "There are three outstanding obligations: tab owes Carlos $0.50, $60.00 and $0.60. Anything else?");
        }
        if (scenario.name === "context-25") {
          await dinner.send(room.id, actor, { clientId: randomUUID(), text: "My restaurant suggestion is Harbor Kitchen." });
          for (let i = 0; i < 23; i++) await dinner.send(room.id, other, { clientId: randomUUID(), text: `Unrelated conversation message ${i + 1}.` });
        }
        const beforeExpenses = (await dinner.memberRoom(room.id, actor)).expenses;
        const trace: unknown[] = [];
        const replies: string[] = [];
        const callStart = telemetry.calls.length;
        const turnTimings: number[] = [];
        const started = performance.now();
        let routingMs = 0;
        const runner: AgentRunner = async context => {
          return runTabAgent({ ...context,
            prepareExpense: async input => { const result = await context.prepareExpense(input); trace.push({ tool: "prepare_expense", input, result }); return result; },
          });
        };
        const agent = new DinnerAgentService(db, dinner, runner, undefined, undefined, async input => { const start = performance.now(); const decision = await classifyAction(input); routingMs += performance.now() - start; trace.push({ route: decision.action, lookupKind: decision.lookupKind }); return decision; }, async input => { const candidate = await extractPayer(input); trace.push({ payerInput: input, payerCandidate: candidate }); return candidate; });
        let failure: string | null = null;
        try {
          if (scenario.name === "smart-offer") {
            await dinner.send(room.id, actor, { clientId: randomUUID(), text: "We should split dinner, USD 60. I paid." });
            const agree = await dinner.send(room.id, other, { clientId: randomUUID(), text: "Yes, let's do it" });
            const assessed = await agent.assessRoomMessage(other, room.id, agree.id);
            trace.push({ awareness: assessed });
            assert.equal(assessed.action, "offered");
          }
          if (scenario.name === "untagged-silent") {
            const casual = await dinner.send(room.id, actor, { clientId: randomUUID(), text: "Dinner was fun yesterday." });
            const assessed = await agent.assessRoomMessage(actor, room.id, casual.id);
            assert.equal(assessed.action, "silent");
            assert.equal(telemetry.calls.length, callStart);
          }
          for (const text of scenario.messages) {
            const message = await dinner.send(room.id, actor, { clientId: randomUUID(), text });
            const turnStarted = performance.now();
            const result = await agent.respond(actor, { kind: "room", roomId: room.id }, message.id);
            turnTimings.push(Math.round(performance.now() - turnStarted));
            replies.push(result.text);
            if (!scenario.receipt && !scenario.allowOld) assert.doesNotMatch(result.text, /John Doe|Lorem Ipsum|no receipt draft|which receipt draft|unfinished receipts/i);
          }
          if (!["smart-status", "context-25", "smart-offer", "untagged-silent", "deleted-bills"].includes(scenario.name)) {
            const expected = scenario.receipt ? "receipt" : scenario.name === "latest-bill" ? "settle" : scenario.name === "general-question" ? "general" : "create";
            for (const step of trace) {
              if (step && typeof step === "object" && "route" in step) if (step.route !== "current") assert.ok(step.route === expected || (expected === "create" && step.route === "continue"), "action classification");
            }
          }
          if (scenario.name === "deleted-bills" || scenario.name === "smart-status") {
            assert.match(replies.at(-1)!, /0 bills awaiting payment/);
            assert.match(replies.at(-1)!, /\$0\.00/);
            assert.doesNotMatch(replies.at(-1)!, /\$60\.00|\$0\.50|\$0\.60|who paid|to create/i);
            assert.equal((trace.filter(t => t && typeof t === "object" && "route" in t).at(-1) as { route: string }).route, "lookup");
          }
          if (scenario.name === "context-25") assert.match(replies.at(-1)!, /Harbor Kitchen/i);
          const proposals = await agent.roomProposals(actor, room.id);
          assert.equal(proposals.length, scenario.total === null ? 0 : 1, "proposal count");
          if (scenario.total !== null) {
            assert.equal(proposals[0].fields.totalCents, scenario.total, "amount");
            assert.equal(proposals[0].fields.payerId, actor.id, "payer");
            assert.deepEqual(proposals[0].fields.shares.map(s => s.cents).sort(), [scenario.total / 2, scenario.total / 2], "shares");
            assert.equal(proposals[0].fields.attachmentId ?? null, scenario.receipt ? targetReceipt : null, "receipt association");
          }
          assert.deepEqual((await dinner.memberRoom(room.id, actor)).expenses, beforeExpenses, "must not confirm, alter or pay");
          const tasks = await db.collection("dinner-pending-expenses").find({}).toArray();
          for (const task of tasks.filter(t => !scenario.receipt || t.attachmentId !== targetReceipt)) {
            assert.equal(task.payerId, null, "unrelated receipt payer changed");
            assert.equal(task.participantIds, null, "unrelated receipt participants changed");
            assert.equal(task.status, "collecting", "unrelated receipt status changed");
          }
        } catch (error) { failure = error instanceof Error ? error.message : String(error); }
        await telemetry.flush();
        const apiCalls = telemetry.calls.slice(callStart);
        const result = { apiCalls, turnTimings, round, scenario: scenario.name, approach, pass: !failure, failure, milliseconds: Math.round(performance.now() - started), routingMs: Math.round(routingMs), replies, trace };
        results.push(result);
        await writeFile(`${directory}/results.json`, JSON.stringify({ models, configuredBaseline: "gpt-4o-mini", results }, null, 2));
        console.log(`${result.pass ? "PASS" : "FAIL"} ${approach} ${scenario.name} round ${round} (${result.milliseconds}ms)`);
        await db.dropDatabase();
      }
    }
    for (const approach of models) {
      const rows = results.filter(r => r.approach === approach);
      console.log(`${approach}: ${rows.filter(r => r.pass).length}/${rows.length}`);
      // Failures are benchmark outcomes; preserve all candidates and scenarios.
    }
  } finally { telemetry.close(); await client.close(); await mongo.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
