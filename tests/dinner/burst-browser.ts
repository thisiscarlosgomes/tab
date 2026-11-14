import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { Attachments } from "../../src/lib/dinner/attachments";
import { chromium } from "playwright";
import { startHarness } from "./browser/harness";
import { runTabAgent } from "../../src/lib/dinner/agent/runtime";
import { classifyAction } from "../../src/lib/dinner/agent/action-routing";
import { classifyBurst } from "../../src/lib/dinner/agent/bursts";

async function main() {
  assert.ok(process.env.OPENAI_API_KEY);
  const trace: unknown[] = [];
  let receiptCalls = 0;
  const h = await startHarness(async context => {
    const reply = await runTabAgent(context);
    trace.push({ request: context.request, action: context.action, readyBill: context.readyBill, reply });
    return reply;
  }, async () => {
    receiptCalls++;
    await h.dinner.send(h.room.id, h.alice, { clientId: randomUUID(), text: "Actually the receipt total is $90. I paid. Everyone, equally." });
    return { merchant: "Dinner receipt", totalAmount: 60, currency: "USD", confidence: 1, items: [] };
  }, undefined, true, classifyAction, classifyBurst);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let auth = "";
  page.on("request", request => { const value = request.headers()["authorization"]; if (value) auth = value; });
  const snapshot = () => h.dinner.memberRoom(h.room.id, h.alice);
  async function until(check: () => Promise<boolean>) {
    const deadline = Date.now() + 90000;
    while (!(await check())) { if (Date.now() > deadline) throw new Error("Timed out"); await delay(100); }
  }
  try {
    await page.goto(`${h.url}/app/rooms/${h.room.id}`);
    const input = page.getByRole("textbox", { name: "Message the room" });
    await input.waitFor();
    async function send(text: string) {
      await input.fill(text); await input.press("Enter");
      await until(async () => (await snapshot()).messages.some(m => m.text === text));
    }
    await send("@Tab create a dinner bill for $60, split equally");
    await h.dinner.send(h.room.id, h.bob, { clientId: randomUUID(), text: "I paid $800 for my trip last week" });
    await send("Actually $90");
    await send("Just me and Bob, I paid");
    await until(async () => (await snapshot()).messages.some(m => m.kind === "tab" && m.text.includes("$90")));
    await page.getByRole("button", { name: "Confirm", exact: true }).waitFor({ timeout: 30000 });
    const room = await snapshot();
    const replies = room.messages.filter(m => m.kind === "tab" && !m.runId.startsWith("action:"));
    assert.equal(replies.length, 1, JSON.stringify(trace));
    assert.equal(room.expenses.length, 1, "Existing fixture bill only; new bill is not confirmed");
    const proposal = await h.db.collection("dinner-agent-proposals").findOne({ "publication.revision": replies[0].kind === "tab" ? replies[0].agentRevision : "" });
    assert.ok(proposal);
    assert.equal(proposal.fields.totalCents, 9000);
    assert.equal(proposal.fields.payerId, h.alice.id);
    assert.deepEqual(proposal.fields.shares.map((s: { cents: number }) => s.cents), [4500, 4500]);
    assert.equal(await page.getByText("Send not confirmed", { exact: true }).count(), 0);
    assert.equal(await page.getByText(/could not finish this reply/).count(), 0);
    // Reload/retry a consumed follow-up using a fresh service instance.
    h.restartAgent();
    const last = room.messages.find(m => m.text === "Just me and Bob, I paid")!;
    const response = await page.evaluate(async ({ url, id, auth }) => {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": auth }, body: JSON.stringify({ messageId: id }) });
      return { status: r.status, body: await r.json() };
    }, { url: `/api/dinner/rooms/${h.room.id}/bot`, id: last.id, auth });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.body.status, "coalesced");
    await page.reload();
    await page.getByRole("button", { name: "Confirm", exact: true }).waitFor();
    assert.equal((await snapshot()).messages.filter(m => m.kind === "tab" && !m.runId.startsWith("action:")).length, 1);
    console.log("PASS: browser burst + interleaved member → one $90 proposal, $45 each; restart/retry produces no duplicate");
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
    const image = await new Attachments(h.db, h.dinner).upload(h.room.id, h.alice, new Request(`http://test?clientId=${randomUUID()}`, { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(bytes) }));
    await h.dinner.send(h.room.id, h.alice, { clientId: randomUUID(), text: "Dinner receipt image", attachmentIds: [image.id] });
    await page.reload(); await input.waitFor();
    await send("@Tab split the receipt above");
    const receiptSource = (await snapshot()).messages.find(m => m.text === "@Tab split the receipt above")!;
    await until(async () => (await snapshot()).messages.some(m => m.kind === "tab" && m.runId === receiptSource.id));
    const receiptRoom = await snapshot();
    const receiptReply = receiptRoom.messages.find(m => m.kind === "tab" && m.runId === receiptSource.id)!;
    assert.match(receiptReply.text, /90/);
    const receiptProposal = await h.db.collection("dinner-agent-proposals").findOne({ "fields.attachmentId": image.id, "publication.revision": receiptReply.kind === "tab" ? receiptReply.agentRevision : "" });
    assert.ok(receiptProposal, JSON.stringify(trace));
    assert.equal(receiptProposal.fields.totalCents, 9000);
    assert.equal(receiptProposal.fields.payerId, h.alice.id);
    assert.equal(receiptCalls, 1, "Superseded runs reuse receipt extraction");
    assert.equal(receiptRoom.expenses.length, 1);
    assert.equal(receiptRoom.messages.filter(m => m.kind === "tab" && m.runId === receiptSource.id).length, 1);
    console.log("PASS: correction during receipt extraction → one $90 receipt proposal; cached OCR; no confirmed expense");
    // Simulate a root message saved without the foreground bot call; a follow-up drives recovery.
    const queued = await page.evaluate(async ({ url, auth, clientId }) => {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": auth }, body: JSON.stringify({ clientId, text: "@Tab create a separate taxi bill for $20, split equally" }) });
      return { status: r.status, body: await r.json() };
    }, { url: `/api/dinner/rooms/${h.room.id}/messages`, auth, clientId: randomUUID() });
    assert.equal(queued.status, 201);
    await send("Actually $30. I paid. Everyone.");
    await until(async () => (await snapshot()).messages.some(m => m.kind === "tab" && m.runId === queued.body.id));
    const recovered = (await snapshot()).messages.find(m => m.kind === "tab" && m.runId === queued.body.id)!;
    assert.match(recovered.text, /30/);
    await page.getByRole("status", { name: "Tab is typing" }).waitFor({ state: "detached", timeout: 30000 });
    await until(async () => await page.getByText(recovered.text, { exact: true }).count() === 1);
    await delay(500);
    assert.equal(await page.getByText(recovered.text, { exact: true }).count(), 1, "Consumed follow-up must not leave a duplicate live preview");
    console.log("PASS: follow-up drives queued root → one saved reply and no duplicate live preview");
  } finally {
    await mkdir("/tmp/tab-burst-e2e", { recursive: true });
    await writeFile("/tmp/tab-burst-e2e/trace.json", JSON.stringify({ trace, requests: h.requests, errors: h.errors }, null, 2));
    await page.screenshot({ path: "/tmp/tab-burst-e2e/final.png", fullPage: true });
    await browser.close(); await h.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
