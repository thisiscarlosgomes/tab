import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { DinnerService } from "../../src/lib/dinner/service";
import { MongoRoomStore } from "../../src/lib/dinner/mongo-store";
import { Actor, DinnerError, totals } from "../../src/lib/dinner/model";
import { PlanService } from "../../src/lib/dinner/plans/service";
import { PlanView } from "../../src/lib/dinner/plans/model";
import { calendarFile, resolveSlot } from "../../src/lib/dinner/plans/time";
import { handleDinner } from "../../src/lib/dinner/http";
import { Attachments } from "../../src/lib/dinner/attachments";
const alice: Actor = { id: randomUUID(), name: "Alice", twitterSubject: null };
const bob: Actor = { id: randomUUID(), name: "Bob", twitterSubject: null };
const carol: Actor = { id: randomUUID(), name: "Carol", twitterSubject: null };
const outsider: Actor = {
  id: randomUUID(),
  name: "Outsider",
  twitterSubject: null,
};
let mongo: MongoMemoryServer;
let client: MongoClient;
let dinner: DinnerService;
let plans: PlanService;
let roomId: string;
let now: string;
before(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
beforeEach(async () => {
  const db = client.db("plans");
  await db.dropDatabase();
  now = "2030-01-01T00:00:00Z";
  dinner = new DinnerService(new MongoRoomStore(db));
  plans = new PlanService(db, dinner, () => now);
  const r = await dinner.create(alice, {
    clientId: randomUUID(),
    name: "Friends",
    purpose: "Dinner",
  });
  roomId = r.id;
  for (const member of [bob, carol]) {
    const invitation = await dinner.invite(roomId, alice, {
      clientId: randomUUID(),
    });
    await dinner.respond(member, { token: invitation.token }, "accepted");
  }
});
const fields = () => ({
  clientId: randomUUID(),
  title: "Friday dinner",
  participantIds: [alice.id, bob.id],
  timeZone: "Asia/Shanghai",
  location: "Downtown",
  budgetCents: 5000,
  slots: [{ localStart: "2030-01-04T19:00", localEnd: "2030-01-04T21:00" }],
  deadline: "2030-01-03T00:00:00Z",
});
const cmd = (p: PlanView, action: string, extra = {}, actor = alice) =>
  plans.command(actor, roomId, p.id, {
    clientId: randomUUID(),
    action,
    expectedRevision: p.revision,
    ...extra,
  });
async function collecting() {
  const p = await plans.create(alice, roomId, fields());
  return cmd(p, "publish");
}
const terms = {
  localStart: "2030-01-04T19:00",
  localEnd: "2030-01-04T21:00",
  timeZone: "Asia/Shanghai",
  location: "Cafe One",
  budgetCents: 4500,
};
const respond = (p: PlanView, actor: Actor, note = "") =>
  plans.command(actor, roomId, p.id, {
    clientId: randomUUID(),
    action: "respond",
    optionsVersion: p.optionsVersion,
    expectedResponseVersion: 0,
    votes: { [p.slots[0].id]: "works" },
    budget: "works",
    privateNote: note,
  });
const decide = (p: PlanView, actor = alice) =>
  plans.command(actor, roomId, p.id, {
    clientId: randomUUID(),
    action: "decide",
    termsVersion: p.termsVersion,
    expectedDecisionVersion: 0,
    decision: "accepted",
  });
const status = (code: number) => (e: unknown) =>
  e instanceof DinnerError && e.status === code;

test("concurrent responses preserve both members and filter private notes in every projection", async () => {
  const p = await collecting();
  await Promise.all([
    respond(p, alice, "Alice private"),
    respond(p, bob, "Bob private"),
  ]);
  const owner = await plans.get(alice, roomId, p.id);
  assert.equal(owner.responses.length, 2);
  assert(owner.responses.every((r) => r.privateNote));
  const member = await plans.get(bob, roomId, p.id);
  assert.equal(
    member.responses.find((r) => r.userId === alice.id)?.privateNote,
    undefined,
  );
  const observer = await plans.list(carol, roomId);
  assert(observer[0].responses.every((r) => !r.privateNote));
  assert(!JSON.stringify(await plans.attention(bob)).includes("Alice private"));
  await assert.rejects(plans.get(outsider, roomId, p.id), status(404));
  await assert.rejects(respond(p, carol), status(403));
});
test("idempotent retries survive state changes and reject changed payload", async () => {
  const input = fields();
  const p = await plans.create(alice, roomId, input);
  assert.equal((await plans.create(alice, roomId, input)).id, p.id);
  await assert.rejects(
    plans.create(alice, roomId, { ...input, title: "Different" }),
    status(409),
  );
  const command = {
    clientId: randomUUID(),
    action: "publish",
    expectedRevision: p.revision,
  };
  const published = await plans.command(alice, roomId, p.id, command);
  const replay = await plans.command(alice, roomId, p.id, command);
  assert.equal(replay.revision, published.revision);
  await assert.rejects(
    plans.command(alice, roomId, p.id, { ...command, action: "cancel" }),
    status(409),
  );
});
test("approval is separate from availability and material changes invalidate approvals", async () => {
  let p = await collecting();
  p = await respond(p, alice);
  p = await cmd(p, "propose", { terms });
  await assert.rejects(cmd(p, "finalize"), status(409));
  p = await decide(p);
  p = await cmd(p, "finalize");
  assert.deepEqual(p.confirmedIds, [alice.id]);
  const oldVersion = p.termsVersion;
  p = await cmd(p, "propose", { terms: { ...terms, budgetCents: 5500 } });
  assert.equal(p.state, "confirming");
  assert.equal(p.decisions.length, 0);
  assert.equal(p.confirmedIds.length, 0);
  await assert.rejects(
    plans.command(bob, roomId, p.id, {
      clientId: randomUUID(),
      action: "decide",
      termsVersion: oldVersion,
      expectedDecisionVersion: 0,
      decision: "accepted",
    }),
    status(409),
  );
  assert.deepEqual(totals(await dinner.memberRoom(roomId, alice), alice.id), {
    owe: 0,
    owed: 0,
  });
});
test("approval racing a proposal edit cannot approve new terms", async () => {
  let p = await collecting();
  p = await cmd(p, "propose", { terms });
  const results = await Promise.allSettled([
    decide(p, bob),
    cmd(p, "propose", { terms: { ...terms, budgetCents: 6000 } }),
  ]);
  const latest = await plans.get(alice, roomId, p.id);
  assert(results.some((r) => r.status === "fulfilled"));
  if (latest.termsVersion > p.termsVersion)
    assert.equal(latest.decisions.length, 0);
  else assert.equal(latest.terms?.budgetCents, 4500);
});
test("deadline closes responses and reworking invalidates old options", async () => {
  let p = await collecting();
  now = "2030-01-03T01:00:00Z";
  await assert.rejects(respond(p, bob), status(409));
  const old = p;
  p = await cmd(p, "rework", { slots: fields().slots, deadline: null });
  assert.equal(p.optionsVersion, 2);
  await assert.rejects(respond(old, bob), status(409));
  await respond(p, bob);
});
test("only organizer manages lifecycle; completion checks time and history survives cancellation", async () => {
  let p = await collecting();
  await assert.rejects(cmd(p, "cancel", {}, bob), status(403));
  p = await cmd(p, "propose", { terms });
  p = await decide(p);
  p = await cmd(p, "finalize");
  await assert.rejects(cmd(p, "complete"), status(409));
  now = "2030-01-05T00:00:00Z";
  p = await cmd(p, "complete");
  assert.equal(p.state, "completed");
  await assert.rejects(cmd(p, "cancel"), status(409));
});
test("calendar uses stable UID, UTC times, escaped text and no private notes", async () => {
  let p = await collecting();
  assert.throws(() => calendarFile(p), status(409));
  p = await cmd(p, "propose", { terms });
  p = await decide(p);
  p = await cmd(p, "finalize");
  const ics = calendarFile({ ...p, title: "Dinner, friends;\nLOCATION:fake" });
  assert(ics.includes(`UID:${p.id}@tab`));
  assert(ics.includes("DTSTART:20300104T110000Z"));
  assert(ics.includes("Dinner\\, friends\\;\\nLOCATION:fake"));
  assert(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
});
test("time zones reject DST gaps, repeated times, invalid zones and inverted intervals", () => {
  for (const date of ["2030-03-10T02:30", "2030-11-03T01:30"])
    assert.throws(
      () =>
        resolveSlot(
          { localStart: date, localEnd: date.slice(0, 11) + "04:00" },
          "America/New_York",
        ),
      status(400),
    );
  assert.throws(
    () => resolveSlot(fields().slots[0], "not/a-zone"),
    status(400),
  );
  assert.throws(
    () =>
      resolveSlot(
        { localStart: "2030-01-04T21:00", localEnd: "2030-01-04T19:00" },
        "Asia/Shanghai",
      ),
    status(400),
  );
});
test("HTTP rejects spoofed actors and cross-room access; private response data never enters room JSON", async () => {
  const p = await collecting();
  await respond(p, bob, "Private requirement");
  const deps = {
    enabled: true,
    actor: async () => carol,
    service: dinner,
    plans,
    attachments: new Attachments(client.db("plans"), dinner),
  };
  const path = ["rooms", roomId, "plans", p.id];
  const response = await handleDinner(
    new Request("http://localhost"),
    path,
    deps,
  );
  assert.equal(response.status, 200);
  assert(!(await response.text()).includes("Private requirement"));
  const rejected = await handleDinner(
    new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        clientId: randomUUID(),
        action: "cancel",
        expectedRevision: 1,
        actorId: alice.id,
      }),
    }),
    [...path, "commands"],
    deps,
  );
  assert.equal(rejected.status, 400);
  const room = await handleDinner(
    new Request("http://localhost"),
    ["rooms", roomId],
    deps,
  );
  assert(!(await room.text()).includes("Private requirement"));
});

test("private notes can be cleared after cancellation without retaining their text in history", async () => {
  let p = await collecting();
  p = await respond(p, bob, "Remove this private text");
  p = await cmd(p, "cancel");
  p = await plans.command(bob, roomId, p.id, {
    clientId: randomUUID(),
    action: "clear_note",
    expectedResponseVersion: 1,
  });
  assert.equal(p.state, "cancelled");
  assert(!JSON.stringify(p).includes("Remove this private text"));
  assert(
    !JSON.stringify(await plans.get(alice, roomId, p.id)).includes(
      "Remove this private text",
    ),
  );
});

test("stable pagination exposes older plans with tied timestamps, and new members do not join existing plans", async () => {
  const first = await plans.create(alice, roomId, fields());
  await plans.create(alice, roomId, fields());
  const page = await plans.list(alice, roomId);
  const older = await plans.list(alice, roomId, page[0].id);
  assert.equal(older.length, 1);
  assert.equal(older[0].id, page[1].id);
  const invitation = await dinner.invite(roomId, alice, {
    clientId: randomUUID(),
  });
  await dinner.respond(outsider, { token: invitation.token }, "accepted");
  const view = await plans.get(outsider, roomId, first.id);
  assert(!view.participantIds.includes(outsider.id));
  await assert.rejects(plans.list(alice, roomId, randomUUID()), status(404));
});

test("draft edits validate members and retain identity; published drafts cannot be edited", async () => {
  let p = await plans.create(alice, roomId, fields());
  const { clientId: _clientId, ...edited } = {
    ...fields(),
    title: "Saturday lunch",
    participantIds: [alice.id, carol.id],
    budgetCents: 2500,
  };
  await assert.rejects(
    cmd(p, "edit_draft", { fields: edited }, bob),
    status(403),
  );
  await assert.rejects(
    cmd(p, "edit_draft", {
      fields: { ...edited, participantIds: [outsider.id] },
    }),
    status(400),
  );
  const old = p;
  p = await cmd(p, "edit_draft", { fields: edited });
  assert.equal(p.id, old.id);
  assert.equal(p.title, edited.title);
  assert.deepEqual(p.participantIds, edited.participantIds);
  await assert.rejects(cmd(old, "edit_draft", { fields: edited }), status(409));
  p = await cmd(p, "publish");
  await assert.rejects(cmd(p, "edit_draft", { fields: edited }), status(409));
});

test("extending or removing deadline preserves options, private notes and responses", async () => {
  let p = await collecting();
  p = await respond(p, bob, "Keep this note");
  const responses = structuredClone(p.responses);
  const slots = structuredClone(p.slots);
  now = "2030-01-03T01:00:00Z";
  p = await cmd(p, "extend_deadline", { deadline: "2030-01-04T00:00:00Z" });
  assert.deepEqual(p.responses, responses);
  assert.deepEqual(p.slots, slots);
  assert.equal(p.optionsVersion, 1);
  await assert.rejects(
    cmd(p, "extend_deadline", { deadline: "2030-01-03T12:00:00Z" }),
    status(400),
  );
  p = await cmd(p, "extend_deadline", { deadline: null });
  assert.deepEqual(p.responses, responses);
  assert.equal(p.deadline, null);
});

test("adding members preserves availability but reopens final approval for every member", async () => {
  let p = await collecting();
  p = await respond(p, bob);
  p = await cmd(p, "propose", { terms });
  p = await decide(p);
  p = await cmd(p, "finalize");
  await assert.rejects(
    cmd(p, "add_participants", { participantIds: [outsider.id] }),
    status(400),
  );
  const oldVersion = p.termsVersion;
  p = await cmd(p, "add_participants", { participantIds: [carol.id] });
  assert.equal(p.state, "confirming");
  assert.equal(p.termsVersion, oldVersion + 1);
  assert.equal(p.responses.length, 1);
  assert.deepEqual(p.confirmedIds, []);
  assert.deepEqual(p.decisions, []);
  await assert.rejects(cmd(p, "finalize"), status(409));
  p = await decide(p, carol);
  p = await cmd(p, "finalize");
  assert.deepEqual(p.confirmedIds, [carol.id]);
});

test("withdrawal is self-only, versioned and retry safe, retaining the original finalized roster", async () => {
  let p = await collecting();
  p = await cmd(p, "propose", { terms });
  p = await decide(p, bob);
  p = await cmd(p, "finalize");
  const input = {
    clientId: randomUUID(),
    action: "withdraw",
    termsVersion: p.termsVersion,
    expectedDecisionVersion: 1,
  };
  await assert.rejects(plans.command(alice, roomId, p.id, input), status(409));
  p = await plans.command(bob, roomId, p.id, input);
  const replay = await plans.command(bob, roomId, p.id, input);
  assert.equal(p.revision, replay.revision);
  assert.equal(p.state, "confirming");
  assert.deepEqual(p.confirmedIds, []);
  assert.deepEqual(
    p.history.find((h) => h.action === "finalize")?.confirmedIds,
    [bob.id],
  );
  assert.equal(p.history.at(-1)?.action, "withdraw");
});

test("history limits still permit withdrawal, privacy clearing and terminal actions", async () => {
  let p = await collecting();
  p = await respond(p, bob, "Clear after cap");
  p = await cmd(p, "propose", { terms });
  p = await decide(p, bob);
  p = await cmd(p, "finalize");
  await client
    .db("plans")
    .collection("dinner-plans")
    .updateOne(
      { id: p.id },
      {
        $set: {
          history: Array.from({ length: 200 }, () => ({
            id: randomUUID(),
            action: "respond",
            actorId: bob.id,
            at: now,
            termsVersion: 1,
          })),
        },
      },
    );
  await assert.rejects(
    cmd(p, "propose", { terms: { ...terms, budgetCents: 100 } }),
    status(422),
  );
  p = await plans.command(bob, roomId, p.id, {
    clientId: randomUUID(),
    action: "withdraw",
    termsVersion: 1,
    expectedDecisionVersion: 1,
  });
  p = await plans.command(bob, roomId, p.id, {
    clientId: randomUUID(),
    action: "clear_note",
    expectedResponseVersion: 1,
  });
  p = await cmd(p, "cancel");
  assert.equal(p.state, "cancelled");
  let other = await collecting();
  other = await cmd(other, "propose", { terms });
  other = await decide(other);
  other = await cmd(other, "finalize");
  await client
    .db("plans")
    .collection("dinner-plans")
    .updateOne({ id: other.id }, { $set: { history: p.history } });
  now = "2030-01-05T00:00:00Z";
  other = await cmd(other, "complete");
  assert.equal(other.state, "completed");
});

test("Today distinguishes upcoming, ongoing and past outings", async () => {
  const { planAttentionLabel } = await import(
    "../../src/lib/dinner/plans/model"
  );
  let p = await collecting();
  p = await cmd(p, "propose", { terms });
  p = await decide(p);
  p = await cmd(p, "finalize");
  assert.match(
    planAttentionLabel(p, alice.id, Date.parse("2030-01-01")),
    /Upcoming/,
  );
  assert.match(
    planAttentionLabel(p, alice.id, Date.parse("2030-01-04T12:00:00Z")),
    /Happening now/,
  );
  assert.match(
    planAttentionLabel(p, alice.id, Date.parse("2030-01-05")),
    /Past outing · mark complete/,
  );
  assert.match(
    planAttentionLabel(p, bob.id, Date.parse("2030-01-05")),
    /awaiting organizer/,
  );
});

test("conversation feed projects durable published events and excludes all private notes and draft edits", async () => {
  const draft = await plans.create(alice, roomId, fields());
  assert.deepEqual((await plans.conversation(alice, roomId)).plans, []);
  await cmd(draft, "cancel");
  let p = await collecting();
  p = await respond(p, bob, "Never send this into conversation");
  p = await cmd(p, "propose", { terms });
  p = await decide(p, bob);
  p = await cmd(p, "finalize");
  p = await plans.command(bob, roomId, p.id, {
    clientId: randomUUID(),
    action: "withdraw",
    termsVersion: p.termsVersion,
    expectedDecisionVersion: 1,
  });
  const first = await plans.conversation(alice, roomId);
  const second = await plans.conversation(carol, roomId);
  assert.deepEqual(first, second);
  assert.equal(first.plans.length, 1);
  assert.deepEqual(
    first.events.map((e) => e.action),
    ["withdraw", "finalize", "propose", "publish"],
  );
  assert(!JSON.stringify(first).includes("Never send"));
  assert(!JSON.stringify(first).includes("privateNote"));
  assert(!JSON.stringify(first).includes("requests"));
  assert.equal(
    new Set(first.events.map((e) => e.id)).size,
    first.events.length,
  );
  await assert.rejects(plans.conversation(outsider, roomId), status(404));
  const deps = {
    enabled: true,
    actor: async () => bob,
    service: dinner,
    plans,
    attachments: new Attachments(client.db("plans"), dinner),
  };
  const response = await handleDinner(
    new Request("http://localhost"),
    ["rooms", roomId, "plan-feed"],
    deps,
  );
  assert.equal(response.status, 200);
  assert(!JSON.stringify(await response.json()).includes("privateNote"));
});

test("conversation pagination handles identical timestamps without duplicates and survives new updates", async () => {
  let p = await collecting();
  for (let i = 0; i < 55; i++)
    p = await cmd(p, "rework", { slots: fields().slots, deadline: null });
  const first = await plans.conversation(alice, roomId);
  assert.equal(first.events.length, 50);
  assert(first.nextCursor);
  p = await cmd(p, "cancel");
  const older = await plans.conversation(alice, roomId, first.nextCursor!);
  assert.equal(older.events.length, 6);
  assert.equal(older.nextCursor, null);
  assert.equal(
    new Set([...first.events, ...older.events].map((e) => e.id)).size,
    56,
  );
  assert.equal(
    (await plans.conversation(alice, roomId)).events[0].action,
    "cancel",
  );
  await assert.rejects(
    plans.conversation(alice, roomId, "invalid"),
    status(400),
  );
});

test("conversation cards use current state for each viewer's next action", async () => {
  const { planAction } = await import(
    "../../src/lib/dinner/plans/conversation"
  );
  let p = await collecting();
  let summary = (await plans.conversation(alice, roomId)).plans[0];
  assert.equal(planAction(summary, bob.id, Date.parse(now)), "Respond");
  assert.equal(planAction(summary, carol.id, Date.parse(now)), "View details");
  p = await respond(p, bob);
  summary = (await plans.conversation(alice, roomId)).plans[0];
  assert.equal(planAction(summary, bob.id, Date.parse(now)), "Edit response");
  p = await cmd(p, "propose", { terms });
  summary = (await plans.conversation(alice, roomId)).plans[0];
  assert.equal(planAction(summary, bob.id), "Confirm");
  p = await decide(p, bob);
  summary = (await plans.conversation(alice, roomId)).plans[0];
  assert.equal(planAction(summary, bob.id), "View details");
  p = await cmd(p, "cancel");
  summary = (await plans.conversation(alice, roomId)).plans[0];
  assert.equal(planAction(summary, bob.id), "View details");
});

test("completed outing expense is reviewed, linked, replay safe and creates no obligations until confirmation", async () => {
  let p = await collecting();
  const bill = {
    clientId: randomUUID(),
    description: "Actual dinner bill",
    payerId: alice.id,
    totalCents: 1001,
    shares: [
      { userId: alice.id, cents: 501 },
      { userId: bob.id, cents: 500 },
    ],
  };
  await assert.rejects(
    plans.expenseDraft(alice, roomId, p.id, bill),
    status(409),
  );
  p = await cmd(p, "propose", { terms });
  await decide(p, alice);
  p = await decide(p, bob);
  p = await cmd(p, "finalize");
  now = "2030-01-05T00:00:00Z";
  p = await cmd(p, "complete");
  await assert.rejects(
    plans.expenseDraft(outsider, roomId, p.id, bill),
    status(404),
  );
  await assert.rejects(
    plans.expenseDraft(alice, roomId, randomUUID(), bill),
    status(404),
  );
  await assert.rejects(
    plans.expenseDraft(alice, roomId, p.id, { ...bill, totalCents: undefined }),
  );
  const [a, b] = await Promise.all([
    plans.expenseDraft(alice, roomId, p.id, bill),
    plans.expenseDraft(alice, roomId, p.id, bill),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(a.status, "draft");
  assert.equal(a.sourcePlanId, p.id);
  assert.equal(a.totalCents, 1001);
  assert.notEqual(a.totalCents, p.budgetCents);
  assert.equal((await dinner.memberRoom(roomId, alice)).expenses.length, 1);
  assert.equal(totals(await dinner.memberRoom(roomId, bob), bob.id).owe, 0);
  await assert.rejects(
    plans.expenseDraft(bob, roomId, p.id, { ...bill, clientId: randomUUID() }),
    status(409),
  );
  await assert.rejects(
    plans.expenseDraft(alice, roomId, p.id, {
      ...bill,
      description: "Changed retry",
    }),
    status(409),
  );
  const edited = await dinner.draft(
    roomId,
    alice,
    { ...bill, description: "Reviewed bill" },
    a.id,
  );
  assert.equal(edited.sourcePlanId, p.id);
  await dinner.confirm(roomId, alice, edited.id, randomUUID(), edited.version);
  assert.equal(totals(await dinner.memberRoom(roomId, bob), bob.id).owe, 500);
  assert.equal((await plans.get(alice, roomId, p.id)).state, "completed");
});

test("two members racing to save an outing bill create one linked expense", async () => {
  let p = await collecting();
  p = await cmd(p, "propose", { terms });
  p = await decide(p, alice);
  p = await cmd(p, "finalize");
  now = "2030-01-05T00:00:00Z";
  p = await cmd(p, "complete");
  const results = await Promise.allSettled(
    [alice, bob].map((actor) =>
      plans.expenseDraft(actor, roomId, p.id, {
        clientId: randomUUID(),
        description: "One bill",
        payerId: alice.id,
        totalCents: 1000,
        shares: [
          { userId: alice.id, cents: 500 },
          { userId: bob.id, cents: 500 },
        ],
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const failure = results.find((r) => r.status === "rejected");
  assert.ok(failure?.status === "rejected" && status(409)(failure.reason));
  assert.equal((await dinner.memberRoom(roomId, alice)).expenses.length, 1);
});

test("last current-terms acceptance automatically locks the outing once and edits reopen consent", async () => {
  let p = await collecting();
  p = await cmd(p, "propose", { terms });
  p = await decide(p, alice);
  assert.equal(p.state, "confirming");
  const input = {
    clientId: randomUUID(),
    action: "decide",
    termsVersion: p.termsVersion,
    expectedDecisionVersion: 0,
    decision: "accepted",
  };
  const [a, b] = await Promise.all([
    plans.command(bob, roomId, p.id, input),
    plans.command(bob, roomId, p.id, input),
  ]);
  assert.equal(a.state, "confirmed");
  assert.equal(a.revision, b.revision);
  assert.deepEqual(a.confirmedIds, [alice.id, bob.id]);
  assert.equal(a.history.filter((h) => h.action === "auto_finalize").length, 1);
  assert.equal(a.history.at(-1)?.decision, "accepted");
  const feed = await plans.conversation(bob, roomId);
  assert.equal(
    feed.events.filter((e) => e.action === "auto_finalize").length,
    1,
  );
  p = await cmd(a, "propose", {
    terms: { ...terms, location: "Another cafe" },
  });
  assert.equal(p.state, "confirming");
  assert.equal(p.decisions.length, 0);
  assert.equal(p.confirmedIds.length, 0);
});

test("chat opt-out, negotiation and organizer go-ahead preserve individual consent", async () => {
  const { DinnerAgentService } = await import(
    "../../src/lib/dinner/agent/service"
  );
  now = new Date().toISOString();
  let p = await cmd(await collecting(), "propose", { terms });
  p = await decide(p, alice);
  const agent = new DinnerAgentService(client.db("plans"), dinner, async () => {
    throw new Error("These commands must not need a model");
  });
  const say = async (actor: Actor, text: string) => {
    const m = await dinner.send(roomId, actor, {
      clientId: randomUUID(),
      text,
    });
    return {
      m,
      result: await agent.respond(actor, { kind: "room", roomId }, m.id),
    };
  };
  await say(bob, "@Tab can we do later?");
  assert.equal((await plans.get(alice, roomId, p.id)).decisions.length, 1);
  await say(bob, "@Tab go ahead");
  assert.equal((await plans.get(alice, roomId, p.id)).state, "confirming");
  const optout = await say(bob, "@Tab go ahead without me");
  await agent.respond(bob, { kind: "room", roomId }, optout.m.id);
  p = await plans.get(alice, roomId, p.id);
  assert.equal(
    p.decisions.find((d) => d.userId === bob.id)?.decision,
    "declined",
  );
  const done = await say(alice, "@Tab yes, go ahead");
  await agent.respond(alice, { kind: "room", roomId }, done.m.id);
  p = await plans.get(alice, roomId, p.id);
  assert.equal(p.state, "confirmed");
  assert.deepEqual(p.confirmedIds, [alice.id]);
  assert.equal(p.history.filter((h) => h.action === "finalize").length, 1);
  assert.equal((await dinner.memberRoom(roomId, bob)).members.length, 3);
  assert.equal((await dinner.memberRoom(roomId, bob)).expenses.length, 0);
});

test("chat parser does not turn conditions, quotations, or third-party claims into consent", async () => {
  const { planChatIntent } = await import(
    "../../src/lib/dinner/agent/plan-chat-intent"
  );
  for (const text of [
    "@Tab if Nina agrees go ahead",
    "@Tab Maya says go ahead without me",
    '@Tab "go ahead without me"',
    "@Tab don't go ahead",
    "@Tab yes",
  ])
    assert.equal(planChatIntent(text), null);
  assert.equal(planChatIntent("@Tab I'm not going"), "opt_out");
});

test("chat withdrawal after lock keeps the other attendees and terms, including on retry", async () => {
  const { DinnerAgentService } = await import(
    "../../src/lib/dinner/agent/service"
  );
  now = new Date().toISOString();
  let p = await plans.create(alice, roomId, {
    ...fields(),
    participantIds: [alice.id, bob.id, carol.id],
  });
  p = await cmd(p, "publish");
  p = await cmd(p, "propose", { terms });
  p = await decide(p, alice);
  p = await decide(p, bob);
  p = await decide(p, carol);
  assert.equal(p.state, "confirmed");
  const before = p;
  const agent = new DinnerAgentService(client.db("plans"), dinner, async () => {
    throw new Error("No model required");
  });
  const m = await dinner.send(roomId, bob, {
    clientId: randomUUID(),
    text: "@Tab I can't make it",
  });
  await agent.respond(bob, { kind: "room", roomId }, m.id);
  await agent.respond(bob, { kind: "room", roomId }, m.id);
  p = await plans.get(alice, roomId, p.id);
  assert.equal(p.state, "confirmed");
  assert.deepEqual(p.confirmedIds, [alice.id, carol.id]);
  assert.deepEqual(p.terms, before.terms);
  assert.equal(p.termsVersion, before.termsVersion);
  assert.equal(p.history.filter((h) => h.action === "withdraw").length, 1);
  assert.equal((await dinner.memberRoom(roomId, bob)).members.length, 3);
});

test("rejoining requires own current consent and organizer approval without reopening others", async () => {
  const { DinnerAgentService } = await import(
    "../../src/lib/dinner/agent/service"
  );
  now = new Date().toISOString();
  let p = await cmd(await collecting(), "propose", { terms });
  p = await decide(p, alice);
  p = await decide(p, bob);
  const agent = new DinnerAgentService(client.db("plans"), dinner, async () => {
    throw new Error("No model required");
  });
  const say = async (actor: Actor, text: string) => {
    const m = await dinner.send(roomId, actor, {
      clientId: randomUUID(),
      text,
    });
    await agent.respond(actor, { kind: "room", roomId }, m.id);
    return m;
  };
  await say(bob, "@Tab I can't make it");
  const request = await say(bob, "@Tab I want to rejoin");
  await agent.respond(bob, { kind: "room", roomId }, request.id);
  p = await plans.get(alice, roomId, p.id);
  assert.equal(p.state, "confirmed");
  assert.deepEqual(p.confirmedIds, [alice.id]);
  assert.equal(
    p.decisions.find((d) => d.userId === bob.id)?.decision,
    "accepted",
  );
  await say(bob, "@Tab go ahead");
  assert.deepEqual((await plans.get(alice, roomId, p.id)).confirmedIds, [
    alice.id,
  ]);
  const approval = await say(alice, "@Tab go ahead");
  await agent.respond(alice, { kind: "room", roomId }, approval.id);
  p = await plans.get(alice, roomId, p.id);
  assert.deepEqual(p.confirmedIds, [alice.id, bob.id]);
  assert.equal(p.termsVersion, 1);
  assert.equal(
    p.history.filter((h) => h.action === "request_rejoin").length,
    1,
  );
  assert.equal(
    p.history.filter((h) => h.action === "approve_rejoins").length,
    1,
  );
  // A pending rejoin can be withdrawn without later approval silently adding them.
  await say(bob, "@Tab I can't make it");
  await say(bob, "@Tab I want to rejoin");
  await say(bob, "@Tab count me out");
  await say(alice, "@Tab go ahead");
  assert.deepEqual((await plans.get(alice, roomId, p.id)).confirmedIds, [
    alice.id,
  ]);
});

test("rejoin commands reject stale terms, outsiders, and non-organizer approval", async () => {
  let p = await cmd(await collecting(), "propose", { terms });
  p = await decide(p, alice);
  p = await decide(p, bob);
  p = await plans.command(bob, roomId, p.id, {
    action: "withdraw",
    clientId: randomUUID(),
    termsVersion: p.termsVersion,
    expectedDecisionVersion: 1,
  });
  await assert.rejects(
    plans.command(bob, roomId, p.id, {
      action: "request_rejoin",
      clientId: randomUUID(),
      termsVersion: 99,
      expectedDecisionVersion: 2,
    }),
    status(409),
  );
  await assert.rejects(
    plans.command(carol, roomId, p.id, {
      action: "request_rejoin",
      clientId: randomUUID(),
      termsVersion: 1,
      expectedDecisionVersion: 0,
    }),
    status(403),
  );
  await assert.rejects(
    plans.command(bob, roomId, p.id, {
      action: "approve_rejoins",
      clientId: randomUUID(),
      expectedRevision: p.revision,
    }),
    status(403),
  );
});

test("two active plans require explicit targeting and never mutate the other plan", async () => {
  const { DinnerAgentService } = await import(
    "../../src/lib/dinner/agent/service"
  );
  now = new Date().toISOString();
  const make = async (title: string) => {
    let p = await plans.create(alice, roomId, { ...fields(), title });
    p = await cmd(p, "publish");
    p = await cmd(p, "propose", { terms });
    return decide(p, bob);
  };
  const a = await make("Friday dinner"),
    b = await make("Saturday lunch");
  const agent = new DinnerAgentService(client.db("plans"), dinner, async () => {
    throw new Error("Expected explicit action");
  }, undefined, undefined, async () => {
    throw new Error("Explicit planning commands must bypass bill routing");
  });
  const say = async (actor: Actor, text: string, replyTo?: string) => {
    const m = await dinner.send(roomId, actor, {
      clientId: randomUUID(),
      text,
      ...(replyTo ? { replyTo } : {}),
    });
    return agent.respond(actor, { kind: "room", roomId }, m.id);
  };
  const ambiguous = await say(alice, "@Tab go ahead");
  assert.match(ambiguous.text, /Which plan/);
  assert.equal((await plans.get(alice, roomId, a.id)).revision, a.revision);
  assert.equal((await plans.get(alice, roomId, b.id)).revision, b.revision);
  await say(bob, "@Tab go ahead for Friday dinner");
  assert.equal((await plans.get(alice, roomId, a.id)).state, "confirming");
  await say(alice, "@Tab go ahead for Friday dinner");
  assert.equal((await plans.get(alice, roomId, a.id)).state, "confirmed");
  assert.equal((await plans.get(alice, roomId, b.id)).revision, b.revision);
  const linked = await dinner.send(roomId, alice, {
    clientId: randomUUID(),
    text: `Lunch details /app/rooms/${roomId}?view=plan&plan=${b.id}`,
  });
  await say(alice, "@Tab go ahead", linked.id);
  assert.equal((await plans.get(alice, roomId, b.id)).state, "confirmed");
  const beforeA = await plans.get(alice, roomId, a.id);
  await say(bob, "@Tab I can't make it", linked.id);
  assert.equal(
    (await plans.get(alice, roomId, a.id)).revision,
    beforeA.revision,
  );
  assert.deepEqual((await plans.get(alice, roomId, b.id)).confirmedIds, []);
});

test("target resolver refuses duplicate names and conflicting or cross-room links", async () => {
  const { planChatTarget } = await import(
    "../../src/lib/dinner/agent/plan-chat-target"
  );
  const a = { id: randomUUID(), title: "Dinner" },
    b = { id: randomUUID(), title: "Dinner" };
  const duplicate = planChatTarget("@Tab go ahead for Dinner", roomId, [a, b]);
  assert.equal(duplicate?.ids.length, 2);
  const foreign = planChatTarget(
    "@Tab go ahead",
    roomId,
    [a],
    `/app/rooms/${randomUUID()}?view=plan&plan=${a.id}`,
  );
  assert.equal(foreign?.invalid, true);
  const mismatch = planChatTarget(
    "@Tab go ahead for Dinner",
    roomId,
    [a, { ...b, title: "Lunch" }],
    `/app/rooms/${roomId}?view=plan&plan=${b.id}`,
  );
  assert.equal(mismatch?.invalid, true);
  assert.equal(
    planChatTarget("@Tab if Nina agrees go ahead for Dinner", roomId, [a]),
    null,
  );
});
