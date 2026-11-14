// Explicit integration gate: start the app first. It never logs in or loads client scripts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
const base = process.env.DINNER_THEME_SMOKE_URL ?? "http://localhost:3000";
for (const [path, dinner] of [
  ["/app", true],
  ["/app/rooms", true],
  ["/app/activity", true],
  ["/app/wallet", true],
  ["/app/agent", true],
  ["/app/invite/preview-only", true],
  ["/wallet", false],
  ["/rooms", false],
  ["/activity", false],
] satisfies [string, boolean][]) {
  test(`SSR theme and browser color are correct for ${path}, regardless of caller hint`, async () => {
    const response = await fetch(new URL(path, base), {
      headers: { "x-tab-surface": dinner ? "legacy" : "dinner" },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 200);
    const dom = new JSDOM(await response.text());
    try {
      const document = dom.window.document;
      assert.equal(
        document.documentElement.className,
        dinner ? "dark dinner-document" : "dark",
      );
      assert.equal(
        document
          .querySelector('meta[name="theme-color"]')
          ?.getAttribute("content"),
        dinner ? "#0B0B0B" : "#0A0A14",
      );
    } finally {
      dom.window.close();
    }
  });
}
