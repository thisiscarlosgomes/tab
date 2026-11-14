import assert from "node:assert/strict";
import { test } from "node:test";
import { orderedPayerAnswer, resolvePayerEvidence, type PayerExtractionInput, type PayerEvidence } from "../../src/lib/dinner/agent/payer-extraction";
const input: PayerExtractionInput = {
  messages: [{ id: "message", authorId: "bob", text: "I covered the bill. Everyone, equally." }],
  members: [{ userId: "alice", name: "Alice" }, { userId: "bob", name: "Bob" }], question: "Who paid?",
};
const evidence: PayerEvidence = { decision: "set", messageId: "message", quote: "I covered the bill", reference: "speaker" };
test("payer evidence binds first person to the actual message author", () => {
  const result = resolvePayerEvidence(input, evidence);
  assert.ok(result.kind === "set"); assert.equal(result.payerId, "bob");
  assert.equal(resolvePayerEvidence(input, { ...evidence, reference: "Bob" }).kind, "set");
});
test("payer evidence rejects invented text, foreign messages, guessed IDs and departed members", () => {
  for (const candidate of [
    { ...evidence, messageId: "other-room-message" },
    { ...evidence, quote: "Alice paid" },
    { ...evidence, reference: "alice" },
    { ...evidence, quote: "Everyone", reference: "speaker" },
  ]) assert.equal(resolvePayerEvidence(input, candidate).kind, "unchanged");
  assert.equal(resolvePayerEvidence({ ...input, members: input.members.slice(0, 1) }, evidence).kind, "unchanged");
});
test("named payer evidence requires one exact room identity and a supporting quote", () => {
  const named = { ...input, messages: [{ id: "message", authorId: "alice", text: "Bob picked up the check" }] };
  const candidate = { ...evidence, quote: "Bob picked up the check", reference: "Bob" };
  const result = resolvePayerEvidence(named, candidate);
  assert.ok(result.kind === "set"); assert.equal(result.payerId, "bob");
  assert.equal(resolvePayerEvidence({ ...named, members: [...named.members, { userId: "bob2", name: "Bob" }] }, candidate).kind, "unchanged");
});
test("retraction requires real message evidence and unchanged leaves saved identity intact", () => {
  const retract = { ...input, currentPayerId: "bob", messages: [{ id: "message", authorId: "bob", text: "Actually I did not pay and don't know who did" }] };
  assert.equal(resolvePayerEvidence(retract, { decision: "clear", messageId: "message", quote: "I did not pay", reference: null }).kind, "clear");
  assert.equal(resolvePayerEvidence(retract, { decision: "clear", messageId: "message", quote: "I covered it", reference: null }).kind, "unchanged");
});

test("a named payer cannot match a substring of another person's name", () => {
  const named = { ...input, messages: [{ id: "message", authorId: "alice", text: "Bobby covered dinner" }] };
  assert.equal(resolvePayerEvidence(named, { ...evidence, quote: "Bobby covered dinner", reference: "Bob" }).kind, "unchanged");
});

test("ordered payer answers require the saved question order and exact member identity", () => {
  const message = { id: "answer", authorId: "bob", text: "@Tab me, everyone, equally" };
  const candidate = orderedPayerAnswer(message, input.members, ["payer", "participants", "split"]);
  assert.ok(candidate);
  assert.deepEqual(resolvePayerEvidence({ ...input, messages: [message] }, candidate).kind, "set");
  assert.equal(orderedPayerAnswer(message, input.members), null);
  assert.equal(orderedPayerAnswer(message, input.members, ["payer", "participants"]), null);
  assert.equal(orderedPayerAnswer(message, input.members, ["participants", "payer", "split"]), null);
  assert.equal(orderedPayerAnswer({ ...message, text: "everyone; Alice; equally" }, input.members, ["participants", "payer", "split"])?.reference, "Alice");
  assert.equal(orderedPayerAnswer({ ...message, text: "Alice, everyone" }, [...input.members, { userId: "alice2", name: "Alice" }], ["payer", "participants"]), null);
});
