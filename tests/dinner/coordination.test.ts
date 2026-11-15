import assert from "node:assert/strict";
import { test } from "node:test";
import { replyChain } from "../../src/lib/dinner/agent/coordination";
import type { Message } from "../../src/lib/dinner/model";
const message = (id: string, seq: number, replyTo: string | null = null): Message => ({ id, seq, replyTo, authorId: "alice", clientId: id, text: id, kind: "member", attachmentIds: [], reactions: [], createdAt: new Date().toISOString() });
test("reply provenance is bounded, chronological and never follows missing or future references", () => {
  const messages = Array.from({ length: 30 }, (_, i) => message(String(i), i + 1, i ? String(i - 1) : null));
  const chain = replyChain(messages, messages[29]);
  assert.equal(chain.messages.length, 12);
  assert.equal(chain.truncated, true);
  assert.equal(chain.messages[0].id, "28");
  assert.deepEqual(replyChain(messages, message("source", 20, "25")).messages, []);
  assert.deepEqual(replyChain(messages, message("source", 40, "another-room-id")).messages, []);
});
