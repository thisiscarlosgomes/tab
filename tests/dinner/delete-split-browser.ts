import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { startHarness } from "./browser/harness";
import { totals } from "../../src/lib/dinner/model";

async function main() {
  const h = await startHarness(async () => "Test assistant");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const url = `${h.url}/app/rooms/${h.room.id}?view=money`;
    await page.goto(url);
    const button = page.getByRole("button", { name: "Delete split", exact: true });
    await button.waitFor();
    page.once("dialog", d => d.dismiss());
    await button.click();
    assert.equal(await button.count(), 1);
    assert.equal(totals(await h.dinner.memberRoom(h.room.id, h.alice), h.bob.id).owe, 50);
    page.once("dialog", d => d.accept());
    await button.click();
    await button.waitFor({ state: "detached" });
    await page.reload();
    await page.getByRole("tab", { name: /money/i }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Existing dinner", exact: true }).count(), 0);
    const room = await h.dinner.memberRoom(h.room.id, h.alice);
    assert.equal(totals(room, h.bob.id).owe, 0);
    assert.equal(room.messages.filter(m => m.text.includes('deleted “Existing dinner”')).length, 1);
    const draft = await h.dinner.draft(h.room.id, h.alice, { clientId: randomUUID(), description: "Pending payment", totalCents: 100, payerId: h.alice.id, shares: [{ userId: h.alice.id, cents: 50 }, { userId: h.bob.id, cents: 50 }] });
    const expense = await h.dinner.confirm(h.room.id, h.alice, draft.id, randomUUID(), draft.version);
    assert.ok(expense.status === "confirmed");
    await h.dinner.reportOutside(h.room.id, h.bob, expense.obligations[0].id, randomUUID());
    await page.reload();
    await page.getByRole("heading", { name: "Pending payment", exact: true }).waitFor();
    assert.equal(await button.count(), 0);
    await page.screenshot({ path: "/tmp/tab-delete-split-browser.png", fullPage: true });
    assert.ok(h.requests.some(r => r.path.endsWith("/delete") && r.status === 200));
    console.log("PASS: cancel dialog, delete unpaid split, refresh persistence, zero balances, one chat notice, pending payment protection");
  } catch (e) { console.error({ requests: h.requests, errors: h.errors, alerts: await page.getByRole("alert").allTextContents(), body: (await page.locator("body").innerText()).slice(-1500) }); throw e; } finally { await browser.close(); await h.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
