import assert from "node:assert/strict";
import { test } from "node:test";
import { selectedParticipants } from "../../src/lib/dinner/agent/participants";
const members = [
  { userId: "alice", name: "Alice" },
  { userId: "bob", name: "Bob" },
];
test("payer and equal-split method never imply receipt participants", () => {
  assert.equal(
    selectedParticipants(
      ["@Tab split this receipt equally", "@Tab I was the payer"],
      members,
      "alice",
    ),
    null,
  );
});
test("participant evidence accepts named people, first person, and explicit room-wide selections", () => {
  for (const text of [
    "@Tab split between Alice and Bob",
    "@Tab Bob and me",
    "@Tab everyone",
    "@Tab both of us",
  ])
    assert.deepEqual(selectedParticipants([text], members, "alice")?.sort(), [
      "alice",
      "bob",
    ]);
  assert.deepEqual(
    selectedParticipants(
      ["@Tab split between Alice and Bob", "@Tab split for Bob"],
      members,
      "alice",
    ),
    ["bob"],
  );
});
test("ambiguous names, exclusions and partial names require clarification", () => {
  assert.equal(
    selectedParticipants(["@Tab everyone except Bob"], members, "alice"),
    null,
  );
  assert.equal(
    selectedParticipants(
      ["@Tab split between Alicex and Bobby"],
      members,
      "alice",
    ),
    null,
  );
  assert.equal(
    selectedParticipants(
      ["@Tab split for Alice"],
      [...members, { userId: "other-alice", name: "Alice" }],
      "alice",
    ),
    null,
  );
});
