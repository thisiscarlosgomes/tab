import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
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
  TAB_BOT_ID,
  agentViewSchema,
  proposalSchema,
} from "../../src/lib/dinner/agent/model";
import { messageSchema } from "../../src/lib/dinner/client-schema";
import { loadSkill, skillCatalog } from "../../src/lib/dinner/agent/skills";
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
  return dinner.create(owner, {
    name: "Friday Dinner",
    purpose: "Dinner with friends",
    clientId: randomUUID(),
  });
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
  return new DinnerAgentService(db, dinner, runner);
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
    proposalId = proposal.id;
    await context.recordTool(
      "prepare_expense",
      "room-prepare",
      "review_proposal",
    );
    return "Review the proposal";
  });
  const source = await addressed(r.id, alice, "@Tab split $20.01 equally");
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
  const text = await loadSkill("expense-preparation");
  assert.ok(text.includes('version: "1.0"'));
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
      text: "@Tab who owes whom?",
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
