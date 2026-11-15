import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { MongoClient, Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  Actor,
  DinnerError,
  totals,
  roomView,
} from "../../src/lib/dinner/model";
import { DinnerService } from "../../src/lib/dinner/service";
import { MongoRoomStore } from "../../src/lib/dinner/mongo-store";
import { Attachments } from "../../src/lib/dinner/attachments";
import { handleDinner } from "../../src/lib/dinner/http";
import {
  DinnerAgentService,
  walletProjection,
} from "../../src/lib/dinner/agent/service";
import { AgentRunner } from "../../src/lib/dinner/agent/capabilities";
import {
  mentionsTab,
  normalizePreparation,
  prepareToolInput,
  TAB_BOT_ID,
  agentViewSchema,
  proposalSchema,
} from "../../src/lib/dinner/agent/model";
import { messageSchema } from "../../src/lib/dinner/client-schema";
import { loadSkill, skillCatalog } from "../../src/lib/dinner/agent/skills";
import { memberSummary } from "../../src/lib/dinner/agent/room-tools";
let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let dinner: DinnerService;
const alice: Actor = {
  id: randomUUID(),
  name: "Alice",
  twitterSubject: "1001",
};
const bob: Actor = { id: randomUUID(), name: "Bob", twitterSubject: "1002" };
const carol: Actor = {
  id: randomUUID(),
  name: "Carol",
  twitterSubject: "1003",
};
before(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db("agent-tests");
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  dinner = new DinnerService(new MongoRoomStore(db));
  await dinner.list(alice);
});
async function room(owner = alice) {
  const created = await dinner.create(owner, {
    name: "Friday Dinner",
    purpose: "Dinner with friends",
    clientId: randomUUID(),
  });
  return dinner.setAssistance(created.id, owner, "mentions");
}
async function joined() {
  const r = await room();
  const i = await dinner.invite(r.id, alice, { clientId: randomUUID() });
  await dinner.respond(bob, { token: i.token }, "accepted");
  return dinner.memberRoom(r.id, alice);
}
function agent(
  runner: AgentRunner = async () => "Verified summary; nothing paid.",
) {
  return new DinnerAgentService(db, dinner, runner, async () => ({
    merchant: null,
    totalAmount: null,
    currency: null,
    items: [],
    confidence: 0,
  }));
}
const denied = (e: unknown) =>
  e instanceof DinnerError && (e.status === 404 || e.status === 403);
async function http(
  service: DinnerAgentService,
  actor: Actor | null,
  path: string,
  method = "GET",
  body?: unknown,
) {
  return handleDinner(
    new Request(`http://localhost/api/dinner${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split("/").filter(Boolean),
    {
      enabled: true,
      actor: async () =>
        actor ??
        (() => {
          throw new DinnerError(401, "Sign in");
        })(),
      service: dinner,
      attachments: new Attachments(db, dinner),
      agent: service,
    },
  );
}
async function addressed(
  roomId: string,
  actor = alice,
  text = "@Tab who owes whom?",
) {
  return dinner.send(roomId, actor, { clientId: randomUUID(), text });
}
function expense(roomId: string) {
  return {
    roomId,
    description: "Noodles",
    payerId: alice.id,
    totalCents: 2001,
    shares: [
      { userId: alice.id, cents: 1001 },
      { userId: bob.id, cents: 1000 },
    ],
  };
}

test("mention parser recognizes tags, not ordinary tab, handles, emails or URL fragments", () => {
  for (const text of [
    "@Tab status",
    "Hi @tab!",
    "(@TAB) split this",
    "@Tab.",
    "please @Tab: help",
  ])
    assert.equal(mentionsTab(text), true, text);
  for (const text of [
    "check the tab",
    "tablet",
    "@table",
    "me@tab.com",
    "https://host/@tab",
    "@tab.example.com",
    "hello tab",
    "tab@example.com",
  ])
    assert.equal(mentionsTab(text), false, text);
});
test("ordinary conversation neither calls a model nor accepts a forced bot-response request", async () => {
  const r = await room();
  let calls = 0;
  const service = agent(async () => {
    calls++;
    return "wrong";
  });
  const message = await addressed(r.id, alice, "We should book dinner.");
  assert.equal(calls, 0);
  const response = await http(service, alice, `/rooms/${r.id}/bot`, "POST", {
    messageId: message.id,
  });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  assert.equal((await dinner.memberRoom(r.id, alice)).messages.length, 1);
});
test("addressed replies persist through DinnerService as a distinct bot, never a member impersonation", async () => {
  const r = await joined();
  const service = agent();
  const source = await addressed(r.id);
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  const saved = await dinner.memberRoom(r.id, bob);
  const reply = saved.messages[1];
  assert.equal(reply.kind, "tab");
  assert.equal(reply.authorId, TAB_BOT_ID);
  assert.equal(reply.replyTo, source.id);
  assert.equal(reply.seq, 2);
  if (reply.kind !== "tab") return assert.fail();
  assert.equal(reply.requestedBy, alice.id);
  assert.equal(saved.members.length, 2);
  messageSchema.parse(reply);
  await assert.rejects(dinner.memberRoom(r.id, carol), denied);
});
test("bot retry and refresh/restart produce exactly one reply", async () => {
  const r = await room();
  let calls = 0;
  const runner: AgentRunner = async () => {
    calls++;
    return "One reply";
  };
  const service = agent(runner);
  const source = await addressed(r.id);
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  await agent(runner).respond(alice, { kind: "room", roomId: r.id }, source.id);
  assert.equal(calls, 1);
  assert.equal((await dinner.memberRoom(r.id, alice)).messages.length, 2);
});
test("parallel response requests share one leased run and one persisted reply", async () => {
  const r = await room();
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const service = agent(async () => {
    entered?.();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return "Done";
  });
  const source = await addressed(r.id);
  const first = service.respond(
    alice,
    { kind: "room", roomId: r.id },
    source.id,
  );
  await started;
  assert.equal(
    (await service.respond(alice, { kind: "room", roomId: r.id }, source.id))
      .status,
    "running",
  );
  release?.();
  await first;
  assert.equal((await dinner.memberRoom(r.id, alice)).messages.length, 2);
});
test("another member cannot invoke a bot as the original requester or forge bot message fields", async () => {
  const r = await joined();
  const service = agent();
  const source = await addressed(r.id);
  await assert.rejects(
    service.respond(bob, { kind: "room", roomId: r.id }, source.id),
    denied,
  );
  assert.equal(
    (
      await http(service, alice, `/rooms/${r.id}/messages`, "POST", {
        clientId: randomUUID(),
        text: "Paid",
        kind: "tab",
        authorId: TAB_BOT_ID,
      })
    ).status,
    400,
  );
});
test("non-members and unauthenticated users cannot read agent room notes, proposals or request replies", async () => {
  const r = await room();
  const service = agent();
  const source = await addressed(r.id);
  for (const path of ["memory", "agreements", "proposals"])
    assert.equal(
      (await http(service, bob, `/rooms/${r.id}/${path}`)).status,
      404,
    );
  assert.equal(
    (
      await http(service, null, `/rooms/${r.id}/bot`, "POST", {
        messageId: source.id,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await http(service, bob, `/rooms/${r.id}/bot`, "POST", {
        messageId: source.id,
      })
    ).status,
    404,
  );
});
test("personal conversations are durable, owner-scoped and retry-safe across concurrent devices", async () => {
  const service = agent();
  const input = { clientId: randomUUID(), text: "What do I owe?" };
  const [a, b] = await Promise.all([
    service.personalSend(alice, input),
    service.personalSend(alice, input),
  ]);
  assert.equal(a.id, b.id);
  await service.respond(alice, { kind: "personal" }, a.id);
  const saved = await agent().session(alice);
  agentViewSchema.parse(saved);
  assert.equal(saved.messages.length, 2);
  assert.equal((await service.session(bob)).messages.length, 0);
  await assert.rejects(
    service.respond(bob, { kind: "personal" }, a.id),
    denied,
  );
  await assert.rejects(
    service.personalSend(alice, { ...input, text: "Changed" }),
    (e: unknown) => e instanceof DinnerError && e.status === 409,
  );
});
test("personal agent session body/query cannot select another user or financial actor", async () => {
  const service = agent();
  await service.personalSend(bob, {
    clientId: randomUUID(),
    text: "Bob private",
  });
  const result = await http(service, alice, "/agent/session");
  assert.equal(agentViewSchema.parse(await result.json()).messages.length, 0);
  assert.equal(
    (
      await http(service, alice, "/agent/messages", "POST", {
        clientId: randomUUID(),
        text: "hello",
        userId: bob.id,
      })
    ).status,
    400,
  );
  assert.equal((await http(service, null, "/agent/session")).status, 401);
});
test("room agent never receives personal memory or gains cross-room tool access", async () => {
  const r = await room();
  const other = await room();
  let checked = false;
  const service = agent(async (context) => {
    assert.equal(context.memory, "Use a short recap");
    assert.equal(context.agreements, "Budget is a plan, not permission");
    assert.equal(JSON.stringify(context).includes("PRIVATE PREFERENCE"), false);
    await assert.rejects(context.readRoom(other.id), denied);
    const facts = JSON.stringify(await context.readContext());
    assert.ok(facts.includes(r.id));
    assert.equal(facts.includes(other.id), false);
    assert.equal("confirm" in context, false);
    assert.equal("sendMoney" in context, false);
    checked = true;
    return "Scoped";
  });
  await service.saveNote(alice, { kind: "personal" }, "memory", {
    text: "PRIVATE PREFERENCE",
    expectedVersion: 0,
    clientId: randomUUID(),
  });
  await service.saveNote(alice, { kind: "room", roomId: r.id }, "memory", {
    text: "Use a short recap",
    expectedVersion: 0,
    clientId: randomUUID(),
  });
  await service.saveNote(alice, { kind: "room", roomId: r.id }, "agreements", {
    text: "Budget is a plan, not permission",
    expectedVersion: 0,
    clientId: randomUUID(),
  });
  const source = await addressed(r.id);
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  assert.equal(checked, true);
});
test("personal memory is explicit, editable and removable without retaining the old preference text", async () => {
  const service = agent();
  const key = randomUUID();
  const note = await service.saveNote(alice, { kind: "personal" }, "memory", {
    text: "Prefer brief replies",
    expectedVersion: 0,
    clientId: key,
  });
  assert.equal(
    (await service.note(bob, { kind: "personal" }, "memory")).value.text,
    "",
  );
  assert.equal(
    (
      await service.saveNote(alice, { kind: "personal" }, "memory", {
        text: note.text,
        expectedVersion: 0,
        clientId: key,
      })
    ).version,
    1,
  );
  const removed = await service.saveNote(
    alice,
    { kind: "personal" },
    "memory",
    { text: "", expectedVersion: 1, clientId: randomUUID() },
  );
  assert.equal(removed.text, "");
  assert.deepEqual(removed.history, []);
});
test("shared agreements preserve versions and reject stale edits without overwriting", async () => {
  const r = await joined();
  const service = agent();
  await service.saveNote(alice, { kind: "room", roomId: r.id }, "agreements", {
    text: "Dinner Friday",
    expectedVersion: 0,
    clientId: randomUUID(),
  });
  await assert.rejects(
    service.saveNote(bob, { kind: "room", roomId: r.id }, "agreements", {
      text: "Wrong stale edit",
      expectedVersion: 0,
      clientId: randomUUID(),
    }),
    (e: unknown) => e instanceof DinnerError && e.status === 409,
  );
  const note = await service.saveNote(
    bob,
    { kind: "room", roomId: r.id },
    "agreements",
    { text: "Dinner Saturday", expectedVersion: 1, clientId: randomUUID() },
  );
  assert.equal(note.version, 2);
  assert.equal(note.history.at(-1)?.text, "Dinner Friday");
  assert.equal(note.updatedBy, bob.id);
  await assert.rejects(
    service.note(carol, { kind: "room", roomId: r.id }, "agreements"),
    denied,
  );
});
test("typed expense preparation creates only a proposal until its human owner saves an editable draft", async () => {
  const r = await joined();
  let proposalId = "";
  const service = agent(async (context) => {
    const proposal = await context.prepareExpense(expense(r.id));
    proposalSchema.parse(proposal);
    assert.ok("id" in proposal);
    proposalId = proposal.id;
    await context.recordTool(
      "prepare_expense",
      "room-prepare",
      "review_proposal",
    );
    return "Review the proposal";
  });
  const source = await addressed(r.id, alice, "@Tab split $20.01 equally between everyone. I paid.");
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  assert.equal((await dinner.memberRoom(r.id, alice)).expenses.length, 0);
  const proposals = await service.roomProposals(bob, r.id);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].fields.totalCents, 2001);
  await assert.rejects(service.applyProposal(bob, proposalId), denied);
  const [a, b] = await Promise.all([
    service.applyProposal(alice, proposalId),
    service.applyProposal(alice, proposalId),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(a.status, "draft");
  const saved = await dinner.memberRoom(r.id, alice);
  assert.equal(saved.expenses.length, 1);
  assert.deepEqual(totals(saved, bob.id), { owe: 0, owed: 0 });
  assert.ok(
    (await db.collection("dinner-agent-runs").findOne({}))?.tools.length,
  );
});
test("personal expense proposals stay private until human save, not leaked into room proposal feeds", async () => {
  const r = await joined();
  const service = agent(async (context) => {
    await context.prepareExpense(expense(r.id));
    return "Prepared privately";
  });
  const source = await service.personalSend(alice, {
    clientId: randomUUID(),
    text: "Prepare dinner",
  });
  await service.respond(alice, { kind: "personal" }, source.id);
  assert.equal((await service.session(alice)).proposals.length, 1);
  assert.equal((await service.roomProposals(bob, r.id)).length, 0);
  assert.equal((await service.session(bob)).proposals.length, 0);
});
test("preparation cannot include nonmembers, fractional shares, bad totals or guessed receipt IDs", async () => {
  const r = await joined();
  let checked = 0;
  const service = agent(async (context) => {
    for (const input of [
      { ...expense(r.id), payerId: carol.id },
      { ...expense(r.id), totalCents: 2002 },
      { ...expense(r.id), shares: [{ userId: bob.id, cents: 0.1 }] },
      { ...expense(r.id), attachmentId: randomUUID() },
    ]) {
      await assert.rejects(context.prepareExpense(input));
      checked++;
    }
    return "No invalid drafts";
  });
  const source = await addressed(r.id);
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  assert.equal(checked, 4);
  assert.equal((await service.roomProposals(alice, r.id)).length, 0);
});
test("a room model cannot prepare another room even when the requester belongs to both", async () => {
  const r = await joined();
  const other = await room();
  const service = agent(async (context) => {
    await assert.rejects(context.prepareExpense(expense(other.id)), denied);
    return "Not allowed";
  });
  const source = await addressed(r.id);
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  assert.equal((await dinner.memberRoom(other.id, alice)).expenses.length, 0);
});
test("model failure leaves member messages saved and retryable without false bot success", async () => {
  const r = await room();
  const source = await addressed(r.id);
  const failed = agent(async () => {
    throw new Error("Provider unavailable");
  });
  await assert.rejects(
    failed.respond(alice, { kind: "room", roomId: r.id }, source.id),
    (e: unknown) => e instanceof DinnerError && e.status === 503,
  );
  assert.equal((await dinner.memberRoom(r.id, alice)).messages.length, 1);
  await agent().respond(alice, { kind: "room", roomId: r.id }, source.id);
  assert.equal((await dinner.memberRoom(r.id, alice)).messages.length, 2);
});
test("wallet projects obligations and pending reports, never borrowed or reported money as available cash", async () => {
  const r = await joined();
  const { roomId, ...draftFields } = expense(r.id);
  const d = await dinner.draft(roomId, alice, {
    ...draftFields,
    clientId: randomUUID(),
  });
  const e = await dinner.confirm(r.id, alice, d.id, randomUUID(), d.version);
  if (e.status !== "confirmed") return assert.fail();
  const report = await dinner.reportOutside(
    r.id,
    bob,
    e.obligations[0].id,
    randomUUID(),
  );
  const view = walletProjection(
    [roomView(await dinner.memberRoom(r.id, bob))],
    bob.id,
  );
  assert.equal(view.availableUsdCents, null);
  assert.equal(view.owe, 1000);
  assert.equal(view.pending.length, 1);
  assert.equal(view.pending[0].needsConfirmation, false);
  assert.equal((await agent().wallet(alice)).owed, 1000);
  assert.equal((await agent().wallet(carol)).balances.length, 0);
  await dinner.resolveOutside(
    r.id,
    alice,
    e.obligations[0].id,
    report.id,
    "confirmed",
    randomUUID(),
  );
  assert.equal((await agent().wallet(bob)).owe, 0);
  assert.equal((await agent().wallet(bob)).availableUsdCents, null);
});
test("private reminders are durable, owner-only, replay-safe and dismissible without push or financial effects", async () => {
  const r = await joined();
  const service = agent();
  const input = {
    roomId: r.id,
    text: "Review my share",
    clientId: randomUUID(),
    dueAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const [a, b] = await Promise.all([
    service.remind(alice, input),
    service.remind(alice, input),
  ]);
  assert.equal(a.id, b.id);
  assert.equal((await agent().reminders(alice)).length, 1);
  assert.equal((await service.reminders(bob)).length, 0);
  await assert.rejects(service.dismiss(bob, a.id), denied);
  await service.dismiss(alice, a.id);
  await service.dismiss(alice, a.id);
  assert.equal((await service.reminders(alice)).length, 0);
  assert.equal((await dinner.memberRoom(r.id, alice)).expenses.length, 0);
});
test("reminders reject past times, foreign rooms and body-supplied reminder ownership", async () => {
  const r = await room();
  const service = agent();
  const fields = {
    roomId: r.id,
    text: "Review",
    clientId: randomUUID(),
    dueAt: new Date(Date.now() - 1000).toISOString(),
  };
  await assert.rejects(service.remind(alice, fields));
  await assert.rejects(
    service.remind(bob, {
      ...fields,
      dueAt: new Date(Date.now() + 3600000).toISOString(),
    }),
    denied,
  );
  assert.equal(
    (
      await http(service, alice, "/agent/reminders", "POST", {
        ...fields,
        userId: bob.id,
      })
    ).status,
    400,
  );
});
test("skills are versioned and loaded only from the allowlist, never legacy delegated payment skills", async () => {
  assert.equal(skillCatalog.length, 3);
  for (const skill of skillCatalog)
    assert.ok(
      (await loadSkill(skill.name)).includes(`version: "${skill.version}"`),
      `${skill.name} file version must match the catalog`,
    );
  const text = await loadSkill("expense-preparation");
  assert.ok(text.includes("human"));
  await assert.rejects(loadSkill("../tab-agent-send"));
  await assert.rejects(loadSkill("tab-agent-send"));
});

test("without a model key the real runtime gives a verified readable summary without proposals or financial writes", async () => {
  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const room = await joined();
    const real = new DinnerAgentService(db, dinner);
    const source = await dinner.send(room.id, alice, {
      clientId: randomUUID(),
      text: "@Tab summarize this room",
    });
    const reply = await real.respond(
      alice,
      { kind: "room", roomId: room.id },
      source.id,
    );
    assert.match(reply.text, /Assistant generation is not configured/);
    assert.match(reply.text, /No outstanding obligations/);
    assert.match(reply.text, /Members: Alice, Bob/);
    const personal = await real.personalSend(alice, {
      clientId: randomUUID(),
      text: "What do I owe?",
    });
    assert.match(
      (await real.respond(alice, { kind: "personal" }, personal.id)).text,
      /you owe \$0\.00/,
    );
    assert.equal((await real.session(alice)).proposals.length, 0);
    assert.equal((await dinner.memberRoom(room.id, alice)).expenses.length, 0);
  } finally {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  }
});

test("planning reads enforce scope, omit private notes, distinguish missing responses and never mutate plans", async () => {
  const { PlanService } = await import("../../src/lib/dinner/plans/service");
  const r = await joined();
  const other = await room();
  const inaccessible = await room(carol);
  const plans = new PlanService(db, dinner);
  let p = await plans.create(alice, r.id, {
    clientId: randomUUID(),
    title: "Agent supper",
    participantIds: [alice.id, bob.id],
    timeZone: "UTC",
    location: "Cafe",
    budgetCents: 5000,
    deadline: null,
    slots: [
      { localStart: "2035-01-04T19:00", localEnd: "2035-01-04T21:00" },
      { localStart: "2035-01-05T19:00", localEnd: "2035-01-05T21:00" },
    ],
  });
  const execute = async (personal: boolean) => {
    let checked = false;
    const service = agent(async (context) => {
      const result = await context.readPlans(r.id, p.id);
      assert.equal(result.plans.length, p.state === "draft" ? 0 : 1);
      if (result.plans.length) {
        const fact = result.plans[0];
        assert.deepEqual(
          fact.missingResponses.map((m) => m.name),
          ["Bob"],
        );
        assert.equal(fact.options[0].works, 1);
        assert.equal(fact.options[0].unanswered, 1);
        assert.equal(fact.options[0].cant, 0);
        assert.deepEqual(
          fact.budget.unknown.map((m) => m.name),
          ["Bob"],
        );
        assert.equal(fact.finalDecisions, null);
        assert.ok(!JSON.stringify(result).includes("PRIVATE_ACCESS"));
        assert.ok(!JSON.stringify(result).includes("creationHash"));
      }
      if (personal)
        assert.deepEqual((await context.readPlans(other.id)).plans, []);
      else await assert.rejects(context.readPlans(other.id), denied);
      await assert.rejects(context.readPlans(inaccessible.id), denied);
      checked = true;
      return "Read plans only.";
    });
    const source = personal
      ? await service.personalSend(alice, {
          clientId: randomUUID(),
          text: "Planning status",
        })
      : await addressed(r.id);
    await service.respond(
      alice,
      personal ? { kind: "personal" } : { kind: "room", roomId: r.id },
      source.id,
    );
    assert.ok(checked);
  };
  await execute(false);
  p = await plans.command(alice, r.id, p.id, {
    action: "publish",
    clientId: randomUUID(),
    expectedRevision: p.revision,
  });
  p = await plans.command(alice, r.id, p.id, {
    action: "respond",
    clientId: randomUUID(),
    optionsVersion: p.optionsVersion,
    expectedResponseVersion: 0,
    votes: Object.fromEntries(p.slots.map((s) => [s.id, "works"])),
    budget: "works",
    privateNote: "PRIVATE_ACCESS",
  });
  const before = await db.collection("dinner-plans").findOne({ id: p.id });
  await execute(false);
  await execute(true);
  const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const real = new DinnerAgentService(db, dinner);
    const source = await addressed(
      r.id,
      alice,
      "@Tab who hasn't responded to the plan?",
    );
    const reply = await real.respond(
      alice,
      { kind: "room", roomId: r.id },
      source.id,
    );
    assert.match(reply.text, /missing availability: Bob/);
    assert.match(reply.text, /1 works, 0 if needed, 0 can't, 1 unanswered/);
    assert.ok(!reply.text.includes("PRIVATE_ACCESS"));
    const runs = await db
      .collection("dinner-agent-runs")
      .find({ "tools.name": "read_plans" })
      .toArray();
    assert.equal(runs.length, 1);
  } finally {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
  assert.deepEqual(
    await db.collection("dinner-plans").findOne({ id: p.id }),
    before,
  );
  assert.equal((await dinner.memberRoom(r.id, alice)).expenses.length, 0);
});

test("a free future outing bypasses bill routing and preserves its date", async () => {
  const r = await joined();
  const service = new DinnerAgentService(db, dinner, async context => {
    assert.equal(context.action, "general");
    assert.equal(context.readyBill, undefined);
    const proposal = await context.preparePlan({roomId: r.id, idea: "Afternoon picnic", fields: {
      title: "Picnic", participantIds: [alice.id, bob.id], timeZone: "America/New_York", location: "Central Park", budgetCents: 0,
      slots: [{localStart: "2035-11-14T15:00", localEnd: "2035-11-14T17:00"}],
    }});
    assert.equal(proposal.fields.slots?.[0].localStart, "2035-11-14T15:00");
    assert.equal(proposal.fields.budgetCents, 0);
    return "Ready";
  }, undefined, undefined, async () => { throw new Error("Bill classifier must not run"); });
  const source = await addressed(r.id, alice, "@Tab prepare a fresh suggestion for our picnic, $0 budget");
  await service.respond(alice, {kind: "room", roomId: r.id}, source.id);
  assert.equal(await db.collection("dinner-bill-tasks").countDocuments(), 0);
});

test("an explicit no-plan request blocks model preparation", async () => {
  const r = await joined();
  const service = agent(async (context) => {
    await assert.rejects(context.preparePlan({roomId: r.id, idea: "Cafe", fields: {
      title: "Cafe", participantIds: null, timeZone: null, location: null, budgetCents: null, slots: null,
    }}), /asked not to create a plan/);
    return "We can compare preferences in chat; venue polling isn't supported.";
  });
  const source = await addressed(r.id, alice, "@Tab can we vote on venues? Please don’t create a plan yet.");
  await service.respond(alice, {kind: "room", roomId: r.id}, source.id);
  assert.equal((await service.roomPlanProposals(alice, r.id)).length, 0);
});

test("plan preparation rejects invented past dates and reports the saved state", async () => {
  const r = await joined();
  const service = agent(async (context) => {
    const proposal = await context.preparePlan({
      roomId: r.id, idea: "Winter picnic",
      fields: { title: "Picnic", participantIds: [alice.id, bob.id], timeZone: "UTC",
        location: "Central Park", budgetCents: 0,
        slots: [{ localStart: "2023-10-06T19:00", localEnd: "2023-10-06T21:00" }] },
    });
    assert.equal(proposal.fields.slots, null);
    return "Everyone is confirmed and voting is available now.";
  });
  const source = await addressed(r.id, alice, "@Tab prepare our picnic suggestion");
  const reply = await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  assert.match(reply.text, /time options/);
  assert.match(reply.text, /voting hasn't started/);
  assert.doesNotMatch(reply.text, /Everyone is confirmed/);
  assert.equal((await service.roomPlanProposals(alice, r.id))[0].fields.slots, null);
  assert.equal(await db.collection("dinner-plans").countDocuments(), 0);
});

test("plan proposals preserve missing details, enforce requester review and safely create one unpublished draft", async () => {
  const r = await joined();
  const other = await room();
  const hidden = await room(carol);
  const input = {
    roomId: r.id,
    idea: "Dinner sometime, place and budget undecided",
    fields: {
      title: "Dinner idea",
      participantIds: null,
      timeZone: null,
      location: null,
      budgetCents: null,
      slots: null,
    },
  };
  let checked = false;
  const service = agent(async (context) => {
    await assert.rejects(
      context.preparePlan({ ...input, roomId: other.id }),
      denied,
    );
    await assert.rejects(
      context.preparePlan({
        ...input,
        fields: { ...input.fields, participantIds: [carol.id] },
      }),
    );
    const [first, second] = await Promise.all([
      context.preparePlan(input),
      context.preparePlan(input),
    ]);
    assert.equal(first.id, second.id);
    assert.equal(first.fields.budgetCents, null);
    checked = true;
    return "Prepared an idea; review required.";
  });
  const source = await addressed(r.id, alice, "@Tab prepare a plan for dinner");
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  assert.ok(checked);
  const [proposal] = await service.roomPlanProposals(bob, r.id);
  assert.equal(await db.collection("dinner-plans").countDocuments(), 0);
  await assert.rejects(service.planProposal(bob, proposal.id), denied);
  await assert.rejects(service.roomPlanProposals(carol, r.id), denied);
  const body = {
    clientId: randomUUID(),
    title: "Human revised dinner",
    participantIds: [alice.id, bob.id],
    timeZone: "UTC",
    location: "Human chosen cafe",
    budgetCents: 3500,
    slots: [{ localStart: "2035-01-04T19:00", localEnd: "2035-01-04T21:00" }],
    deadline: null,
  };
  assert.equal(
    (
      await http(
        service,
        bob,
        `/agent/plan-proposals/${proposal.id}/apply`,
        "POST",
        body,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await http(
        service,
        alice,
        `/agent/plan-proposals/${proposal.id}/apply`,
        "POST",
        { ...body, budgetCents: null },
      )
    ).status,
    400,
  );
  const [a, b] = await Promise.all([
    service.applyPlanProposal(alice, proposal.id, body),
    service.applyPlanProposal(alice, proposal.id, body),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(a.state, "draft");
  assert.equal(a.title, "Human revised dinner");
  assert.equal(a.history.length, 0);
  assert.equal(await db.collection("dinner-plans").countDocuments(), 1);
  assert.equal(
    (await service.planProposal(alice, proposal.id)).appliedPlanId,
    a.id,
  );
  await assert.rejects(
    service.applyPlanProposal(alice, proposal.id, {
      ...body,
      title: "Conflicting edit",
    }),
    (e: unknown) => e instanceof DinnerError && e.status === 409,
  );
  // A crash after plan creation but before linking recovers the same plan.
  await db
    .collection("dinner-agent-plan-proposals")
    .updateOne({ id: proposal.id }, { $set: { appliedPlanId: null } });
  assert.equal(
    (await service.applyPlanProposal(alice, proposal.id, body)).id,
    a.id,
  );
  assert.equal(await db.collection("dinner-plans").countDocuments(), 1);
  const privateService = agent(async (context) => {
    await assert.rejects(
      context.preparePlan({ ...input, roomId: hidden.id }),
      denied,
    );
    return (await context.preparePlan(input)).idea;
  });
  const personal = await privateService.personalSend(alice, {
    clientId: randomUUID(),
    text: "Plan a dinner privately",
  });
  await privateService.respond(alice, { kind: "personal" }, personal.id);
  assert.equal((await privateService.session(alice)).planProposals.length, 2);
  assert.equal((await privateService.session(bob)).planProposals.length, 0);
  assert.equal((await privateService.roomPlanProposals(bob, r.id)).length, 1);
  assert.equal((await dinner.memberRoom(r.id, alice)).expenses.length, 0);
});

test("agent expense proposal links only completed member outings and stays a draft after human apply", async () => {
  const { PlanService } = await import("../../src/lib/dinner/plans/service");
  const r = await joined();
  let now = "2030-01-01T00:00:00Z";
  const plans = new PlanService(db, dinner, () => now);
  let p = await plans.create(alice, r.id, {
    clientId: randomUUID(),
    title: "Outing for bill",
    participantIds: [alice.id, bob.id],
    timeZone: "UTC",
    location: "Cafe",
    budgetCents: 9999,
    deadline: null,
    slots: [{ localStart: "2035-01-04T19:00", localEnd: "2035-01-04T21:00" }],
  });
  const input = { ...expense(r.id), sourcePlanId: p.id };
  let checked = false;
  const incomplete = agent(async (context) => {
    await assert.rejects(context.prepareExpense(input));
    checked = true;
    return "Complete first.";
  });
  await incomplete.respond(
    alice,
    { kind: "room", roomId: r.id },
    (await addressed(r.id)).id,
  );
  assert.ok(checked);
  const command = async (action: string, extra = {}) => {
    p = await plans.command(alice, r.id, p.id, {
      action,
      clientId: randomUUID(),
      ...(action === "decide" ? {} : { expectedRevision: p.revision }),
      ...extra,
    });
  };
  await command("publish");
  await command("propose", {
    terms: {
      localStart: p.slots[0].localStart,
      localEnd: p.slots[0].localEnd,
      timeZone: "UTC",
      location: "Cafe",
      budgetCents: 9999,
    },
  });
  await command("decide", {
    termsVersion: p.termsVersion,
    expectedDecisionVersion: 0,
    decision: "accepted",
  });
  await command("finalize");
  now = "2035-01-05T00:00:00Z";
  await command("complete");
  const service = agent(async (context) => {
    await context.prepareExpense(input);
    return "Review the actual bill.";
  });
  await service.respond(
    alice,
    { kind: "room", roomId: r.id },
    (await addressed(r.id)).id,
  );
  const [proposal] = await service.roomProposals(alice, r.id);
  assert.equal(proposal.sourcePlanId, p.id);
  assert.equal((await dinner.memberRoom(r.id, alice)).expenses.length, 0);
  const saved = await service.applyProposal(alice, proposal.id);
  assert.equal(saved.sourcePlanId, p.id);
  assert.equal(saved.status, "draft");
  assert.equal(saved.totalCents, input.totalCents);
  assert.equal((await service.applyProposal(alice, proposal.id)).id, saved.id);
});

async function confirmedDinner() {
  const r = await joined();
  const { roomId, ...draftFields } = expense(r.id);
  const d = await dinner.draft(roomId, alice, {
    ...draftFields,
    clientId: randomUUID(),
  });
  const e = await dinner.confirm(r.id, alice, d.id, randomUUID(), d.version);
  if (e.status !== "confirmed") assert.fail("expense should confirm");
  return { r, e };
}
function ndjsonRequest(
  service: DinnerAgentService,
  path: string,
  body: unknown,
) {
  return handleDinner(
    new Request(`http://localhost/api/dinner${path}`, {
      method: "POST",
      headers: { accept: "application/x-ndjson" },
      body: JSON.stringify(body),
    }),
    path.split("/").filter(Boolean),
    {
      enabled: true,
      actor: async () => alice,
      service: dinner,
      attachments: new Attachments(db, dinner),
      agent: service,
    },
  );
}
const lines = async (response: Response) =>
  (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

test("addressed room replies stream deltas and persist the reply before the done line", async () => {
  const r = await joined();
  const source = await addressed(r.id);
  const service = agent(async (context) => {
    context.onDelta?.("Bob owes ");
    context.onDelta?.("Alice $10.00.");
    return "Bob owes Alice $10.00.";
  });
  const response = await ndjsonRequest(service, `/rooms/${r.id}/bot`, {
    messageId: source.id,
  });
  assert.match(response.headers.get("content-type") ?? "", /ndjson/);
  const events = await lines(response);
  assert.deepEqual(
    events.map((e) => e.type),
    ["delta", "delta", "done"],
  );
  assert.equal(events[2].text, "Bob owes Alice $10.00.");
  const saved = (await dinner.memberRoom(r.id, alice)).messages;
  assert.equal(saved.filter((m) => m.kind === "tab").length, 1);
  assert.ok(saved.some((m) => m.id === source.id));
});

test("personal replies stream too, and JSON clients keep the existing response shape", async () => {
  const service = agent(async (context) => {
    context.onDelta?.("Nothing owed.");
    return "Nothing owed.";
  });
  const a = await service.personalSend(alice, {
    clientId: randomUUID(),
    text: "What do I owe?",
  });
  const events = await lines(
    await ndjsonRequest(service, "/agent/respond", { messageId: a.id }),
  );
  assert.equal(events.at(-1)?.type, "done");
  const b = await service.personalSend(alice, {
    clientId: randomUUID(),
    text: "Again?",
  });
  const plain = await http(service, alice, "/agent/respond", "POST", {
    messageId: b.id,
  });
  assert.deepEqual(await plain.json(), {
    status: "complete",
    text: "Nothing owed.",
  });
});

test("a stream that fails mid-reply reports an error, saves no bot reply and stays retryable", async () => {
  const r = await joined();
  const source = await addressed(r.id);
  const failing = agent(async (context) => {
    context.onDelta?.("Bob owes");
    throw new Error("provider dropped");
  });
  const events = await lines(
    await ndjsonRequest(failing, `/rooms/${r.id}/bot`, {
      messageId: source.id,
    }),
  );
  assert.equal(events.at(-1)?.type, "error");
  const room = await dinner.memberRoom(r.id, alice);
  assert.ok(room.messages.some((m) => m.id === source.id));
  assert.equal(room.messages.filter((m) => m.kind === "tab").length, 0);
  await agent().respond(alice, { kind: "room", roomId: r.id }, source.id);
  assert.equal(
    (await dinner.memberRoom(r.id, alice)).messages.filter(
      (m) => m.kind === "tab",
    ).length,
    1,
  );
});

test("member summary and nudge drafts are read-only and never post or settle anything", async () => {
  const { r } = await confirmedDinner();
  const before = await dinner.memberRoom(r.id, alice);
  const source = await addressed(r.id, alice, "@Tab nudge Bob");
  let summary:
    | Awaited<ReturnType<AgentContextFns["memberSummary"]>>
    | undefined;
  let nudge: Awaited<ReturnType<AgentContextFns["draftNudge"]>> | undefined;
  await agent(async (context) => {
    summary = await context.memberSummary(r.id);
    nudge = await context.draftNudge({ roomId: r.id, debtorId: bob.id });
    await assert.rejects(
      context.draftNudge({ roomId: r.id, debtorId: carol.id }),
    );
    await assert.rejects(context.memberSummary(randomUUID()));
    return "Draft ready; copy it to send yourself.";
  }).respond(alice, { kind: "room", roomId: r.id }, source.id);
  const bobRow = summary?.members.find((m) => m.userId === bob.id);
  assert.equal(bobRow?.oweCents, 1000);
  assert.equal(bobRow?.oweUsd, "$10.00");
  assert.equal(
    summary?.members.find((m) => m.userId === alice.id)?.owedCents,
    1000,
  );
  assert.equal(
    summary?.members.find((m) => m.userId === alice.id)?.owedUsd,
    "$10.00",
  );
  assert.equal(nudge?.sent, false);
  assert.match(nudge?.text ?? "", /\$10\.00/);
  const after = await dinner.memberRoom(r.id, alice);
  // Only the addressed message and Tab's reply were added; no nudge was posted.
  assert.equal(after.messages.length, before.messages.length + 2);
  assert.ok(!after.messages.some((m) => m.text === nudge?.text));
  assert.deepEqual(
    after.expenses.map((e) => e.status),
    before.expenses.map((e) => e.status),
  );
});

test("member summary formats 50 cents as $0.50, not $50", () => {
  const summary = memberSummary({
    members: [
      { userId: "carlos", name: "Carlos" },
      { userId: "bob", name: "Bob" },
    ],
    obligations: [
      {
        id: "o1",
        expenseId: "e1",
        debtorId: "bob",
        creditorId: "carlos",
        cents: 50,
        currency: "USD",
        status: "outstanding",
      },
    ],
  });
  const carlos = summary.members.find((m) => m.userId === "carlos");
  assert.equal(carlos?.owedCents, 50);
  assert.equal(carlos?.owedUsd, "$0.50");
  assert.notEqual(carlos?.owedUsd, "$50");
  assert.notEqual(carlos?.owedUsd, "$50.00");
  assert.match(summary.notice, /50 means \$0\.50/);
});

test("a proposal can link a receipt already shared in the room, never a guessed one", async () => {
  const r = await joined();
  const image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const upload = await new Attachments(db, dinner).upload(
    r.id,
    alice,
    new Request(`http://localhost?clientId=${randomUUID()}`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(image),
    }),
  );
  const source = await dinner.send(r.id, alice, {
    clientId: randomUUID(),
    text: "@Tab split this receipt between Alice and Bob, $20.01, Alice paid",
    attachmentIds: [upload.id],
  });
  let seen = "";
  const service = agent(async (context) => {
    seen = context.conversation.at(-1)?.content ?? "";
    await assert.rejects(
      context.prepareExpense({ ...expense(r.id), attachmentId: randomUUID() }),
    );
    await context.prepareExpense({ ...expense(r.id), attachmentId: upload.id });
    return "Review the proposal.";
  });
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  assert.match(seen, new RegExp(upload.id));
  const [proposal] = await service.roomProposals(alice, r.id);
  assert.equal(proposal.fields.attachmentId, upload.id);
  assert.equal(proposal.appliedExpenseId, null);
  const draft = await service.applyProposal(alice, proposal.id);
  assert.equal(draft.status, "draft");
  assert.equal(draft.attachmentId, upload.id);
});
type AgentContextFns =
  import("../../src/lib/dinner/agent/capabilities").AgentContext;

async function postedReceipt(roomId: string, text = "Receipt") {
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const upload = await new Attachments(db, dinner).upload(
    roomId,
    alice,
    new Request(`http://localhost?clientId=${randomUUID()}`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(bytes),
    }),
  );
  await dinner.send(roomId, alice, {
    clientId: randomUUID(),
    text,
    attachmentIds: [upload.id],
  });
  return upload.id;
}

test("receipt extraction populates a review proposal, asks for missing participants and never passes pixels to Tab", async () => {
  const r = await joined();
  const attachmentId = await postedReceipt(r.id);
  let calls = 0;
  const service = new DinnerAgentService(
    db,
    dinner,
    async (context) => {
      assert.match(context.conversation.at(-1)?.content ?? "", /20.01/);
      assert.doesNotMatch(
        JSON.stringify(context.conversation),
        /data:image|base64/,
      );
      const missing = await context.prepareExpense({
        roomId: r.id,
        attachmentId,
      });
      assert.ok("kind" in missing);
      assert.deepEqual(missing.missing, [
        "payer",
        "participants and exact shares",
      ]);
      const prepared = await context.prepareExpense({
        roomId: r.id,
        attachmentId,
        payerId: alice.id,
        shares: expense(r.id).shares,
      });
      assert.ok("id" in prepared);
      assert.equal(prepared.fields.totalCents, 2001);
      assert.equal(prepared.fields.description, "Noodle house");
      assert.equal(prepared.appliedExpenseId, null);
      await assert.rejects(
        context.prepareExpense({
          ...expense(r.id),
          attachmentId: randomUUID(),
        }),
        /already shared/,
      );
      return "Review the proposed receipt split; nothing confirmed.";
    },
    async (image) => {
      calls++;
      assert.match(image, /^data:image\/webp;base64,/);
      return {
        merchant: "Noodle house",
        totalAmount: 20.01,
        currency: "USD",
        items: [{ name: "Dinner", price: 20.01 }],
        confidence: 0.95,
      };
    },
  );
  const source = await addressed(
    r.id,
    alice,
    "@Tab split this receipt equally between Alice and Bob, total $",
  );
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  assert.equal(calls, 1);
  assert.equal((await dinner.memberRoom(r.id, alice)).expenses.length, 0);
  assert.equal(
    (await new Attachments(db, dinner).download(r.id, attachmentId, alice))
      .status,
    200,
  );
});

test("unreadable receipt asks for USD total; guessed identities and cross-room attachments still fail", async () => {
  const r = await joined();
  const attachmentId = await postedReceipt(r.id);
  const other = await room();
  const otherImage = await postedReceipt(other.id);
  const service = new DinnerAgentService(
    db,
    dinner,
    async (context) => {
      const input = expense(r.id);
      const missing = await context.prepareExpense({
        roomId: r.id,
        attachmentId,
        payerId: alice.id,
        shares: input.shares,
      });
      assert.ok("kind" in missing);
      assert.deepEqual(missing.missing, ["total in USD"]);
      await assert.rejects(
        context.prepareExpense({
          roomId: r.id,
          attachmentId,
          payerId: carol.id,
        }),
        /accepted member/,
      );
      await assert.rejects(
        context.prepareExpense({ ...input, attachmentId: otherImage }),
        /already shared/,
      );
      return missing.message;
    },
    async () => ({
      merchant: null,
      totalAmount: null,
      currency: null,
      items: [],
      confidence: 0,
    }),
  );
  const source = await addressed(
    r.id,
    alice,
    "@Tab split this receipt equally between Alice and Bob, total $",
  );
  const result = await service.respond(
    alice,
    { kind: "room", roomId: r.id },
    source.id,
  );
  assert.match(result.text, /total in USD/);
  assert.equal((await service.roomProposals(alice, r.id)).length, 0);
});

test("assistant correction is draft only and projections track the human-accepted version", async () => {
  const r = await joined();
  const { roomId: _roomId, ...fields } = expense(r.id);
  const d = await dinner.draft(r.id, alice, {
    ...fields,
    clientId: randomUUID(),
  });
  const e = await dinner.confirm(r.id, alice, d.id, randomUUID(), d.version);
  const service = agent(async (context) => {
    await context.prepareExpense({
      ...expense(r.id),
      totalCents: 3000,
      shares: [
        { userId: alice.id, cents: 1500 },
        { userId: bob.id, cents: 1500 },
      ],
      correctionOf: e.id,
      expectedVersion: e.version,
    });
    return "Review correction in Money";
  });
  const source = await addressed(r.id);
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  const [p] = await service.roomProposals(alice, r.id);
  assert.equal(p.correctionOf, e.id);
  assert.equal((await service.wallet(bob)).owe, 1000);
  await service.applyProposal(alice, p.id);
  await service.applyProposal(alice, p.id);
  const before = (await dinner.memberRoom(r.id, alice)).expenses[0];
  assert.equal(before.status, "confirmed");
  if (before.status !== "confirmed") throw new Error("Expected confirmed");
  assert.equal(before.corrections?.length, 1);
  assert.equal((await service.wallet(bob)).owe, 1000);
  await dinner.confirmCorrection(
    r.id,
    alice,
    e.id,
    before.corrections![0].id,
    randomUUID(),
  );
  assert.equal((await service.wallet(bob)).owe, 1500);
  const summary = agent(async (context) => {
    const data = await context.memberSummary(r.id);
    assert.equal(
      data.members.find((m) => m.userId === bob.id)?.oweUsd,
      "$15.00",
    );
    return "Bob owes $15.00";
  });
  const question = await addressed(r.id);
  await summary.respond(alice, { kind: "room", roomId: r.id }, question.id);
  await dinner.removeMember(r.id, alice, bob.id, randomUUID());
  const wallet = await service.wallet(bob);
  assert.equal(wallet.owe, 1500);
  assert.equal(wallet.balances[0].hasRoomAccess, false);
  const removed = agent(async (context) => {
    const facts = (await context.readRoom(r.id)) as {
      members: { userId: string }[];
    };
    assert.ok(!facts.members.some((m) => m.userId === bob.id));
    assert.equal(
      (await context.memberSummary(r.id)).members.find(
        (m) => m.userId === bob.id,
      )?.oweCents,
      1500,
    );
    return "Historical obligations preserved";
  });
  const q = await addressed(r.id);
  await removed.respond(alice, { kind: "room", roomId: r.id }, q.id);
});

test("receipt payer follow-up keeps the original attachment, cached fields and authenticated speaker", async () => {
  const r = await joined();
  const attachmentId = await postedReceipt(r.id);
  let parses = 0;
  let turns = 0;
  const service = new DinnerAgentService(
    db,
    dinner,
    async (context) => {
      turns++;
      assert.deepEqual(context.requester, {
        userId: alice.id,
        name: alice.name,
      });
      const extraction = context.conversation.at(-1)?.content ?? "";
      assert.match(extraction, new RegExp(attachmentId));
      assert.match(extraction, /84.8/);
      if (turns === 2) {
        assert.ok(
          context.conversation.some((m) =>
            m.content.includes(`[memberId: ${alice.id}]: @Tab i was the payer`),
          ),
        );
        const result = await context.prepareExpense({
          roomId: r.id,
          attachmentId,
          payerId: alice.id,
        });
        assert.ok("kind" in result);
        assert.deepEqual(result.missing, ["participants and exact shares"]);
        const guessed = await context.prepareExpense({
          roomId: r.id,
          attachmentId,
          payerId: alice.id,
          shares: [
            { userId: alice.id, cents: 4240 },
            { userId: bob.id, cents: 4240 },
          ],
        });
        assert.ok("kind" in guessed);
        assert.deepEqual(guessed.missing, ["explicit receipt participants"]);
      }
      return "Who should participate?";
    },
    async () => {
      parses++;
      return {
        merchant: "Dinner",
        totalAmount: 84.8,
        currency: "USD",
        items: [],
        confidence: 0.95,
      };
    },
  );
  const initial = await addressed(
    r.id,
    alice,
    "@Tab split this receipt equally, total $",
  );
  await service.respond(alice, { kind: "room", roomId: r.id }, initial.id);
  const question = (await dinner.memberRoom(r.id, alice)).messages.at(-1)!;
  // After an intervening attachment, explicitly reply to the original question.
  await postedReceipt(r.id);
  const followup = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "@Tab i was the payer", replyTo: question.id });
  await service.respond(alice, { kind: "room", roomId: r.id }, followup.id);
  assert.equal(parses, 1);
  assert.equal(turns, 2);
  assert.equal((await dinner.memberRoom(r.id, alice)).expenses.length, 0);
});

test("current room facts express creditor direction and cents as formatted dollars", async () => {
  const r = await joined();
  const draft = await dinner.draft(r.id, alice, {
    clientId: randomUUID(),
    description: "Dinner",
    payerId: alice.id,
    totalCents: 100,
    shares: [
      { userId: alice.id, cents: 50 },
      { userId: bob.id, cents: 50 },
    ],
  });
  await dinner.confirm(r.id, alice, draft.id, randomUUID(), draft.version);
  const service = agent(async (context) => {
    const facts = (await context.readContext()) as {
      outstandingStatements: string[];
    };
    assert.deepEqual(facts.outstandingStatements, ["Bob owes Alice $0.50."]);
    return facts.outstandingStatements.join("\n");
  });
  const source = await addressed(r.id, alice, "@Tab who owes whom?");
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
});

test("model preparation accepts unknown fields without fabricating correction IDs", () => {
  const roomId = randomUUID();
  const input = prepareToolInput.parse({
    roomId,
    description: null,
    payerId: alice.id,
    totalCents: null,
    shares: null,
    attachmentId: null,
    correctionOf: null,
    expectedVersion: null,
  });
  assert.deepEqual(normalizePreparation(input), { roomId, payerId: alice.id });
});

test("room history retrieves omitted plans with source bounds and pagination", async () => {
  const r = await joined();
  const other = await room();
  await addressed(other.id, alice, "Dinner secret elsewhere");
  const plan = await addressed(r.id, bob, "Dinner is at 7 pm at Lotus.");
  for (let i = 0; i < 27; i++)
    await addressed(r.id, alice, `ordinary message ${i}`);
  const source = await addressed(r.id, alice, "@Tab what time are we meeting?");
  await addressed(r.id, bob, "Dinner future update at 9 pm");
  await agent(async (context) => {
    assert.equal(context.historyCoverage?.visibleMessages, 25);
    assert.equal(context.historyCoverage?.totalMessages, 29);
    assert.equal(context.historyCoverage?.sourceSeq, source.seq);
    assert.ok(!context.conversation.some((m) => m.content.includes("Lotus")));
    const found = await context.searchRoomHistory!({
      query: "DINNER",
      beforeSeq: null,
      limit: null,
    });
    assert.deepEqual(
      found.messages.map((m) => m.id),
      [plan.id],
    );
    assert.equal(found.messages[0].senderId, bob.id);
    const page = await context.searchRoomHistory!({
      query: "",
      beforeSeq: null,
      limit: 2,
    });
    assert.equal(page.messages[0].id, source.id);
    assert.equal(page.hasMore, true);
    const older = await context.searchRoomHistory!({
      query: "",
      beforeSeq: page.nextBeforeSeq,
      limit: 2,
    });
    assert.ok(older.messages.every((m) => m.seq < page.nextBeforeSeq!));
    await assert.rejects(
      context.searchRoomHistory!({ query: "", beforeSeq: null, limit: 21 }),
    );
    return "Dinner is at 7 pm at Lotus.";
  }).respond(alice, { kind: "room", roomId: r.id }, source.id);
});

test("room history rechecks membership", async () => {
  let checked = false;
  const r = await joined();
  const source = await addressed(r.id, bob);
  await assert.rejects(
    agent(async (context) => {
      await dinner.removeMember(r.id, alice, bob.id, randomUUID());
      await assert.rejects(
        context.searchRoomHistory!({ query: "", beforeSeq: null, limit: null }),
        denied,
      );
      checked = true;
      return "Removed";
    }).respond(bob, { kind: "room", roomId: r.id }, source.id),
    /Tab could not finish/,
  );
  assert.equal(checked, true);
  assert.equal(
    (await dinner.memberRoom(r.id, alice)).messages.filter(
      (m) => m.kind === "tab",
    ).length,
    0,
  );
});

test("personal agent has no room history capability", async () => {
  const service = agent(async (context) => {
    assert.equal(context.searchRoomHistory, undefined);
    assert.equal(context.historyCoverage, undefined);
    return "Personal summary";
  });
  const source = await service.personalSend(alice, {
    clientId: randomUUID(),
    text: "summary",
  });
  await service.respond(alice, { kind: "personal" }, source.id);
});

test("clear personal chat is authenticated, owner-scoped, and preserves preferences and rooms", async () => {
  const service = agent();
  const r = await joined();
  const beforeRoom = await dinner.memberRoom(r.id, alice);
  await service.personalSend(alice, { clientId: randomUUID(), text: "Alice history" });
  await service.personalSend(bob, { clientId: randomUUID(), text: "Bob history" });
  await service.saveNote(alice, { kind: "personal" }, "memory", { text: "Keep this preference", expectedVersion: 0, clientId: randomUUID() });
  assert.equal((await http(service, null, "/agent/session", "DELETE")).status, 401);
  assert.equal((await http(service, alice, "/agent/session", "DELETE")).status, 200);
  assert.deepEqual((await service.session(alice)).messages, []);
  assert.equal((await service.session(bob)).messages[0].text, "Bob history");
  assert.equal((await service.note(alice, { kind: "personal" }, "memory")).value.text, "Keep this preference");
  assert.deepEqual(await dinner.memberRoom(r.id, alice), beforeRoom);
  const fresh = await service.personalSend(alice, { clientId: randomUUID(), text: "Start fresh" });
  assert.equal((await service.respond(alice, { kind: "personal" }, fresh.id)).status, "complete");
});

test("an in-flight reply cannot restore cleared personal history", async () => {
  let started!: () => void;
  let finish!: () => void;
  const began = new Promise<void>((resolve) => { started = resolve; });
  const release = new Promise<void>((resolve) => { finish = resolve; });
  const service = agent(async () => { started(); await release; return "Old reply"; });
  const message = await service.personalSend(alice, { clientId: randomUUID(), text: "Old question" });
  const response = service.respond(alice, { kind: "personal" }, message.id);
  await began;
  await service.clearPersonalChat(alice);
  finish();
  await assert.rejects(response);
  assert.deepEqual((await service.session(alice)).messages, []);
});


for (const followup of [true, false]) test(`receipt amount without currency is preserved (separate tag: ${followup})`, async () => {
  const r = await joined();
  let parses = 0;
  const service = new DinnerAgentService(db, dinner, async (context) => {
    const pending = await context.pendingExpense!();
    assert.ok(pending, "A reference to the prior receipt must enter the receipt workflow");
    const state = await pending.update({ payer: "me", participants: null, splitEqually: null, totalUsd: null });
    return state.reply;
  }, async () => {
    parses++;
    return { totalAmount: 84.8, currency: null, merchant: null, items: [], confidence: 1 };
  });
  await postedReceipt(r.id, followup ? "help me create a tab for this receipt. I paid" : "@tab create a bill for this tab. i paid");
  const untagged = (await dinner.memberRoom(r.id, alice)).messages.at(-1)!;
  if (followup) await assert.rejects(service.respond(alice, { kind: "room", roomId: r.id }, untagged.id));
  const source = followup ? await dinner.send(r.id, alice, { clientId: randomUUID(), text: "@tab check message above", attachmentIds: [] }) : untagged;
  const result = await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  assert.match(result.text, /Alice paid/);
  assert.match(result.text, /84\.80.*no currency.*Is that USD\?/);
  assert.doesNotMatch(result.text, /What is the total/);
  const yes = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "@tab yes", attachmentIds: [] });
  const confirmed = await service.respond(alice, { kind: "room", roomId: r.id }, yes.id);
  assert.match(confirmed.text, /Receipt total: \$84\.80/);
  assert.match(confirmed.text, /Who should share/);
  assert.equal(parses, 1);
  assert.equal((await dinner.memberRoom(r.id, alice)).expenses.length, 0);
});

test("two unfinished receipts require explicit selection and never mix payer or amounts", async () => {
  const r = await joined();
  const a = await postedReceipt(r.id, "@Tab receipt A. I paid");
  const sourceA = (await dinner.memberRoom(r.id, alice)).messages.at(-1)!;
  let patch = { payer: "me", participants: null as string[] | null, splitEqually: null as boolean | null, totalUsd: null };
  let parsed = 0;
  const service = new DinnerAgentService(db, dinner, async (context) => {
    const pending = await context.pendingExpense!();
    assert.ok(pending);
    return (await pending.update(patch)).reply;
  }, async () => ({ merchant: ++parsed === 1 ? "Cafe A" : "Cafe B", totalAmount: parsed === 1 ? 20.01 : 40, currency: "USD", confidence: 1, items: [] }));
  await service.respond(alice, { kind: "room", roomId: r.id }, sourceA.id);
  const b = await postedReceipt(r.id, "@Tab receipt B. Bob paid");
  const sourceB = (await dinner.memberRoom(r.id, alice)).messages.at(-1)!;
  patch = { ...patch, payer: "Bob" };
  await service.respond(alice, { kind: "room", roomId: r.id }, sourceB.id);
  const before = await db.collection("dinner-pending-expenses").find({ roomId: r.id }).toArray();
  for (const text of ["@Tab everyone split equally", "@Tab cancel those receipts"]) {
    const source = await dinner.send(r.id, alice, { clientId: randomUUID(), text });
    const result = await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
    assert.match(result.text, /2 drafts need details/);
    assert.deepEqual(await db.collection("dinner-pending-expenses").find({ roomId: r.id }).toArray(), before);
  }
  patch = { ...patch, participants: ["everyone"], splitEqually: true };
  const chosen = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "@Tab Cafe A $20.01 receipt: everyone split equally" });
  await service.respond(alice, { kind: "room", roomId: r.id }, chosen.id);
  const proposals = await service.roomProposals(alice, r.id);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].fields.attachmentId, a);
  assert.equal(proposals[0].fields.payerId, alice.id);
  assert.equal(proposals[0].fields.totalCents, 2001);
  const remaining = await db.collection("dinner-pending-expenses").findOne({ attachmentId: b });
  assert.equal(remaining?.status, "collecting");
  assert.equal(remaining?.payerId, bob.id);
  assert.equal(remaining?.totalCents, 4000);
});


test("smart assistance offers once, accepts yes, and follows participant clarification without mentions", async () => {
  const r = await joined();
  const invite = await dinner.invite(r.id, alice, { clientId: randomUUID() });
  await dinner.respond(carol, { token: invite.token }, "accepted");
  await assert.rejects(dinner.setAssistance(r.id, bob, "smart"), /owner/);
  await dinner.setAssistance(r.id, alice, "smart");
  const topic = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "We should split dinner, USD 60. I paid." });
  let action: "offer" | "accept" | "continue" | "silent" = "offer";
  let runs = 0;
  const service = new DinnerAgentService(db, dinner, async context => {
    runs++;
    const result = await context.prepareExpense({ roomId: r.id, description: "Dinner", totalCents: 6000, payerId: alice.id, shares: [{ userId: alice.id, cents: 3000 }, { userId: bob.id, cents: 3000 }] });
    return "kind" in result ? "For you two or everyone in the room?" : "Your dinner bill is ready to review.";
  }, undefined, async input => {
    assert.ok(input.messages.length <= 25);
    return { action, topicId: topic.id, evidenceIds: [topic.id, input.messages.at(-1)!.id] };
  });
  const agreement = await dinner.send(r.id, bob, { clientId: randomUUID(), text: "Yes, let's do it" });
  const results = await Promise.all([service.assessRoomMessage(bob, r.id, agreement.id), service.assessRoomMessage(bob, r.id, agreement.id)]);
  assert.equal(results.filter(r => r.action === "offered").length, 1);
  assert.equal(runs, 0);
  assert.equal((await service.roomProposals(alice, r.id)).length, 0);
  await assert.rejects(service.respond(bob, { kind: "room", roomId: r.id }, agreement.id), /explicit/);
  action = "accept";
  const yes = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "yes" });
  assert.equal((await service.assessRoomMessage(alice, r.id, yes.id)).action, "respond");
  await service.respond(alice, { kind: "room", roomId: r.id }, yes.id);
  assert.equal((await service.roomProposals(alice, r.id)).length, 0);
  assert.ok((await dinner.memberRoom(r.id, alice)).assistance?.offer?.awaitingReplyId);
  action = "continue";
  const clarification = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "Just us two, split equally" });
  assert.equal((await service.assessRoomMessage(alice, r.id, clarification.id)).action, "respond");
  await service.respond(alice, { kind: "room", roomId: r.id }, clarification.id);
  const proposals = await service.roomProposals(alice, r.id);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].fields.totalCents, 6000);
  assert.equal((await dinner.memberRoom(r.id, alice)).assistance?.offer?.status, "completed");
  assert.equal((await dinner.memberRoom(r.id, alice)).expenses.length, 0);
  await service.respond(alice, { kind: "room", roomId: r.id }, clarification.id);
  assert.equal((await service.roomProposals(alice, r.id)).length, 1);
});

test("awareness respects mentions mode, source identity, stale decisions and direct plain Tab requests", async () => {
  const r = await joined();
  let calls = 0;
  const service = new DinnerAgentService(db, dinner, async () => "Who should share it?", undefined, async input => {
    calls++;
    await dinner.send(r.id, alice, { clientId: randomUUID(), text: "Actually, forget that plan" });
    return { action: "offer", topicId: input.messages[0].id, evidenceIds: input.messages.map(m => m.id) };
  });
  const topic = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "Split the USD 60 dinner?" });
  assert.equal((await service.assessRoomMessage(alice, r.id, topic.id)).action, "silent");
  assert.equal(calls, 0);
  await assert.rejects(service.assessRoomMessage(bob, r.id, topic.id), /not found/);
  await dinner.setAssistance(r.id, alice, "smart");
  const agree = await dinner.send(r.id, bob, { clientId: randomUUID(), text: "Let's do it" });
  assert.equal((await service.assessRoomMessage(bob, r.id, agree.id)).action, "silent");
  assert.equal((await dinner.memberRoom(r.id, alice)).messages.filter(m => m.kind === "tab").length, 0);
  const direct = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "Tab create a dinner bill" });
  assert.equal((await service.assessRoomMessage(alice, r.id, direct.id)).action, "respond");
  await service.respond(alice, { kind: "room", roomId: r.id }, direct.id);
  assert.equal((await dinner.memberRoom(r.id, alice)).messages.at(-1)?.text, "Who should share it?");
});

test("I paid for both updates only the payer of two collecting receipts", async () => {
  const r = await joined();
  const service = new DinnerAgentService(db, dinner, async context => {
    const pending = await context.pendingExpense!();
    assert.ok(pending);
    return (await pending.current()).reply;
  }, async () => ({ merchant: "Dinner", totalAmount: 40, currency: "USD", confidence: 1, items: [] }));
  for (let i = 0; i < 2; i++) {
    await postedReceipt(r.id, "@Tab split this receipt");
    const source = (await dinner.memberRoom(r.id, alice)).messages.at(-1)!;
    await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  }
  const before = await db.collection("dinner-pending-expenses").find({ roomId: r.id }).toArray();
  const message = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "I paid for both @tab" });
  const result = await service.respond(alice, { kind: "room", roomId: r.id }, message.id);
  assert.match(result.text, /you paid for both/);
  const after = await db.collection("dinner-pending-expenses").find({ roomId: r.id }).toArray();
  assert.equal(after.length, 2);
  after.forEach(task => { assert.equal(task.payerId, alice.id); assert.equal(task.participantIds, null); assert.equal(task.totalCents, before.find(t => t._id === task._id)?.totalCents); });
  assert.equal((await service.roomProposals(alice, r.id)).length, 0);
});

test("smart offers expire and unrelated yes cannot accept an older offer", async () => {
  const r = await joined();
  await dinner.setAssistance(r.id, alice, "smart");
  const topic = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "We should split the dinner bill" });
  let action: "offer" | "accept" = "offer";
  const service = new DinnerAgentService(db, dinner, undefined, undefined, async input => ({ action, topicId: topic.id, evidenceIds: [topic.id, input.messages.at(-1)!.id] }));
  const agree = await dinner.send(r.id, bob, { clientId: randomUUID(), text: "Let's do it" });
  await service.assessRoomMessage(bob, r.id, agree.id);
  await dinner.send(r.id, bob, { clientId: randomUUID(), text: "Want to go for a walk?" });
  action = "accept";
  const unrelated = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "Yes" });
  assert.equal((await service.assessRoomMessage(alice, r.id, unrelated.id)).action, "silent");
  assert.equal((await dinner.memberRoom(r.id, alice)).assistance?.offer?.status, "open");
  await dinner.change(r.id, alice, room => { room.assistance!.offer!.createdAt = new Date(Date.now() - 16 * 60_000).toISOString(); });
  const stale = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "Yes" });
  assert.equal((await service.assessRoomMessage(alice, r.id, stale.id)).action, "silent");
  assert.equal((await dinner.memberRoom(r.id, alice)).assistance?.offer?.status, "expired");
  await assert.rejects(service.respond(alice, { kind: "room", roomId: r.id }, stale.id), /explicit/);
});


test("Smart assistance defaults on for new and legacy rooms, preserving explicit opt-out", async () => {
  const created = await dinner.create(alice, { name: "Default", purpose: "Test", clientId: randomUUID() });
  assert.equal(created.assistance?.mode, "smart");
  await dinner.change(created.id, alice, room => { delete room.assistance; });
  assert.equal((await dinner.memberRoom(created.id, alice)).assistance?.mode, "smart");
  assert.equal((await dinner.list(alice)).rooms.find(r => r.id === created.id)?.assistance?.mode, "smart");
  await dinner.setAssistance(created.id, alice, "mentions");
  assert.equal((await dinner.memberRoom(created.id, alice)).assistance?.mode, "mentions");
});


test("a plain greeting and explicit reply address Tab without starting a bill", async () => {
  const r = await dinner.create(alice, { name: "Greetings", purpose: "Test", clientId: randomUUID() });
  const service = new DinnerAgentService(db, dinner, async context => {
    assert.ok(!context.conversation.some(m => m.content.includes("accepted Tab's offer to prepare")));
    return "Hi! How can I help?";
  });
  const greeting = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "hey tab" });
  assert.equal((await service.assessRoomMessage(alice, r.id, greeting.id)).action, "respond");
  await service.respond(alice, { kind: "room", roomId: r.id }, greeting.id);
  assert.equal(await db.collection("dinner-bill-tasks").countDocuments({ roomId: r.id }), 0);
  const reply = (await dinner.memberRoom(r.id, alice)).messages.at(-1)!;
  await dinner.setAssistance(r.id, alice, "mentions");
  const answer = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "What can you do?", replyTo: reply.id });
  assert.equal((await service.assessRoomMessage(alice, r.id, answer.id)).action, "respond");
  await service.respond(alice, { kind: "room", roomId: r.id }, answer.id);
  assert.equal((await dinner.memberRoom(r.id, alice)).messages.filter(m => m.kind === "tab").length, 2);
});

test("new manual bills and confirmation are not captured by unrelated receipt drafts", async () => {
  const r = await joined();
  const service = new DinnerAgentService(db, dinner, async context => {
    const pending = await context.pendingExpense!();
    if (pending) return (await pending.current()).reply;
    const result = await context.prepareExpense({
      roomId: r.id, description: "New dinner", totalCents: 120, payerId: alice.id,
      shares: [{ userId: alice.id, cents: 60 }, { userId: bob.id, cents: 60 }],
    });
    assert.ok(!("kind" in result));
    return "Review the new $1.20 bill.";
  }, async () => ({ merchant: "Old receipt", totalAmount: 100, currency: "USD", confidence: 1, items: [] }));
  for (let count = 1; count <= 2; count++) {
    await postedReceipt(r.id, "@Tab split this receipt");
    const receipt = (await dinner.memberRoom(r.id, alice)).messages.at(-1)!;
    await service.respond(alice, { kind: "room", roomId: r.id }, receipt.id);
    const before = await db.collection("dinner-pending-expenses").find({ roomId: r.id }).toArray();
    const source = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "tab can you create a bill of $1.2 split evenly between everyone in this groud. i paid" });
    const result = await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
    assert.match(result.text, /new \$1.20/);
    assert.deepEqual(await db.collection("dinner-pending-expenses").find({ roomId: r.id }).toArray(), before);
    const proposals = await service.roomProposals(alice, r.id);
    assert.equal(proposals.length, count);
    assert.equal(proposals[0].fields.totalCents, 120);
    assert.ok(!proposals[0].fields.attachmentId);
    assert.equal((await dinner.memberRoom(r.id, alice)).expenses.length, 0);
  }
  const confirm = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "@Tab yes confirm" });
  const result = await service.respond(alice, { kind: "room", roomId: r.id }, confirm.id);
  assert.match(result.text, /Edit.*Confirm/);
  assert.doesNotMatch(result.text, /unfinished|drafts need details/);
  assert.equal((await dinner.memberRoom(r.id, alice)).expenses.length, 0);
});

test("generic bill talk does not reopen receipt drafts outside their conversation", async () => {
  const r = await joined();
  const service = new DinnerAgentService(db, dinner, async context => {
    const pending = await context.pendingExpense!();
    if (context.request?.text.includes("receipt")) {
      assert.ok(pending);
      return (await pending.current()).reply;
    }
    assert.equal(pending, null);
    const facts = await context.readRoom(r.id) as { receiptDrafts: unknown[] };
    assert.deepEqual(facts.receiptDrafts, []);
    return "I can help with a new bill.";
  }, async () => ({ merchant: "Old cafe", totalAmount: 100, currency: "USD", confidence: 1, items: [] }));
  await postedReceipt(r.id, "@Tab split this receipt");
  const source = (await dinner.memberRoom(r.id, alice)).messages.at(-1)!;
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  await dinner.send(r.id, bob, { clientId: randomUUID(), text: "New topic" });
  const before = await db.collection("dinner-pending-expenses").find({ roomId: r.id }).toArray();
  for (const text of ["@Tab how do bills work?", "@Tab everyone split equally", "@Tab I paid", "@Tab lets create a new tab"]) {
    const message = await dinner.send(r.id, alice, { clientId: randomUUID(), text });
    await service.respond(alice, { kind: "room", roomId: r.id }, message.id);
  }
  assert.deepEqual(await db.collection("dinner-pending-expenses").find({ roomId: r.id }).toArray(), before);
});


test("old explicit reply supplies bounded provenance to routing and generation and records the decision trace", async () => {
  const r = await joined();
  const start = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "@Tab dinner question" });
  const reply = await dinner.botReply(r.id, alice, start.id, "Dinner is $60. What do you want to know?", true);
  for (let i = 0; i < 30; i++) await dinner.send(r.id, bob, { clientId: randomUUID(), text: `Taxi discussion ${i}` });
  const source = await dinner.send(r.id, alice, { clientId: randomUUID(), text: "Which bill is this?", replyTo: reply.id });
  const service = new DinnerAgentService(db, dinner, async context => {
    assert.equal(context.historyCoverage?.visibleMessages, 25);
    assert.equal(context.coordination?.trigger, "explicit_reply");
    assert.deepEqual(context.coordination?.replyChain.map(m => m.id), [reply.id, start.id]);
    assert.equal(context.coordination?.replyTo, reply.id);
    await context.readContext();
    return "The dinner bill.";
  }, undefined, undefined, async input => {
    assert.ok(input.conversation.some(m => m.content.includes(reply.id) && m.content.includes("Dinner is $60")));
    return { action: "lookup", lookupKind: "specific_record" };
  });
  await service.respond(alice, { kind: "room", roomId: r.id }, source.id);
  const run = await db.collection("dinner-agent-runs").findOne({ "coordination.sourceId": source.id });
  assert.equal(run?.coordination.replyTo, reply.id);
  assert.equal(run?.coordination.action, "lookup");
  assert.ok(run?.publishedReplyId);
  assert.ok(run?.factsRead);
});

test("greetings and exact ledger questions reply even when every model classifier is unavailable", async () => {
  const { runTabAgent } = await import("../../src/lib/dinner/agent/runtime");
  const r = await joined();
  const unavailable = async () => { throw new Error("Provider unavailable: must not be called"); };
  const service = new DinnerAgentService(db, dinner, runTabAgent, undefined, unavailable, unavailable, unavailable, unavailable, 0);
  const balance = await dinner.send(r.id, alice, {clientId: randomUUID(), text: "@Tab who owes whom?"});
  const greeting = await dinner.send(r.id, alice, {clientId: randomUUID(), text: "hi @tab"});
  await dinner.setAssistance(r.id, alice, "smart");
  await dinner.change(r.id, alice, room => {
    room.assistance!.authorized.push(balance.id);
    room.assistance!.offer = {sourceId: balance.id, topicId: balance.id, acceptedSourceId: balance.id, acceptedBy: alice.id, status: "accepted", createdAt: balance.createdAt};
  });
  const answer = await service.respond(alice, {kind: "room", roomId: r.id}, balance.id);
  assert.equal(answer.status, "complete");
  assert.match(answer.text, /no outstanding/i);
  const hello = await service.respond(alice, {kind: "room", roomId: r.id}, greeting.id);
  assert.equal(hello.status, "complete");
  assert.match(hello.text, /Hi Alice/);
  await service.respond(alice, {kind: "room", roomId: r.id}, greeting.id);
  const saved = await dinner.memberRoom(r.id, alice);
  assert.equal(saved.messages.filter(m => m.kind === "tab").length, 2);
  assert.equal(saved.expenses.length, 0);
});
