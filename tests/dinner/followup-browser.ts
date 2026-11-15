import { classifyBurst } from "../../src/lib/dinner/agent/bursts";
import { classifyAction } from "../../src/lib/dinner/agent/action-routing";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";
import { startHarness } from "./browser/harness";
import { runTabAgent } from "../../src/lib/dinner/agent/runtime";
import { Attachments } from "../../src/lib/dinner/attachments";

async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 90000;
  while (!(await check())) { if (Date.now() > end) throw new Error("Timed out waiting for persisted reply"); await delay(100); }
}
async function main() {
const artifacts = "/tmp/tab-followup-e2e";
await mkdir(artifacts, { recursive: true });
for (const scenario of ["covered", "terse", "terse-tagged", "greeting", "caret", "everyone", "everyone-tab", "explicit-reply", "legacy-question", "new-tab", "new-tab-caret"] as const) {
  if (process.env.TAB_TEST_SCENARIO && scenario !== process.env.TAB_TEST_SCENARIO) continue;
  const transcript: unknown[] = [];
  const harness = await startHarness(async context => {
    const reply = await runTabAgent({ ...context, prepareExpense: async input => {
      const result = await context.prepareExpense(input);
      transcript.push({ prepare: input, result });
      return result;
    } });
    transcript.push({ request: context.request?.text, reply });
    return reply;
  }, undefined, undefined, true, classifyAction, classifyBurst);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await harness.dinner.setAssistance(harness.room.id, harness.alice, scenario === "greeting" ? "mentions" : "smart");
    await harness.dinner.change(harness.room.id, harness.alice, room => {
      room.members.find(member => member.userId === harness.bob.id)!.name = "tab";
    });
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
    for (const [description, totalCents] of [["John Doe", 10000], ["Lorem Ipsum", 8480]] as const) {
      const attachment = await new Attachments(harness.db, harness.dinner).upload(harness.room.id, harness.alice,
        new Request(`http://test?clientId=${randomUUID()}`, { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(bytes) }));
      const message = await harness.dinner.send(harness.room.id, harness.alice, { clientId: randomUUID(), text: "@Tab split this receipt", attachmentIds: [attachment.id] });
      await harness.db.collection<{ _id: string; [key: string]: unknown }>("dinner-pending-expenses").insertOne({ _id: randomUUID(), taskId: randomUUID(), roomId: harness.room.id, userId: harness.alice.id, attachmentId: attachment.id, startedSeq: message.seq, lastSeq: message.seq, version: 0, status: "collecting", description, totalCents, payerId: null, participantIds: null, equal: false, proposalKey: null });
    }
    const before = await harness.db.collection("dinner-pending-expenses").find({}).toArray();
    const snapshot = () => harness.dinner.memberRoom(harness.room.id, harness.alice);
    const initialExpenses = (await snapshot()).expenses;
    await page.goto(harness.url + `/app/rooms/${harness.room.id}`);
    await page.getByRole("textbox", { name: "Message the room" }).waitFor();
    async function send(text: string, expectReply = true) {
      await page.getByRole("textbox", { name: "Message the room" }).fill(text);
      await page.getByRole("textbox", { name: "Message the room" }).press("Enter");
      await until(async () => (await snapshot()).messages.some(m => m.text === text));
      const source = (await snapshot()).messages.findLast(m => m.text === text)!;
      if (expectReply) {
        await until(async () => (await snapshot()).messages.some(m => m.kind === "tab" && m.runId === source.id));
        await until(async () => await page.getByRole("button", { name: "Reply", exact: true }).count() >= (await snapshot()).messages.length);
      }
      return source;
    }
    // Reproduce production rooms that already contain an unfinished manual bill,
    // in addition to the old receipts seeded above.
    if (scenario === "everyone") await send("@Tab create a new bill for $20");
    const expectedTotal = scenario.startsWith("new-tab") ? 100 : 120;
    if (scenario === "covered") {
      await send("@Tab create a new bill for $1.20. I covered the bill. Everyone in this group, split equally.");
    } else if ((scenario === "terse" || scenario === "terse-tagged")) {
      await send("@Tab create a new bill for $1.20");
      await send(scenario === "terse-tagged" ? "@Tab me, everyone, equally" : "me, everyone, equally");
    } else if (scenario === "new-tab" || scenario === "new-tab-caret") {
      await send("hello tab");
      await send("lets create a new tab");
      if (scenario === "new-tab-caret") {
        await harness.dinner.send(harness.room.id, harness.alice, { clientId: randomUUID(), text: "everyone in this group. $1 split evenly" });
        await page.reload();
        await page.getByRole("textbox", { name: "Message the room" }).waitFor();
        await send("@tab ^");
      } else await send("everyone in this group. $1 split evenly");
      const question = (await snapshot()).messages.at(-1)!;
      assert.match(question.text, /paid|payer/i);
      assert.doesNotMatch(question.text, /John Doe|Lorem Ipsum|which receipt/i);
      await send("I paid");
    } else if (scenario === "greeting") {
      await send("hello tab");
      await send("can you create a bill of $1.2 split evenly between everyone in this groud. i paid");
    } else if (scenario === "caret") {
      await send("can you create a bill of $1.2 split evenly between everyone in this groud. i paid", false);
      await send("@tab ^");
    } else if (scenario === "legacy-question") {
      await harness.dinner.send(harness.room.id, harness.alice, { clientId: randomUUID(), text: "create a bill of $1.20. I paid. Split evenly." });
      const tag = await harness.dinner.send(harness.room.id, harness.alice, { clientId: randomUUID(), text: "@tab ^" });
      await harness.dinner.botReply(harness.room.id, harness.alice, tag.id, "Who should share this bill?");
      await page.reload();
      await page.getByRole("textbox", { name: "Message the room" }).waitFor();
      await page.getByRole("button", { name: "Reply", exact: true }).last().click({ force: true });
      await send("everyone");
    } else {
      await send("@Tab create a new bill of $1.20. I paid. Split evenly.");
      const question = (await snapshot()).messages.at(-1)!;
      assert.ok(question.kind === "tab" && question.expectsReply, question.text);
      if (scenario === "explicit-reply") await page.getByRole("button", { name: "Reply", exact: true }).last().click({ force: true });
      await send(scenario === "everyone-tab" ? "everyone tab" : "everyone");
    }
    const proposals = await harness.db.collection("dinner-agent-proposals").find({ roomId: harness.room.id }).toArray();
    assert.equal(proposals.length, 1, JSON.stringify(transcript));
    assert.equal(proposals[0].fields.totalCents, expectedTotal);
    assert.equal(proposals[0].fields.payerId, harness.alice.id);
    assert.deepEqual(proposals[0].fields.shares.map((s: { cents: number }) => s.cents), [expectedTotal / 2, expectedTotal / 2]);
    assert.ok(!proposals[0].fields.attachmentId);
    assert.deepEqual(await harness.db.collection("dinner-pending-expenses").find({}).toArray(), before);
    assert.deepEqual((await snapshot()).expenses, initialExpenses);
    assert.equal(harness.errors.length, 0);
    const replies = (await snapshot()).messages.filter(m => m.kind === "tab");
    assert.equal(new Set(replies.map(m => m.runId)).size, replies.length);
    await page.reload();
    await page.getByRole("textbox", { name: "Message the room" }).waitFor();
    assert.equal(await harness.db.collection("dinner-agent-proposals").countDocuments({ roomId: harness.room.id }), 1);
    await page.screenshot({ path: `${artifacts}/${scenario}.png`, fullPage: true });
    console.log(`PASS ${scenario}: browser → API → production agent runtime → one correct proposal; old receipts and ledger unchanged`);
  } finally {
    await writeFile(`${artifacts}/${scenario}.json`, JSON.stringify(transcript, null, 2));
    await browser.close(); await harness.close();
  }
}

}
main().catch(error => { console.error(error); process.exitCode = 1; });
