import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planningFacts,
  planningStatusReply,
} from "../../src/lib/dinner/agent/planning";
import type { PlanView } from "../../src/lib/dinner/plans/model";

test("planning projection preserves tied choices and separates current consent from availability", () => {
  const plan: PlanView = {
    id: "plan",
    roomId: "room",
    creatorId: "a",
    title: "Dinner",
    participantIds: ["a", "b", "c"],
    timeZone: "UTC",
    location: "Cafe",
    budgetCents: 1000,
    currency: "USD",
    state: "confirming",
    revision: 4,
    optionsVersion: 1,
    termsVersion: 2,
    slots: ["2035-01-02", "2035-01-01"].map((day, i) => ({
      id: `s${i}`,
      localStart: `${day}T19:00`,
      localEnd: `${day}T21:00`,
      startAt: `${day}T19:00:00Z`,
      endAt: `${day}T21:00:00Z`,
    })),
    deadline: null,
    responses: [
      {
        userId: "a",
        version: 1,
        votes: { s0: "if_needed", s1: "if_needed" },
        budget: "unsure",
        privateNote: "secret",
        updatedAt: "now",
      },
    ],
    terms: {
      localStart: "2035-01-01T19:00",
      localEnd: "2035-01-01T21:00",
      startAt: "2035-01-01T19:00:00Z",
      endAt: "2035-01-01T21:00:00Z",
      timeZone: "UTC",
      location: "Cafe",
      budgetCents: 1000,
    },
    decisions: [
      {
        userId: "a",
        termsVersion: 1,
        version: 1,
        decision: "accepted",
        at: "now",
      },
      {
        userId: "b",
        termsVersion: 2,
        version: 1,
        decision: "declined",
        at: "now",
      },
    ],
    confirmedIds: [],
    history: [],
    createdAt: "now",
    updatedAt: "now",
  };
  const result = planningFacts(plan, [
    { userId: "a", name: "Alice" },
    { userId: "b", name: "Bob" },
    { userId: "c", name: "Carol" },
  ]);
  assert.deepEqual(
    result.options.map((s) => s.id),
    ["s1", "s0"],
  );
  assert.deepEqual(
    result.options.map((s) => [s.works, s.flexible, s.cant, s.unanswered]),
    [
      [0, 1, 0, 2],
      [0, 1, 0, 2],
    ],
  );
  assert.deepEqual(result.finalDecisions?.accepted, []);
  const status = planningStatusReply("@Tab who's confirmed?", {
    plans: [result],
    hasMore: false,
  });
  assert.ok(status?.includes("Bob declined this time."));
  assert.ok(status?.includes("Still waiting for Alice and Carol."));
  assert.ok(status?.includes("It isn't locked in."));
  assert.ok(!status?.includes("Alice accepted"));
  assert.equal(
    planningStatusReply("@Tab change the time instead", {
      plans: [result],
      hasMore: false,
    }),
    null,
  );
  assert.equal(
    planningStatusReply("@Tab who's confirmed?", {
      plans: [result, result],
      hasMore: false,
    }),
    null,
  );
  assert.deepEqual(
    result.finalDecisions?.missing.map((p) => p.name),
    ["Alice", "Carol"],
  );
  assert.deepEqual(
    result.finalDecisions?.declined.map((p) => p.name),
    ["Bob"],
  );
  const saturday = {
    ...result, id: "saturday", title: "Saturday dinner", state: "confirmed" as const,
    link: "/app/rooms/room?view=plan&plan=saturday",
    confirmedMembers: [{userId: "a", name: "Maya"}, {userId: "b", name: "Leo"}, {userId: "n", name: "Nina"}],
    finalDecisions: { accepted: [{userId: "a", name: "Maya"}, {userId: "b", name: "Leo"}, {userId: "n", name: "Nina"}], declined: [], missing: [{userId: "o", name: "Owen"}] },
  };
  const friday = {...saturday, id: "friday", title: "Friday dinner", link: "/app/rooms/room?view=plan&plan=friday", confirmedMembers: saturday.confirmedMembers.slice(0,2), finalDecisions: {...saturday.finalDecisions, declined: [{userId: "n", name: "Nina"}], accepted: saturday.confirmedMembers.slice(0,2)}};
  const followup = planningStatusReply("Is Owen coming too?", {plans: [friday, saturday], hasMore: false}, `Saturday is set. ${saturday.link}`);
  assert.match(followup!, /Owen hasn't confirmed for Saturday dinner yet/);
  assert.match(followup!, /Maya, Leo, and Nina are joining/);
  assert.doesNotMatch(followup!, /Nina.*(?:out|declined)/);
  assert.match(planningStatusReply("Who is joining Friday dinner?", {plans: [friday, saturday], hasMore: false}, saturday.link)!, /references conflict/);
  assert.equal(result.budget.unknown.length, 3);
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("proposal presentation marks earlier same-title suggestions without merging owners or saved plans", async () => {
  const { proposalPresentation, proposalSourceId } = await import(
    "../../src/lib/dinner/agent/plan-proposals"
  );
  const first = {
    id: "first",
    roomId: "room",
    userId: "alice",
    visibility: "room" as const,
    runKey: "room:room:source-one",
    createdAt: "2030-01-01T00:00:00Z",
    appliedPlanId: null,
    idea: "Dinner",
    fields: {
      title: "Dinner",
      participantIds: ["alice"],
      timeZone: null,
      location: "Cafe",
      budgetCents: 5000,
      slots: null,
    },
  };
  const second = {
    ...first,
    id: "second",
    createdAt: "2030-01-01T00:01:00Z",
    fields: { ...first.fields, budgetCents: 2500 },
  };
  const other = {
    ...second,
    id: "other",
    userId: "bob",
    createdAt: "2030-01-01T00:02:00Z",
  };
  assert.equal(
    proposalPresentation(first, [first, second, other]).earlier,
    true,
  );
  assert.equal(
    proposalPresentation(second, [first, second, other]).earlier,
    false,
  );
  assert.deepEqual(proposalPresentation(second, [first, second]).changed, [
    "Budget",
  ]);
  assert.equal(
    proposalPresentation(first, [
      first,
      { ...second, fields: { ...second.fields, title: "Another outing" } },
    ]).earlier,
    false,
  );
  assert.equal(
    proposalPresentation({ ...first, appliedPlanId: "saved" }, [first, second])
      .latest.id,
    "second",
  );
  assert.equal(proposalSourceId(first), "source-one");
});

test("fresh planning context reads only the current room and records the read", async () => {
  const { currentPlanningContext } = await import(
    "../../src/lib/dinner/agent/planning"
  );
  const calls: string[] = [];
  const facts = { plans: [], hasMore: false };
  const dependencies = {
    readPlans: async (roomId: string) => {
      calls.push(roomId);
      return facts;
    },
    recordTool: async (name: string) => {
      calls.push(name);
    },
  };
  assert.equal(
    await currentPlanningContext({
      ...dependencies,
      scope: { kind: "room", roomId: "this-room" },
    }),
    facts,
  );
  assert.deepEqual(calls, ["this-room", "read_plans"]);
  calls.length = 0;
  assert.equal(
    await currentPlanningContext({
      ...dependencies,
      scope: { kind: "personal" },
    }),
    null,
  );
  assert.deepEqual(calls, []);
});

test("assistant text removes Markdown and repairs app-relative plan links", async () => {
  const { plainAssistantText } = await import(
    "../../src/lib/dinner/agent/plain-text"
  );
  assert.equal(
    plainAssistantText(
      "**Dinner** is set. [Edit](https://app/rooms/abc?view=plan&plan=xyz)",
    ),
    "Dinner is set. /app/rooms/abc?view=plan&plan=xyz",
  );
  assert.equal(
    plainAssistantText("Dinner is $25 each.\nNo booking yet."),
    "Dinner is $25 each. No booking yet.",
  );
});
