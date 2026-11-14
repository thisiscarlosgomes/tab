import assert from "node:assert/strict";
import { test } from "node:test";
import { matchingBills } from "../../src/lib/dinner/agent/bill-reference";
const bills = [
  { id: "a", description: "John Doe", totalCents: 10000 },
  { id: "b", description: "Lorem Ipsum, Dolor", totalCents: 8480 },
];
test("bill names and USD amounts resolve together without guessing", () => {
  for (const text of ["the $100 one Tab", "settle the $100 John Doe bill", "John Doe please", "john doe USD 100"]) {
    assert.deepEqual(matchingBills(text, bills)?.map(b => b.id), ["a"]);
  }
  assert.deepEqual(matchingBills("John Doe $84.80", bills), []);
  assert.equal(matchingBills("yes please", bills), null);
  assert.deepEqual(matchingBills("$100", [...bills, { ...bills[0], id: "c" }])?.map(b => b.id), ["a", "c"]);
});
