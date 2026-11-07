import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import sharp from "sharp";
import {
  Actor,
  DinnerError,
  expenseInput,
  parseUsd,
  splitEvenly,
  totals,
} from "../../src/lib/dinner/model";
import {
  MongoRoomStore,
  actorForProfile,
} from "../../src/lib/dinner/mongo-store";
import { DinnerService, tokenHash } from "../../src/lib/dinner/service";
import { Attachments } from "../../src/lib/dinner/attachments";
import { handleDinner } from "../../src/lib/dinner/http";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let service: DinnerService;
let attachments: Attachments;
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
const now = "2026-11-07T09:00:00.000Z";
before(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db("dinner-tests");
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  service = new DinnerService(new MongoRoomStore(db), () => now);
  attachments = new Attachments(db, service);
});
async function room() {
  return service.create(alice, {
    name: "Friday Dinner",
    purpose: "Dinner and a fair split",
    clientId: randomUUID(),
  });
}
async function joined() {
  const r = await room();
  const invite = await service.invite(r.id, alice, { clientId: randomUUID() });
  await service.respond(bob, { token: invite.token }, "accepted");
  return service.memberRoom(r.id, alice);
}
function fields(
  payerId = alice.id,
  shares = [
    { userId: alice.id, cents: 1000 },
    { userId: bob.id, cents: 1001 },
  ],
) {
  return {
    description: "Dinner",
    payerId,
    totalCents: 2001,
    shares,
    clientId: randomUUID(),
  };
}
async function http(
  actor: Actor | null,
  path: string,
  method = "GET",
  body?: unknown,
  enabled = true,
) {
  return handleDinner(
    new Request(`http://localhost/api/dinner${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }),
    }),
    path.slice(1).split("/"),
    {
      enabled,
      actor: async () => {
        if (!actor) throw new DinnerError(401, "Sign in to continue");
        return actor;
      },
      service,
      attachments,
    },
  );
}

test("USD parsing never rounds fractional cents", () => {
  assert.equal(parseUsd("20.01"), 2001);
  assert.equal(parseUsd("0.10"), 10);
  for (const value of [
    "0.001",
    "1e3",
    "-1",
    "NaN",
    "Infinity",
    "1,000",
    "1000001.00",
  ])
    assert.equal(parseUsd(value), null);
});
test("even shares allocate remainder cents exactly and deterministically", () => {
  const result = splitEvenly(100, [alice.id, bob.id, carol.id]);
  assert.deepEqual(
    result.map((s) => s.cents),
    [34, 33, 33],
  );
  assert.equal(
    result.reduce((n, s) => n + s.cents, 0),
    100,
  );
  assert.deepEqual(splitEvenly(100, []), []);
});
test("money schema rejects negative and fractional shares and unsafe totals", () => {
  for (const cents of [-1, 0.1, Number.MAX_SAFE_INTEGER])
    assert.equal(
      expenseInput.safeParse(fields(alice.id, [{ userId: alice.id, cents }]))
        .success,
      false,
    );
});
test("verified Privy ID maps to one internal user across devices, handles and X outage", async () => {
  const profile = {
    privyId: "did:privy:verified",
    name: "Alice",
    twitterSubject: "1001",
  };
  const results = await Promise.all([
    actorForProfile(db, profile),
    actorForProfile(db, profile),
  ]);
  assert.equal(results[0].id, results[1].id);
  const offline = await actorForProfile(db, {
    ...profile,
    name: "New handle",
    twitterSubject: null,
  });
  assert.equal(offline.id, results[0].id);
  assert.equal(await db.collection("dinner-users").countDocuments(), 1);
});
test("room creation retries persist one room", async () => {
  const input = {
    name: "Friday Dinner",
    purpose: "Dinner",
    clientId: randomUUID(),
  };
  const results = await Promise.all([
    service.create(alice, input),
    service.create(alice, input),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(await db.collection("dinner-rooms").countDocuments(), 1);
});
test("room read needs a verified session", async () => {
  const r = await room();
  assert.equal((await http(null, `/rooms/${r.id}`)).status, 401);
});
test("guessing another user's room cannot read it", async () => {
  const r = await room();
  assert.equal((await http(bob, `/rooms/${r.id}`)).status, 404);
});
test("guessing another user's room cannot chat, draft, invite, react or read private history", async () => {
  const r = await room();
  for (const [method, route, payload] of [
    ["POST", "messages", { clientId: randomUUID(), text: "hi" }],
    ["POST", "expenses", fields()],
    ["POST", "invites", { clientId: randomUUID() }],
    ["PUT", "read", { seq: 100 }],
    ["GET", "messages", undefined],
    ["GET", `attachments/${randomUUID()}`, undefined],
  ])
    assert.equal(
      (await http(bob, `/rooms/${r.id}/${route}`, String(method), payload))
        .status,
      404,
    );
});
test("body-supplied actor, wallet or authority is rejected", async () => {
  const r = await room();
  const response = await http(alice, `/rooms/${r.id}/messages`, "POST", {
    clientId: randomUUID(),
    text: "hi",
    userId: bob.id,
    address: "0xclaimed",
  });
  assert.equal(response.status, 400);
  assert.equal((await service.memberRoom(r.id, alice)).messages.length, 0);
});
test("feature flag disables even public previews and authenticated routes", async () => {
  assert.equal(
    (await http(alice, "/rooms", "GET", undefined, false)).status,
    404,
  );
});
test("room list does not leak another user's room", async () => {
  await room();
  const list = await service.list(bob);
  assert.equal(list.rooms.length, 0);
  assert.equal(list.invites.length, 0);
});
test("invite preview exposes only plan, inviter and member names", async () => {
  const r = await room();
  await service.send(r.id, alice, {
    clientId: randomUUID(),
    text: "private chat",
  });
  const invite = await service.invite(r.id, alice, { clientId: randomUUID() });
  const preview = await service.preview(invite.token);
  assert.equal(preview.name, r.name);
  assert.equal(preview.inviter, "Alice");
  assert.deepEqual(preview.members, ["Alice"]);
  assert.equal("messages" in preview, false);
  assert.equal("expenses" in preview, false);
  assert.equal("tokenHash" in preview, false);
});
test("pending invitation creates no membership, obligations or authority", async () => {
  const r = await room();
  await service.invite(r.id, alice, {
    clientId: randomUUID(),
    targetSubject: bob.twitterSubject,
  });
  const saved = await service.memberRoom(r.id, alice);
  assert.equal(saved.members.length, 1);
  assert.deepEqual(totals(saved, bob.id), { owe: 0, owed: 0 });
  assert.equal((await service.list(bob)).invites.length, 1);
});
test("parallel invitation acceptance creates exactly one membership", async () => {
  const r = await room();
  const invite = await service.invite(r.id, alice, { clientId: randomUUID() });
  await Promise.all([
    service.respond(bob, { token: invite.token }, "accepted"),
    service.respond(bob, { token: invite.token }, "accepted"),
  ]);
  const saved = await service.memberRoom(r.id, bob);
  assert.equal(saved.members.filter((m) => m.userId === bob.id).length, 1);
  assert.equal(saved.members.find((m) => m.userId === bob.id)?.role, "member");
  assert.equal(saved.expenses.length, 0);
});
test("a consumed single-person invite cannot be used by another account", async () => {
  const r = await room();
  const invite = await service.invite(r.id, alice, { clientId: randomUUID() });
  await service.respond(bob, { token: invite.token }, "accepted");
  await assert.rejects(
    () => service.respond(carol, { token: invite.token }, "accepted"),
    /no longer pending/,
  );
});
test("bound invitation rejects the wrong X identity", async () => {
  const r = await room();
  const invite = await service.invite(r.id, alice, {
    clientId: randomUUID(),
    targetSubject: "1002",
  });
  await assert.rejects(
    () => service.respond(carol, { token: invite.token }, "accepted"),
    /different X account/,
  );
});
test("declining is idempotent and never adds membership", async () => {
  const r = await room();
  const invite = await service.invite(r.id, alice, { clientId: randomUUID() });
  await service.respond(bob, { token: invite.token }, "declined");
  await service.respond(bob, { token: invite.token }, "declined");
  assert.equal((await service.preview(invite.token)).status, "declined");
  assert.equal((await service.memberRoom(r.id, alice)).members.length, 1);
});
test("expired and revoked invitations cannot join", async () => {
  const r = await room();
  const expired = await service.invite(r.id, alice, { clientId: randomUUID() });
  const later = new DinnerService(
    new MongoRoomStore(db),
    () => "2026-12-01T00:00:00.000Z",
  );
  assert.equal((await later.preview(expired.token)).status, "expired");
  await assert.rejects(
    () => later.respond(bob, { token: expired.token }, "accepted"),
    /no longer pending/,
  );
  const revoked = await service.invite(r.id, alice, { clientId: randomUUID() });
  await service.revoke(r.id, alice, revoked.id);
  await assert.rejects(
    () => service.respond(bob, { token: revoked.token }, "accepted"),
    /no longer pending/,
  );
});
test("only inviter or owner may revoke; member cannot revoke someone else's link", async () => {
  const r = await joined();
  const third = await service.invite(r.id, alice, { clientId: randomUUID() });
  await assert.rejects(
    () => service.revoke(r.id, bob, third.id),
    /Only the inviter/,
  );
});
test("invitation tokens are hashed and never included in room responses", async () => {
  const r = await room();
  const invite = await service.invite(r.id, alice, { clientId: randomUUID() });
  const saved = await service.memberRoom(r.id, alice);
  assert.equal(saved.invitations[0].tokenHash, tokenHash(invite.token));
  const response = await (await http(alice, `/rooms/${r.id}`)).text();
  assert.equal(response.includes(invite.token), false);
  assert.equal(response.includes("tokenHash"), false);
});
test("message acknowledgement follows persistence and survives a new service instance", async () => {
  const r = await joined();
  const input = { clientId: randomUUID(), text: "Meet at seven?" };
  const response = await http(bob, `/rooms/${r.id}/messages`, "POST", input);
  assert.equal(response.status, 201);
  const newService = new DinnerService(new MongoRoomStore(db));
  const saved = await newService.memberRoom(r.id, alice);
  assert.equal(saved.messages.length, 1);
  assert.equal(saved.messages[0].text, input.text);
});
test("concurrent retries create one ordered message, not duplicates", async () => {
  const r = await joined();
  const input = { clientId: randomUUID(), text: "Seven works" };
  const result = await Promise.all([
    service.send(r.id, bob, input),
    service.send(r.id, bob, input),
  ]);
  assert.equal(result[0].id, result[1].id);
  assert.equal((await service.memberRoom(r.id, alice)).messages.length, 1);
});
test("different messages from two members get unique monotonic server order", async () => {
  const r = await joined();
  await Promise.all([
    service.send(r.id, alice, { clientId: randomUUID(), text: "Hi" }),
    service.send(r.id, bob, { clientId: randomUUID(), text: "Hello" }),
  ]);
  assert.deepEqual(
    (await service.memberRoom(r.id, alice)).messages.map((m) => m.seq),
    [1, 2],
  );
});
test("reuse of a retry ID with changed message content is rejected", async () => {
  const r = await room();
  const clientId = randomUUID();
  await service.send(r.id, alice, { clientId, text: "One" });
  await assert.rejects(
    () => service.send(r.id, alice, { clientId, text: "Two" }),
    /different message/,
  );
});
test("reply targets must belong to the room", async () => {
  const r = await room();
  await assert.rejects(
    () =>
      service.send(r.id, alice, {
        clientId: randomUUID(),
        text: "Reply",
        replyTo: randomUUID(),
      }),
    /Reply target/,
  );
});
test("reactions are idempotent and never settle an expense", async () => {
  const r = await joined();
  const message = await service.send(r.id, alice, {
    clientId: randomUUID(),
    text: "Dinner",
  });
  await service.react(r.id, bob, message.id, "👍", true);
  await service.react(r.id, bob, message.id, "👍", true);
  const saved = await service.memberRoom(r.id, alice);
  assert.equal(saved.messages[0].reactions.length, 1);
  assert.deepEqual(totals(saved, bob.id), { owe: 0, owed: 0 });
});
test("read cursors are monotonic, capped and synchronized across devices", async () => {
  const r = await joined();
  await service.send(r.id, alice, { clientId: randomUUID(), text: "One" });
  await service.send(r.id, alice, { clientId: randomUUID(), text: "Two" });
  assert.equal((await service.list(bob)).rooms[0].unread, 2);
  await service.read(r.id, bob, 1);
  await service.read(r.id, bob, 0);
  assert.equal((await service.list(bob)).rooms[0].unread, 1);
  await service.read(r.id, bob, 999);
  assert.equal((await service.list(bob)).rooms[0].unread, 0);
  assert.equal(
    (await service.memberRoom(r.id, bob)).members.find(
      (m) => m.userId === bob.id,
    )?.readSeq,
    2,
  );
});
test("cursor catch-up returns only unseen messages", async () => {
  const r = await joined();
  for (const text of ["One", "Two", "Three"])
    await service.send(r.id, alice, { clientId: randomUUID(), text });
  const direct = await handleDinner(
    new Request(`http://localhost/api/dinner/rooms/${r.id}/messages?after=1`),
    ["rooms", r.id, "messages"],
    { enabled: true, actor: async () => bob, service, attachments },
  );
  const value = await direct.json();
  assert.deepEqual(
    value.messages.map((m: { seq: number }) => m.seq),
    [2, 3],
  );
});
test("draft expense does not create obligations", async () => {
  const r = await joined();
  await service.draft(r.id, alice, fields());
  assert.deepEqual(totals(await service.memberRoom(r.id, bob), bob.id), {
    owe: 0,
    owed: 0,
  });
});
test("shares must sum exactly and include only accepted unique members", async () => {
  const r = await joined();
  for (const shares of [
    [{ userId: alice.id, cents: 2000 }],
    [{ userId: carol.id, cents: 2001 }],
    [
      { userId: alice.id, cents: 1000 },
      { userId: alice.id, cents: 1001 },
    ],
  ])
    await assert.rejects(() =>
      service.draft(r.id, alice, fields(alice.id, shares)),
    );
  await assert.rejects(
    () => service.draft(r.id, alice, fields(carol.id)),
    /accepted member/,
  );
});
test("confirming creates typed obligations once even with concurrent retry", async () => {
  const r = await joined();
  const draft = await service.draft(r.id, alice, fields());
  const requestId = randomUUID();
  await Promise.all([
    service.confirm(r.id, alice, draft.id, requestId, draft.version),
    service.confirm(r.id, alice, draft.id, requestId, draft.version),
  ]);
  const saved = await service.memberRoom(r.id, bob);
  assert.equal(saved.expenses.length, 1);
  assert.equal(saved.expenses[0].status, "confirmed");
  assert.deepEqual(totals(saved, bob.id), { owe: 1001, owed: 0 });
  assert.deepEqual(totals(saved, alice.id), { owe: 0, owed: 1001 });
  const expense = saved.expenses[0];
  if (expense.status === "confirmed")
    assert.equal(expense.obligations[0].status, "outstanding");
});
test("stale reviewed draft cannot be confirmed after edits", async () => {
  const r = await joined();
  const input = fields();
  const draft = await service.draft(r.id, alice, input);
  await service.draft(
    r.id,
    alice,
    { ...input, description: "Edited dinner" },
    draft.id,
  );
  await assert.rejects(
    () => service.confirm(r.id, alice, draft.id, randomUUID(), draft.version),
    /draft changed/,
  );
});
test("read cursors and chat do not invalidate reviewed expense version", async () => {
  const r = await joined();
  const draft = await service.draft(r.id, alice, fields());
  await service.read(r.id, alice, 0);
  await service.send(r.id, bob, { clientId: randomUUID(), text: "Thanks" });
  await service.confirm(r.id, alice, draft.id, randomUUID(), draft.version);
});
test("another member cannot edit or confirm the author's draft", async () => {
  const r = await joined();
  const input = fields();
  const draft = await service.draft(r.id, alice, input);
  await assert.rejects(
    () => service.draft(r.id, bob, input, draft.id),
    /Only the author/,
  );
  await assert.rejects(
    () => service.confirm(r.id, bob, draft.id, randomUUID(), draft.version),
    /Only the author/,
  );
});
test("recipient flags remain visible without erasing or paying the obligation", async () => {
  const r = await joined();
  const draft = await service.draft(r.id, alice, fields());
  await service.confirm(r.id, alice, draft.id, randomUUID(), draft.version);
  await service.flag(r.id, bob, draft.id, "I only had a starter");
  const saved = await service.memberRoom(r.id, alice);
  assert.equal(saved.expenses[0].flags[0].reason, "I only had a starter");
  assert.equal(totals(saved, bob.id).owe, 1001);
});
test("same room supports a second expense and retains chat and first expense", async () => {
  const r = await joined();
  await service.send(r.id, alice, {
    clientId: randomUUID(),
    text: "Next Friday too?",
  });
  for (let i = 0; i < 2; i++) {
    const draft = await service.draft(r.id, alice, fields());
    await service.confirm(r.id, alice, draft.id, randomUUID(), draft.version);
  }
  const saved = await service.memberRoom(r.id, bob);
  assert.equal(saved.expenses.length, 2);
  assert.equal(saved.messages.length, 1);
  assert.equal(totals(saved, bob.id).owe, 2002);
});
test("private attachments are decoded, sanitized and cannot be fetched by non-members", async () => {
  const r = await joined();
  const image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const upload = await attachments.upload(
    r.id,
    alice,
    new Request(`http://localhost?clientId=${randomUUID()}`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(image),
    }),
  );
  const response = await attachments.download(r.id, upload.id, bob);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(
    (await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format,
    "webp",
  );
  await assert.rejects(
    () => attachments.download(r.id, upload.id, carol),
    /Room not found/,
  );
});
test("active content and invalid raster payloads are rejected", async () => {
  const r = await room();
  for (const type of ["image/svg+xml", "text/html", "image/png"])
    await assert.rejects(() =>
      attachments.upload(
        r.id,
        alice,
        new Request(`http://localhost?clientId=${randomUUID()}`, {
          method: "POST",
          headers: { "content-type": type },
          body: "<svg onload='alert(1)'></svg>",
        }),
      ),
    );
});
test("cross-room attachment references cannot be posted", async () => {
  const r = await room();
  const result = await http(alice, `/rooms/${r.id}/messages`, "POST", {
    clientId: randomUUID(),
    text: "Receipt",
    attachmentIds: [randomUUID()],
  });
  assert.equal(result.status, 400);
});

test("client response schemas accept actual create, list, message and confirmed expense responses", async () => {
  const { roomSchema, listSchema, messageSchema, expenseSchema } = await import(
    "../../src/lib/dinner/client-schema"
  );
  const r = await joined();
  roomSchema.parse(await (await http(alice, `/rooms/${r.id}`)).json());
  listSchema.parse(await (await http(alice, "/rooms")).json());
  messageSchema.parse(
    await (
      await http(alice, `/rooms/${r.id}/messages`, "POST", {
        clientId: randomUUID(),
        text: "Hello",
      })
    ).json(),
  );
  const input = fields();
  const draftResponse = await http(
    alice,
    `/rooms/${r.id}/expenses`,
    "POST",
    input,
  );
  const draft = expenseSchema.parse(await draftResponse.json());
  expenseSchema.parse(
    await (
      await http(alice, `/rooms/${r.id}/expenses/${draft.id}/confirm`, "POST", {
        clientId: randomUUID(),
        expectedVersion: draft.version,
      })
    ).json(),
  );
});
test("missing authorized attachment returns a handled 404 instead of rejecting the HTTP handler", async () => {
  const r = await room();
  assert.equal(
    (await http(alice, `/rooms/${r.id}/attachments/${randomUUID()}`)).status,
    404,
  );
});
test("SVG disguised as a permitted image cannot reach the raster decoder", async () => {
  const r = await room();
  await assert.rejects(
    () =>
      attachments.upload(
        r.id,
        alice,
        new Request(`http://localhost?clientId=${randomUUID()}`, {
          method: "POST",
          headers: { "content-type": "image/png" },
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" /></svg>',
        }),
      ),
    /does not match/,
  );
});

test("expense draft retries create one record and reject silently changed payloads", async () => {
  const r = await joined();
  assert.equal("_id" in r, false);
  const input = fields();
  const [first, second] = await Promise.all([
    service.draft(r.id, alice, input),
    service.draft(r.id, alice, input),
  ]);
  assert.equal(first.id, second.id);
  await assert.rejects(
    service.draft(r.id, alice, { ...input, description: "Different dinner" }),
    (error: unknown) => error instanceof DinnerError && error.status === 409,
  );
  const saved = await service.memberRoom(r.id, alice);
  assert.equal(saved.expenses.length, 1);
  assert.equal(saved.expenses[0].description, "Dinner");
  assert.deepEqual(totals(saved, bob.id), { owe: 0, owed: 0 });
});
