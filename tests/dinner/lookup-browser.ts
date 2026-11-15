import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { setTimeout as delay } from "node:timers/promises";
import { startHarness } from "./browser/harness";
import { runTabAgent } from "../../src/lib/dinner/agent/runtime";
import { classifyAction } from "../../src/lib/dinner/agent/action-routing";

async function main() {
  let lookup = false;
  let preparations = 0;
  const h = await startHarness(async context => {
    if (lookup) {
      assert.equal(context.action, "lookup");
      assert.ok(!context.conversation.some(m => m.content.startsWith("The current requester accepted Tab's offer")));
      const facts = await context.readContext() as { billCounts: { awaitingPayment: number; awaitingConfirmation: number } };
      assert.deepEqual(facts.billCounts, { awaitingPayment: 11, awaitingConfirmation: 1 });
    }
    return runTabAgent({ ...context, prepareExpense: async input => { if (lookup) preparations++; return context.prepareExpense(input); } });
  }, undefined, undefined, true, classifyAction);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await h.dinner.setAssistance(h.room.id, h.alice, "smart");
    const created = [];
    for (let i = 0; i < 12; i++) {
      const draft = await h.dinner.draft(h.room.id, h.alice, { clientId: randomUUID(), description: `Dinner ${i}`, totalCents: 100, payerId: h.alice.id, shares: [{ userId: h.alice.id, cents: 50 }, { userId: h.bob.id, cents: 50 }] });
      created.push(await h.dinner.confirm(h.room.id, h.alice, draft.id, randomUUID(), draft.version));
    }
    await h.dinner.deleteSplit(h.room.id, h.alice, created[0].id, randomUUID(), created[0].version);
    const paid = created[1];
    assert.ok(paid.status === "confirmed");
    const report = await h.dinner.reportOutside(h.room.id, h.bob, paid.obligations[0].id, randomUUID());
    await h.dinner.resolveOutside(h.room.id, h.alice, paid.obligations[0].id, report.id, "confirmed", randomUUID());
    await h.dinner.draft(h.room.id, h.alice, { clientId: randomUUID(), description: "Needs review", totalCents: 200, payerId: h.alice.id, shares: [{ userId: h.alice.id, cents: 100 }, { userId: h.bob.id, cents: 100 }] });
    await page.goto(`${h.url}/app/rooms/${h.room.id}`);
    async function send(text: string) {
      const input = page.getByRole("textbox", { name: "Message the room" });
      await input.fill(text); await input.press("Enter");
      const until = Date.now() + 60000;
      while (Date.now() < until) {
        const room = await h.dinner.memberRoom(h.room.id, h.alice);
        const source = room.messages.findLast(m => m.text === text && m.authorId === h.alice.id);
        const reply = source && room.messages.find(m => m.kind === "tab" && m.runId === source.id);
        if (reply) return reply.text;
        await delay(100);
      }
      throw new Error("Timed out waiting for reply");
    }
    await send("tab create a split bill for $1");
    const before = (await h.dinner.memberRoom(h.room.id, h.alice)).expenses;
    const tasks = await h.db.collection("dinner-bill-tasks").find({}).toArray();
    lookup = true;
    for (const question of ["hey tab how many split bills are pending", "@Tab how many bills are still unpaid in this room?"]) {
      const reply = await send(question);
      console.log(JSON.stringify({ question, reply }));
      assert.match(reply, /11 bills awaiting payment/);
      assert.match(reply, /\$5\.50/);
      assert.doesNotMatch(reply, /who paid|who is.*payer|to create|clarifications|should.*split.*everyone/i);
    }
    assert.equal(preparations, 0);
    assert.deepEqual((await h.dinner.memberRoom(h.room.id, h.alice)).expenses, before);
    assert.deepEqual(await h.db.collection("dinner-bill-tasks").find({}).toArray(), tasks);
    // Delete every outstanding bill, then put a false historical answer directly
    // in the recent conversation. The lookup must still use the live ledger.
    lookup = false;
    for (const expense of (await h.dinner.memberRoom(h.room.id, h.alice)).expenses) {
      if (expense.status === "confirmed" && expense.obligations.some(o => o.status === "outstanding"))
        await h.dinner.deleteSplit(h.room.id, h.alice, expense.id, randomUUID(), expense.version);
    }
    const old = await h.dinner.send(h.room.id, h.alice, { clientId: randomUUID(), text: "@Tab what was pending?" });
    await h.dinner.botReply(h.room.id, h.alice, old.id, "There are 3 outstanding obligations: Bob owes Alice $0.50, $60.00 and $0.60. Anything else?");
    await page.reload();
    const afterDeletion = await send("@Tab how many bills are pending");
    console.log(JSON.stringify({ question: "@Tab how many bills are pending", reply: afterDeletion }));
    assert.match(afterDeletion, /0 bills awaiting payment/);
    assert.match(afterDeletion, /\$0\.00/);
    assert.doesNotMatch(afterDeletion, /\$60\.00|\$0\.50|\$0\.60/);
    // Actual UI reply, without @Tab, must trigger in mentions-only mode and
    // identify the current draft instead of repeating the aggregate summary.
    await h.dinner.setAssistance(h.room.id, h.alice, "mentions");
    await page.reload();
    for (const question of ["which onen is awaiting confirmation", "which one"]) {
      const previous = (await h.dinner.memberRoom(h.room.id, h.alice)).messages.findLast(m => m.kind === "tab")!;
      await page.locator("article.is-incoming").last().getByRole("button", { name: "Reply", exact: true }).click({ force: true });
      const reply = await send(question);
      console.log(JSON.stringify({ question, reply }));
      assert.match(reply, /Needs review/i);
      assert.match(reply, /\$2(?:\.00)?/);
      assert.doesNotMatch(reply, /This room has|who paid|who should/i);
      const latest = await h.dinner.memberRoom(h.room.id, h.alice);
      assert.equal(latest.messages.findLast(m => m.text === question)?.replyTo, previous.id);
      assert.equal(await page.getByText("Sending…", { exact: true }).count(), 0);
    }
    const listed = await send("@Tab list the bills awaiting confirmation");
    assert.match(listed, /Needs review/i);
    assert.match(listed, /\$2(?:\.00)?/);
    assert.doesNotMatch(listed, /Dinner \d|Existing dinner/);
    console.log(JSON.stringify({ question: "list awaiting confirmation", reply: listed }));
    assert.equal(preparations, 0);
    await page.screenshot({ path: "/tmp/tab-lookup-browser.png", fullPage: true });
    console.log("PASS: smart offer → status question; all-room counts; no creation, task or ledger changes");
  } finally { await browser.close(); await h.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
