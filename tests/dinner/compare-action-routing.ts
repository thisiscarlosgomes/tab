import { classifyAction } from "../../src/lib/dinner/agent/action-routing";
/** Isolated matched routing experiment. Never calls V1 payment endpoints. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import sharp from "sharp";
import { DinnerService } from "../../src/lib/dinner/service";
import { MongoRoomStore } from "../../src/lib/dinner/mongo-store";
import { DinnerAgentService } from "../../src/lib/dinner/agent/service";
import { Attachments } from "../../src/lib/dinner/attachments";
import { runTabAgent } from "../../src/lib/dinner/agent/runtime";
import type { AgentRunner } from "../../src/lib/dinner/agent/capabilities";

const cases = [
  { name: "exact-screenshot", messages: ["ok @tab can you create a split bill for $1"], total: null, receipt: false },
  { name: "complete-split-bill", messages: ["@Tab create a split bill for $1. I paid. Split evenly between everyone in this group."], total: 100, receipt: false },
  { name: "new-bill-control", messages: ["@Tab create a new bill for $1. I paid. Split evenly between everyone."], total: 100, receipt: false },
  { name: "paraphrase", messages: ["@Tab put together a $1 dinner split for everyone here, equally. I paid."], total: 100, receipt: false },
  { name: "clarification", messages: ["ok @tab can you create a split bill for $1", "@Tab I paid. Everyone in this group, split evenly."], total: 100, receipt: false },
  { name: "receipt-reference", messages: ["@Tab the $100 John Doe receipt: I paid. Everyone in this group, split evenly."], total: 10000, receipt: true },
  { name: "general-question", messages: ["@Tab how do split bills work?"], total: null, receipt: false },
  { name: "latest-bill", messages: ["@Tab I want to pay my last bill"], total: null, receipt: false, allowOld: true },
];
async function main() {
  assert.ok(process.env.OPENAI_API_KEY, "Requires local model credentials");
  const directory = `/tmp/tab-routing-comparison-${Date.now()}`;
  await mkdir(directory, { recursive: true });
  console.log(`Evidence: ${directory}`);
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  const results: Array<Record<string, unknown>> = [];
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  try {
    for (let round = 1; round <= 2; round++) for (const [index, scenario] of cases.entries()) {
      for (const approach of ["production-action-first"]) {
        const db = client.db(`comparison_${round}_${index}_${approach}`);
        const dinner = new DinnerService(new MongoRoomStore(db));
        const actor = { id: "11111111-1111-4111-8111-111111111111", name: "Carlos", twitterSubject: null };
        const other = { id: "22222222-2222-4222-8222-222222222222", name: "tab", twitterSubject: null };
        const room = await dinner.create(actor, { clientId: randomUUID(), name: "Isolated comparison", purpose: "Routing test" });
        await dinner.setAssistance(room.id, actor, "mentions");
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
        const trace: unknown[] = [];
        const replies: string[] = [];
        const started = performance.now();
        let routingMs = 0;
        const runner: AgentRunner = async context => {
          return runTabAgent({ ...context,
            prepareExpense: async input => { const result = await context.prepareExpense(input); trace.push({ tool: "prepare_expense", input, result }); return result; },
          });
        };
        const agent = new DinnerAgentService(db, dinner, runner, undefined, undefined, async input => { const start = performance.now(); const decision = await classifyAction(input); routingMs += performance.now() - start; trace.push({ route: decision.action }); return decision; });
        let failure: string | null = null;
        try {
          for (const text of scenario.messages) {
            const message = await dinner.send(room.id, actor, { clientId: randomUUID(), text });
            const result = await agent.respond(actor, { kind: "room", roomId: room.id }, message.id);
            replies.push(result.text);
            if (!scenario.receipt && !scenario.allowOld) assert.doesNotMatch(result.text, /John Doe|Lorem Ipsum|no receipt draft|which receipt draft|unfinished receipts/i);
          }
          if (approach === "production-action-first") {
            const expected = scenario.receipt ? "receipt" : scenario.name === "latest-bill" ? "settle" : scenario.name === "general-question" ? "general" : "create";
            for (const step of trace) {
              if (step && typeof step === "object" && "route" in step) if (step.route !== "current") assert.ok(step.route === expected || (expected === "create" && step.route === "continue"), "action classification");
            }
          }
          const proposals = await agent.roomProposals(actor, room.id);
          assert.equal(proposals.length, scenario.total === null ? 0 : 1, "proposal count");
          if (scenario.total !== null) {
            assert.equal(proposals[0].fields.totalCents, scenario.total, "amount");
            assert.equal(proposals[0].fields.payerId, actor.id, "payer");
            assert.deepEqual(proposals[0].fields.shares.map(s => s.cents).sort(), [scenario.total / 2, scenario.total / 2], "shares");
            assert.equal(proposals[0].fields.attachmentId ?? null, scenario.receipt ? targetReceipt : null, "receipt association");
          }
          assert.equal((await dinner.memberRoom(room.id, actor)).expenses.length, 0, "must not confirm or pay");
          const tasks = await db.collection("dinner-pending-expenses").find({}).toArray();
          for (const task of tasks.filter(t => !scenario.receipt || t.attachmentId !== targetReceipt)) {
            assert.equal(task.payerId, null, "unrelated receipt payer changed");
            assert.equal(task.participantIds, null, "unrelated receipt participants changed");
            assert.equal(task.status, "collecting", "unrelated receipt status changed");
          }
        } catch (error) { failure = error instanceof Error ? error.message : String(error); }
        const result = { round, scenario: scenario.name, approach, pass: !failure, failure, milliseconds: Math.round(performance.now() - started), routingMs: Math.round(routingMs), replies, trace };
        results.push(result);
        await writeFile(`${directory}/results.json`, JSON.stringify({ model: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini", results }, null, 2));
        console.log(`${result.pass ? "PASS" : "FAIL"} ${approach} ${scenario.name} round ${round} (${result.milliseconds}ms)`);
        await db.dropDatabase();
      }
    }
    for (const approach of ["production-action-first"]) {
      const rows = results.filter(r => r.approach === approach);
      console.log(`${approach}: ${rows.filter(r => r.pass).length}/${rows.length}`);
      if (rows.some(r => !r.pass)) process.exitCode = 1;
    }
  } finally { await client.close(); await mongo.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
