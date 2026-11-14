import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { startHarness } from "./browser/harness";

async function main() {
  let topicId = "";
  let harness: Awaited<ReturnType<typeof startHarness>>;
  harness = await startHarness(async context => {
    const result = await context.prepareExpense({ roomId: harness.room.id, description: "Smart dinner", totalCents: 6000, payerId: harness.bob.id, shares: [{ userId: harness.alice.id, cents: 3000 }, { userId: harness.bob.id, cents: 3000 }] });
    return "kind" in result ? "For you two or everyone in the room?" : "Your bill is ready to review.";
  }, undefined, async input => ({ action: input.state.offer?.status === "accepted" ? "continue" : input.state.offer?.status === "open" ? "accept" : "offer", topicId, evidenceIds: [topicId, input.messages.at(-1)!.id] }));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
    await page.goto(`${harness.url}/app/rooms/${harness.room.id}`);
    await page.getByRole("tab", { name: "Members", exact: true }).click();
    await Promise.all([page.waitForResponse(r => r.url().endsWith("/assistance") && r.status() === 200), page.getByLabel("Tab assistance").selectOption("smart")]);
    topicId = (await harness.dinner.send(harness.room.id, harness.bob, { clientId: randomUUID(), text: "We should split dinner equally, USD 60. I paid." })).id;
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    const send = async (text: string) => { const input = page.getByRole("textbox", { name: "Message the room" }); await input.fill(text); await input.press("Enter"); };
    await send("Let's do it");
    await page.getByText("Want me to prepare a bill for that plan?", { exact: true }).waitFor();
    await send("Yes");
    await page.getByText("For you two or everyone in the room?", { exact: true }).waitFor();
    await send("Just us two, split equally");
    await page.getByRole("button", { name: "Review bill", exact: true }).waitFor();
    const proposals = await harness.db.collection("dinner-agent-proposals").find({ roomId: harness.room.id }).toArray();
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].fields.totalCents, 6000);
    assert.equal((await harness.dinner.memberRoom(harness.room.id, harness.alice)).assistance?.offer?.status, "completed");
    await mkdir("/tmp/tab-smart-browser", { recursive: true });
    await page.screenshot({ path: "/tmp/tab-smart-browser/desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/tab-smart-browser/mobile.png" });
    assert.equal(harness.errors.length, 0);
    console.log("PASS: settings → agreement → offer → yes → question → clarification → one card, desktop and mobile");
  } finally { await browser.close(); await harness.close(); }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
