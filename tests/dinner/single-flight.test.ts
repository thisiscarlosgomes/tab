import assert from "node:assert/strict";
import { test } from "node:test";
import { createSingleFlight } from "../../src/lib/dinner/single-flight";

test("overlapping polls share a request, but later reads fetch fresh data", async () => {
  const run = createSingleFlight();
  let calls = 0;
  let finish!: (n: number) => void;
  const load = () => {
    calls++;
    return new Promise<number>((resolve) => {
      finish = resolve;
    });
  };
  const a = run("room", load);
  const b = run("room", load);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(a, b);
  finish(1);
  assert.equal(await b, 1);
  assert.equal(await run("room", async () => 2), 2);
});

test("failed reads can retry and separate session instances never share requests", async () => {
  const a = createSingleFlight();
  const b = createSingleFlight();
  await assert.rejects(
    a("room", async () => {
      throw new Error("offline");
    }),
  );
  assert.deepEqual(
    await Promise.all([
      a("room", async () => "Alice"),
      b("room", async () => "Bob"),
    ]),
    ["Alice", "Bob"],
  );
});
