import { test } from "node:test";
import assert from "node:assert/strict";
import { directlyAddressesTab, stripTabAddress } from "../../src/lib/dinner/agent/awareness-schema";
import { selectedParticipants } from "../../src/lib/dinner/agent/participants";

test("greetings, direct questions and actions address Tab without an at-sign", () => {
  for (const text of ["hey tab", "Hey, Tab!", "hi Tab", "Hello Tab, can you help?", "good morning tab", "Thanks, Tab", "Tab?", "Tab", "tab create a dinner bill", "Tab, I paid for both", "Tab calculate the total", "Tab can you help", "Tab who paid?", "Tab are you there?", "Can you split this, Tab?", "Please split between Alice and Bob, Tab", "please Tab, check the bill", "Hey Tab split this equally"])
    assert.equal(directlyAddressesTab(text), true, text);
});

test("references, quotations and bill/browser nouns do not address Tab", () => {
  for (const text of ["last week Tab was helpful", "Tab was helpful last week", "Tab said we owe $20", "Tab creates bills", "Tab is a useful assistant", "I think Tab should split this", "Open a new tab", "Put it on my tab", "We should split the tab", "Did Tab create the bill?", "Someone said hey tab yesterday", "Hey Tab was useful yesterday", "Tab, our assistant, was helpful", '"hey Tab"', "> hey tab", "`Tab create a bill`", "table create dinner", "tab@example.com"])
    assert.equal(directlyAddressesTab(text), false, text);
});

test("the assistant address cannot accidentally select a human member also named Tab", () => {
  const members = [{ userId: "a", name: "Alice" }, { userId: "b", name: "Bob" }, { userId: "t", name: "Tab" }];
  for (const text of ["Hey Tab, split between Alice and Bob", "Tab split between Alice and Bob", "Split between Alice and Bob, Tab"])
    assert.deepEqual(selectedParticipants([text], members, "a")?.sort(), ["a", "b"]);
  assert.equal(stripTabAddress("Last week Tab paid"), "Last week Tab paid");
});

test("an adjacent answer belongs to the requester's fresh question only", async () => {
  const { answersTabQuestion } = await import("../../src/lib/dinner/agent/awareness-schema");
  const question = { id: "q", seq: 2, kind: "tab", requestedBy: "a", text: "How can I help?", createdAt: "2026-11-10T00:00:00Z" };
  const answer = { seq: 3, authorId: "a", text: "everyone", createdAt: "2026-11-10T00:00:01Z" };
  assert.equal(answersTabQuestion([question], answer), true);
  assert.equal(answersTabQuestion([question], { ...answer, authorId: "b" }), false);
  assert.equal(answersTabQuestion([question], { ...answer, replyTo: "someone-else" }), false);
  assert.equal(answersTabQuestion([question], { ...answer, text: "@Bob your turn" }), false);
  assert.equal(answersTabQuestion([question], { ...answer, createdAt: "2026-11-10T00:16:00Z" }), false);
  assert.equal(answersTabQuestion([question, { ...question, id: "other", seq: 3, kind: "member" }], { ...answer, seq: 4 }), false);
});
