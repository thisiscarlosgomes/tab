import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startHarness } from "./browser/harness";
import { runTabAgent } from "../../src/lib/dinner/agent/runtime";
import { classifyAction } from "../../src/lib/dinner/agent/action-routing";
import { classifyBurst } from "../../src/lib/dinner/agent/bursts";

async function main() {
  const h = await startHarness(runTabAgent, undefined, undefined, true, classifyAction, classifyBurst);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const questions: import("../../src/lib/dinner/model").Message[] = [];
    for (const [name, cents, actor] of [["Dinner", 6000, h.alice], ["Taxi", 2000, h.bob]] as const) {
      await h.dinner.draft(h.room.id, actor, { clientId: randomUUID(), description: name, totalCents: cents, payerId: actor.id, shares: [{ userId: h.alice.id, cents: cents / 2 }, { userId: h.bob.id, cents: cents / 2 }] });
      const source = await h.dinner.send(h.room.id, actor, { clientId: randomUUID(), text: `@Tab what about ${name}?` });
      questions.push(await h.dinner.botReply(h.room.id, actor, source.id, `${name} is awaiting confirmation. What would you like to know?`, true));
    }
    for (let i = 0; i < 30; i++) await h.dinner.send(h.room.id, i % 2 ? h.alice : h.bob, { clientId: randomUUID(), text: `Weekend conversation ${i}` });
    const before = (await h.dinner.memberRoom(h.room.id, h.alice)).expenses;
    await page.goto(`${h.url}/app/rooms/${h.room.id}`);
    for (const [index, expected, excluded] of [[0, /\$60(?:\.00)?/, /\$20(?:\.00)?/], [1, /\$20(?:\.00)?/, /\$60(?:\.00)?/]] as const) {
      const target = questions[index];
      await page.locator("article.is-incoming").filter({ hasText: target.text }).getByRole("button", { name: "Reply", exact: true }).click({ force: true });
      const text = index ? "And how much is this one?" : "How much is this one?";
      const input = page.getByRole("textbox", { name: "Message the room" });
      await input.fill(text); await input.press("Enter");
      let answer = "";
      const until = Date.now() + 90000;
      while (Date.now() < until) {
        const room = await h.dinner.memberRoom(h.room.id, h.alice);
        const source = room.messages.findLast(m => m.authorId === h.alice.id && m.text === text);
        const reply = source && room.messages.find(m => m.kind === "tab" && m.runId === source.id);
        if (reply) { assert.equal(source!.replyTo, target.id); answer = reply.text; break; }
        await delay(150);
      }
      assert.match(answer, expected); assert.doesNotMatch(answer, excluded);
      console.log(JSON.stringify({ target: target.text, answer }));
    }
    assert.deepEqual((await h.dinner.memberRoom(h.room.id, h.alice)).expenses, before);
    assert.equal((await h.db.collection("dinner-bill-tasks").countDocuments()), 0);
    await page.screenshot({ path: "/tmp/tab-coordination-browser.png", fullPage: true });
    console.log("PASS: old quoted replies beyond 25 messages identify separate bills across authors, without mutations");
  } finally { await browser.close(); await h.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
