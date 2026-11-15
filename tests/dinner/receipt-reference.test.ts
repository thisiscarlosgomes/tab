import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "../../src/lib/dinner/model";
import { referencedReceipt, referencedRoomMessage } from "../../src/lib/dinner/agent/receipt-reference";
const message = (id: string, seq: number, text: string, images: string[] = []): Message => ({ id, seq, text, attachmentIds: images, authorId: "member", clientId: id, createdAt: new Date().toISOString(), replyTo: null, reactions: [] });
test("tagged references find untagged attachments and participant messages within the room snapshot", () => {
  const receipt = message("receipt", 1, "help me create a tab for this receipt", ["image"]);
  const tag = message("tag", 2, "@tab check message above");
  assert.equal(referencedReceipt([receipt, tag], tag)?.id, receipt.id);
  const people = message("people", 3, "everyone in this group");
  const followup = message("followup", 4, "@tab check message above");
  assert.equal(referencedRoomMessage([receipt, tag, people, followup], followup)?.id, people.id);
  assert.equal(referencedReceipt([receipt, tag, people, followup], followup), undefined);
});
test("references never select future images or silently skip intervening human messages", () => {
  const receipt = message("receipt", 1, "receipt", ["image"]);
  const unrelated = message("unrelated", 2, "See you tomorrow");
  const tag = message("tag", 3, "@tab check message above");
  const future = message("future", 4, "receipt", ["future-image"]);
  assert.equal(referencedReceipt([receipt, unrelated, tag, future], tag), undefined);
  assert.equal(referencedReceipt([receipt, unrelated, { ...tag, replyTo: receipt.id }, future], { ...tag, replyTo: receipt.id })?.id, receipt.id);
  assert.equal(referencedReceipt([receipt, tag, future], { ...tag, replyTo: future.id, text: "@tab check this receipt" }), undefined);
});

test("replying to a bot question recovers the original bill behind a caret reference", () => {
  const bill = message("bill", 1, "create a bill of $1.20, I paid, split evenly");
  const tag = message("tag", 2, "@tab ^");
  const bot = { ...message("bot", 3, "Who should share it?"), kind: "tab" as const, requestedBy: "member", runId: tag.id };
  const answer = { ...message("answer", 4, "everyone"), replyTo: bot.id };
  assert.equal(referencedRoomMessage([bill, tag, bot, answer], answer)?.id, bill.id);
});
