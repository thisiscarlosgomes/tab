import { test } from "node:test";
import assert from "node:assert/strict";
import { replyTargets } from "./browser/live-routing";
test("live replies route names and mentions without waking participants for Tab-only requests", () => {
  assert.deepEqual(replyTargets("what do you think Nina"), [2]);
  assert.deepEqual(replyTargets("@Nina can $25 work?"), [2]);
  assert.deepEqual(replyTargets("@Leo @Owen discuss 19:30"), [1, 3]);
  assert.deepEqual(replyTargets("@Tab compare Nina's budget"), []);
  assert.deepEqual(
    replyTargets("Everyone, can we meet at 19:30?"),
    [0, 1, 2, 3],
  );
  assert.deepEqual(replyTargets("How about $25?"), [0, 1, 2, 3]);
});
