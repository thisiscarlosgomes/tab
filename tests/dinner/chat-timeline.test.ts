import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTimeline } from "../../src/components/dinner/chat-timeline";
import type { Proposal } from "../../src/lib/dinner/agent/model";
const at = (n: number) => new Date(n * 1000).toISOString();
const proposal = (id: string, time: number) =>
  ({ id, createdAt: at(time), runKey: "pending:task:2" }) as Proposal;
test("cards follow creation time despite reverse API order and status changes", () => {
  const messages = [
    { id: "request", createdAt: at(1) },
    { id: "reply", createdAt: at(3) },
    { id: "later", createdAt: at(6) },
  ];
  const cards = [proposal("second", 5), proposal("first", 2)];
  const ids = (p: Proposal[]) => chatTimeline(messages, p).map((e) => e.id);
  assert.deepEqual(ids(cards), [
    "request",
    "first",
    "reply",
    "second",
    "later",
  ]);
  assert.deepEqual(
    ids(cards.map((p) => ({ ...p, appliedExpenseId: "saved" }))),
    ids(cards),
  );
  assert.deepEqual(
    chatTimeline([], cards).map((e) => e.id),
    ["first", "second"],
  );
});
