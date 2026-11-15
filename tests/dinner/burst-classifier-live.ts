import assert from "node:assert/strict";
import { classifyBurst } from "../../src/lib/dinner/agent/bursts";
import type { Message } from "../../src/lib/dinner/model";
const message = (text: string, index: number): Message => ({ id: `message-${index}`, authorId: "alice", clientId: `client-${index}`, kind: "member", text, seq: index + 1, replyTo: null, attachmentIds: [], reactions: [], createdAt: new Date().toISOString() });
const cases = [
  { root: "@Tab create a dinner bill for $60, split equally", texts: ["Actually $90", "Just me and Bob, I paid"], expected: [0, 1] },
  { root: "@Tab split this receipt", texts: ["I paid", "Actually the total is $90.", "Everyone, equally"], expected: [0, 1, 2] },
  { root: "@Tab create a dinner bill for $60", texts: ["@Tab what is the weather?", "@Tab create another bill for the taxi, $20"], expected: [] },
  { root: "@Tab create a dinner bill for $60", texts: ["@Tab create another bill for the taxi, $20", "Actually make the taxi $30"], expected: [] },
  { root: "@Tab create a dinner bill for $60", texts: ["Never mind, cancel that", "I'm going to bed"], expected: [0] },
  { root: "@Tab create a dinner bill for $60", texts: ["My lunch yesterday was $90", "Bob paid for my flight last week"], expected: [] },
  { root: "@Tab create a dinner bill for $60", texts: ["Make that 90 dollars", "The payer was Bob, not me", "Just Bob and Alice, evenly"], expected: [0, 1, 2] },
];
async function main() {
  for (const c of cases) {
    const candidates = c.texts.map((text, i) => message(text, i + 1));
    const result = await classifyBurst({ root: message(c.root, 0), candidates });
    assert.deepEqual([...result.relatedIds].sort(), c.expected.map(i => candidates[i].id).sort(), JSON.stringify(c));
    console.log(`PASS ${JSON.stringify(c.texts)}`);
  }
  console.log(`${cases.length}/${cases.length} live semantic grouping checks passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
