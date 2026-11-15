import "./dom";
import { AgentSettings } from "../../src/components/dinner/AgentSettings";
import React, { useState, useRef, useCallback } from "react";
import { before, after, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  render,
  configure,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
  act,
} from "@testing-library/react";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { DinnerContext } from "../../src/components/dinner/DinnerShell";
import { Members } from "../../src/components/dinner/Members";
import { Money } from "../../src/components/dinner/Money";
import { DinnerAgentService } from "../../src/lib/dinner/agent/service";
import { AgentRunner } from "../../src/lib/dinner/agent/capabilities";
import { PersonalAgent } from "../../src/components/dinner/PersonalAgent";
import { RoomPlan } from "../../src/components/dinner/Coordination";
import { PrivateReminders } from "../../src/components/dinner/PrivateReminders";
import { Chat } from "../../src/components/dinner/Chat";
import { DinnerService } from "../../src/lib/dinner/service";
import { MongoRoomStore } from "../../src/lib/dinner/mongo-store";
import { Attachments } from "../../src/lib/dinner/attachments";
import { handleDinner } from "../../src/lib/dinner/http";
import { Actor, RoomView, roomView, totals } from "../../src/lib/dinner/model";

// These journeys exercise real MongoDB/API work; a one-second DOM deadline
// measures host contention rather than whether the requested action completes.
configure({ asyncUtilTimeout: 10000 });

let mongo: MongoMemoryServer;
let client: MongoClient;
let service: DinnerService;
let attachments: Attachments;
let initial: RoomView;
let agent: DinnerAgentService;
let agentRunner: AgentRunner;
const alice: Actor = {
  id: randomUUID(),
  name: "Alice",
  twitterSubject: "1001",
};
const bob: Actor = { id: randomUUID(), name: "Bob", twitterSubject: "1002" };
before(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
beforeEach(async () => {
  const db = client.db("dinner-ui");
  await db.dropDatabase();
  service = new DinnerService(new MongoRoomStore(db));
  attachments = new Attachments(db, service);
  const created = await service.create(alice, {
    name: "Friday Dinner",
    purpose: "Good company",
    clientId: randomUUID(),
  });
  await service.setAssistance(created.id, alice, "mentions");
  const invite = await service.invite(created.id, alice, {
    clientId: randomUUID(),
  });
  await service.respond(bob, { token: invite.token }, "accepted");
  initial = roomView(await service.memberRoom(created.id, alice));
  agentRunner = async () =>
    "Here is your verified summary. Nothing has been paid.";
  agent = new DinnerAgentService(db, service, (context) =>
    agentRunner(context),
  );
  await agent.session(alice);
});
afterEach(cleanup);
async function api<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
  actor: Actor = alice,
): Promise<T> {
  const response = await handleDinner(
    new Request(`http://localhost/api/dinner${path}`, init),
    path.slice(1).split("/"),
    { enabled: true, actor: async () => actor, service, attachments, agent },
  );
  const raw: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).parse(raw);
    throw new Error(error.error);
  }
  return schema.parse(raw);
}
function Harness({
  members = false,
  chat = false,
  loseAck = false,
  actor = alice,
  personal = false,
  agentSettings = false,
  plan = false,
  reminders = false,
}: {
  members?: boolean;
  chat?: boolean;
  loseAck?: boolean;
  actor?: Actor;
  personal?: boolean;
  agentSettings?: boolean;
  plan?: boolean;
  reminders?: boolean;
}) {
  const lost = useRef(false);
  const request = useCallback(
    async <T,>(
      path: string,
      init: RequestInit,
      schema: z.ZodType<T>,
    ): Promise<T> => {
      const result = await api(path, init, schema, actor);
      if (
        loseAck &&
        !lost.current &&
        path.endsWith("/messages") &&
        init.method === "POST"
      ) {
        lost.current = true;
        throw new Error("Connection interrupted after persistence");
      }
      return result;
    },
    [actor, loseAck],
  );
  const [room, setRoom] = useState(initial);
  async function refresh() {
    setRoom(roomView(await service.memberRoom(room.id, alice)));
  }
  return (
    <DinnerContext.Provider
      value={{
        api: request,
        me: { id: actor.id, name: actor.name },
        image: async () => new Blob(),
      }}
    >
      {agentSettings ? (
        <AgentSettings />
      ) : members ? (
        <Members room={room} refresh={refresh} />
      ) : personal ? (
        <PersonalAgent />
      ) : plan ? (
        <RoomPlan roomId={room.id} />
      ) : reminders ? (
        <PrivateReminders />
      ) : chat ? (
        <Chat room={room} refresh={refresh} />
      ) : (
        <Money room={room} refresh={refresh} />
      )}
    </DinnerContext.Provider>
  );
}
async function draftDinner() {
  fireEvent.click(screen.getByRole("button", { name: /Add expense/ }));
  fireEvent.change(screen.getByLabelText("What was it for?"), {
    target: { value: "Friday noodles" },
  });
  fireEvent.change(screen.getByLabelText("Total (USD)"), {
    target: { value: "120.01" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Alice" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Bob" }));
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByRole("button", { name: "Confirm expense" });
}

test("a member can draft, review and confirm a cent-exact expense through the real HTTP/database path", async () => {
  render(<Harness />);
  await draftDinner();
  assert.equal(
    totals(await service.memberRoom(initial.id, alice), bob.id).owe,
    0,
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm expense" }));
  await screen.findByText("Confirmed expense · obligation record");
  const saved = await service.memberRoom(initial.id, alice);
  assert.equal(totals(saved, bob.id).owe, 6000);
  assert.equal(saved.expenses[0].totalCents, 12001);
  assert.equal(screen.queryByRole("button", { name: /^pay|settle/i }), null);
});

test("editing individual shares cannot save a draft that does not add up", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: /Add expense/ }));
  fireEvent.change(screen.getByLabelText("What was it for?"), {
    target: { value: "Dinner" },
  });
  fireEvent.change(screen.getByLabelText("Total (USD)"), {
    target: { value: "10.00" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Bob" }));
  fireEvent.change(screen.getByLabelText("Bob’s share in USD"), {
    target: { value: "9.99" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByRole("alert");
  assert.equal(
    (await service.memberRoom(initial.id, alice)).expenses.length,
    0,
  );
});

test("chat send and reply persist without reaction controls", async () => {
  render(<Harness chat />);
  fireEvent.change(screen.getByLabelText("Message the room"), {
    target: { value: "Seven at the corner place?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Sent");
  assert.equal(
    (await service.memberRoom(initial.id, bob)).messages[0].text,
    "Seven at the corner place?",
  );
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  fireEvent.change(screen.getByLabelText("Message the room"), {
    target: { value: "Receipt coming next" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => assert.equal(screen.getAllByText("Sent").length, 2));
  assert.equal(screen.queryByRole("button", { name: "React 👍" }), null);
  const saved = await service.memberRoom(initial.id, bob);
  assert.equal(saved.messages[1].replyTo, saved.messages[0].id);
  assert.deepEqual(totals(saved, bob.id), { owe: 0, owed: 0 });
});

test("a lost message acknowledgement is shown as retryable, then retries without duplicates", async () => {
  render(<Harness chat loseAck />);
  fireEvent.change(screen.getByLabelText("Message the room"), {
    target: { value: "See you Friday" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Send not confirmed");
  assert.equal(screen.queryByText("Sent"), null);
  assert.equal((await service.memberRoom(initial.id, bob)).messages.length, 1);
  fireEvent.click(screen.getByRole("button", { name: "Retry same message" }));
  await screen.findByText("Sent");
  assert.equal((await service.memberRoom(initial.id, bob)).messages.length, 1);
});

async function outsideReady() {
  const draft = await service.draft(initial.id, alice, {
    clientId: randomUUID(),
    description: "Noodles",
    totalCents: 5001,
    payerId: alice.id,
    shares: [
      { userId: alice.id, cents: 2501 },
      { userId: bob.id, cents: 2500 },
    ],
  });
  await service.confirm(
    initial.id,
    alice,
    draft.id,
    randomUUID(),
    draft.version,
  );
  initial = roomView(await service.memberRoom(initial.id, alice));
}
test("a debtor reports outside payment, then the recipient explicitly reviews and confirms receipt", async () => {
  await outsideReady();
  const view = render(<Harness actor={bob} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Report paid outside Tab" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Submit outside report" }),
  );
  await screen.findByText("Reported paid outside Tab");
  assert.equal(
    totals(await service.memberRoom(initial.id, bob), bob.id).owe,
    2500,
  );
  assert.equal(
    screen.queryByRole("button", { name: "Review outside report" }),
    null,
  );
  view.rerender(<Harness actor={alice} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Review outside report" }),
  );
  assert.ok(screen.getByText("Did you receive this money outside Tab?"));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm I received this outside Tab" }),
  );
  await waitFor(async () =>
    assert.equal(
      totals(await service.memberRoom(initial.id, bob), bob.id).owe,
      0,
    ),
  );
  await waitFor(() =>
    assert.ok(!screen.queryByRole("button", { name: "Review outside report" })),
  );
  assert.ok(screen.getByText(/This is not a Tab payment receipt/));
  assert.ok(screen.getByText("Reported paid outside Tab"));
});
test("the reporting debtor can cancel while unconfirmed without clearing the share", async () => {
  await outsideReady();
  render(<Harness actor={bob} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Report paid outside Tab" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Submit outside report" }),
  );
  await screen.findByText("Reported paid outside Tab");
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel unconfirmed report" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel outside report" }),
  );
  await screen.findByRole("button", { name: "Report paid outside Tab" });
  assert.equal(
    totals(await service.memberRoom(initial.id, bob), bob.id).owe,
    2500,
  );
  assert.ok(screen.getByText(/Reporter cancelled this report/));
});

test("a persisted @Tab message automatically gets a distinct saved bot reply, ordinary chat remains quiet", async () => {
  render(<Harness chat />);
  fireEvent.change(screen.getByLabelText("Message the room"), {
    target: { value: "Ordinary dinner conversation" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Sent");
  assert.equal(
    (await service.memberRoom(initial.id, alice)).messages.length,
    1,
  );
  fireEvent.change(screen.getByLabelText("Message the room"), {
    target: { value: "@Tab who owes whom?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Here is your verified summary. Nothing has been paid.");
  assert.ok(
    screen.getByText("Here is your verified summary. Nothing has been paid."),
  );
  const saved = await service.memberRoom(initial.id, bob);
  assert.equal(saved.messages.length, 3);
  assert.equal(saved.messages[2].kind, "tab");
});
test("chat bill review edits a canonical draft and records debt only after human confirmation", async () => {
  agentRunner = async (context) => {
    if (context.scope.kind !== "room") throw new Error("Expected room");
    await context.prepareExpense({
      roomId: context.scope.roomId,
      description: "Shared noodles",
      totalCents: 5001,
      payerId: alice.id,
      shares: [
        { userId: alice.id, cents: 2501 },
        { userId: bob.id, cents: 2500 },
      ],
    });
    return "Review the proposed split below.";
  };
  render(<Harness chat />);
  fireEvent.change(screen.getByLabelText("Message the room"), {
    target: { value: "@Tab prepare our $50.01 bill. I paid. Everyone split equally." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const save = await screen.findByRole("button", {
    name: "Edit",
  });
  assert.equal((await service.memberRoom(initial.id, bob)).expenses.length, 0);
  fireEvent.click(save);
  await screen.findByRole("region", { name: "Edit bill" });
  const saved = await service.memberRoom(initial.id, bob);
  assert.equal(saved.expenses[0].status, "draft");
  assert.equal(totals(saved, bob.id).owe, 0);
  const billId = saved.expenses[0].id;
  const review = within(screen.getByRole("region", { name: "Edit bill" }));
  fireEvent.change(review.getByLabelText("Total (USD)"), { target: { value: "60.01" } });
  assert.equal(review.queryByRole("button", { name: "Confirm" }), null);
  fireEvent.click(review.getByRole("button", { name: "Split equally" }));
  fireEvent.click(review.getByRole("button", { name: "Save changes" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(totals(await service.memberRoom(initial.id, bob), bob.id).owe, 0);
  fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));
  await screen.findByText("Confirmed", { exact: true });
  const confirmed = await service.memberRoom(initial.id, bob);
  assert.equal(confirmed.expenses.length, 1);
  assert.equal(confirmed.expenses[0].id, billId);
  assert.equal(confirmed.expenses[0].status, "confirmed");
  assert.deepEqual(confirmed.expenses[0].shares.map(s => s.cents).sort(), [3000, 3001]);
  assert.equal(totals(confirmed, bob.id).owe, bob.id < alice.id ? 3001 : 3000);
  cleanup();
  initial = roomView(confirmed);
  render(<Harness />);
  await screen.findByText("Confirmed expense · obligation record");
  assert.ok(screen.getAllByText(/Shared noodles/).length);
});
test("the private agent restores its server conversation and explicit preferences after remount", async () => {
  let view = render(<Harness personal />);
  fireEvent.change(await screen.findByLabelText("Message Tab"), {
    target: { value: "What do I owe?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask Tab" }));
  await screen.findByText("Here is your verified summary. Nothing has been paid.");
  view.unmount();
  view = render(<Harness agentSettings />);
  await screen.findByText(/Version 0/);
  fireEvent.change(await screen.findByLabelText("Your preferences"), {
    target: { value: "Keep replies brief" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
  await screen.findByText(/Version 1/);
  view.unmount();
  view = render(<Harness personal />);
  await screen.findByText("What do I owe?");
  assert.equal(
    (await agent.note(alice, { kind: "personal" }, "memory")).value.text,
    "Keep replies brief",
  );
  assert.equal((await agent.session(alice)).messages.length, 2);
  assert.equal((await agent.session(bob)).messages.length, 0);
  view.unmount();
});
test("room Plan saves a shared agreement and a private reminder that appears on Today until dismissed", async () => {
  const view = render(<Harness plan />);
  const areas = await screen.findAllByLabelText("Shared notes");
  await waitFor(() =>
    assert.equal((areas[0] as HTMLTextAreaElement).disabled, false),
  );
  fireEvent.change(areas[0], { target: { value: "Meet Friday at seven" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save notes" })[0]);
  await screen.findByText(/Version 1/);
  assert.equal(
    (await agent.note(bob, { kind: "room", roomId: initial.id }, "agreements"))
      .value.text,
    "Meet Friday at seven",
  );
  fireEvent.change(screen.getByLabelText("When"), {
    target: { value: "2099-01-01T09:00" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save private reminder" }),
  );
  await screen.findByText("Private reminder saved. Find it on Today.");
  view.unmount();
  render(<Harness reminders />);
  await screen.findByText(/Upcoming · Review my outstanding shares/);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss reminder" }));
  await waitFor(async () =>
    assert.equal((await agent.reminders(alice)).length, 0),
  );
  assert.equal((await agent.reminders(bob)).length, 0);
});
test("room suggested prompts only prefill an @Tab message; nothing is sent until the member sends it", async () => {
  render(<Harness chat />);
  fireEvent.click(screen.getByRole("button", { name: "@Tab who owes whom?" }));
  const box = screen.getByLabelText<HTMLTextAreaElement>("Message the room");
  assert.equal(box.value, "@Tab who owes whom?");
  assert.equal(
    (await service.memberRoom(initial.id, alice)).messages.length,
    0,
  );
});

test("Money correction is reviewable, leaves balances unchanged until accepted and shows history", async () => {
  render(<Harness />);
  await draftDinner();
  fireEvent.click(screen.getByRole("button", { name: "Confirm expense" }));
  await screen.findByRole("button", { name: "Correct this expense" });
  const original = totals(
    await service.memberRoom(initial.id, alice),
    bob.id,
  ).owe;
  fireEvent.click(screen.getByRole("button", { name: "Correct this expense" }));
  fireEvent.change(screen.getByLabelText("Total (USD)"), {
    target: { value: "100.00" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save correction proposal" }),
  );
  await screen.findByRole("button", { name: "Accept correction" });
  assert.equal(
    totals(await service.memberRoom(initial.id, alice), bob.id).owe,
    original,
  );
  fireEvent.click(screen.getByRole("button", { name: "Accept correction" }));
  await screen.findByText("Version history and recorded reversals");
  assert.equal(
    totals(await service.memberRoom(initial.id, alice), bob.id).owe,
    5000,
  );
  assert.ok(screen.getByText(/Current version 2/));
});

test("Members discloses removal policy and only removes after the explicit action", async () => {
  render(<Harness members />);
  fireEvent.click(screen.getByRole("button", { name: "Remove Bob" }));
  assert.ok(screen.getByRole("group", { name: "Review member removal" }));
  assert.match(
    screen.getByRole("group", { name: "Review member removal" }).textContent ??
      "",
    /does not forgive debt/,
  );
  assert.equal((await service.memberRoom(initial.id, bob)).members.length, 2);
  fireEvent.click(screen.getByRole("button", { name: "Remove from room" }));
  await waitFor(() =>
    assert.ok(!screen.queryByRole("button", { name: "Remove Bob" })),
  );
  await assert.rejects(service.memberRoom(initial.id, bob));
  assert.equal(
    (await service.memberRoom(initial.id, alice)).removals?.length,
    1,
  );
});


for (const savedFirst of [false, true]) test(`stream handoff has no duplicate or typing flash (saved first: ${savedFirst})`, async () => {
  let finishStream!: () => void;
  let sourceId = "";
  const streamDone = new Promise<void>((resolve) => { finishStream = resolve; });
  const replyText = "One continuous reply.";
  const context = {
    api,
    me: { id: alice.id, name: alice.name },
    image: async () => new Blob(),
    streamReply: async (_path: string, messageId: string, delta: (text: string) => void) => {
      sourceId = messageId;
      delta(replyText);
      await streamDone;
      return { status: "complete", text: replyText };
    },
  };
  const show = (room: RoomView) => (
    <DinnerContext.Provider value={context}>
      <Chat room={room} refresh={async () => {}} />
    </DinnerContext.Provider>
  );
  const view = render(show(initial));
  fireEvent.change(screen.getByRole("textbox", { name: "Message the room" }), { target: { value: "@Tab hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(replyText);
  if (!savedFirst) await act(async () => { finishStream(); await streamDone; });
  await waitFor(() => assert.equal(screen.queryByLabelText("Tab is typing"), null));
  assert.equal(screen.getAllByText(replyText).length, 1);
  // Simulate a poll/refresh delivering the persisted copy after the stream completed.
  const room = roomView(await service.memberRoom(initial.id, alice));
  view.rerender(show({ ...room, messages: [...room.messages, {
    ...room.messages[0], id: randomUUID(), kind: "tab", text: replyText,
    runId: sourceId, requestedBy: alice.id, seq: room.messages[0].seq + 1,
  }] }));
  await waitFor(() => assert.equal(screen.queryByRole("article", { name: "Tab reply" }), null));
  if (savedFirst) await act(async () => { finishStream(); await streamDone; });
  assert.equal(screen.getAllByText(replyText).length, 1);
  assert.equal(screen.queryByLabelText("Tab is typing"), null);
});

test("Ask Tab clear chat respects cancel and removes confirmed personal history", async () => {
  await agent.personalSend(alice, { clientId: randomUUID(), text: "Clear this personal message" });
  const confirm = window.confirm;
  try {
    window.confirm = () => false;
    render(<Harness personal />);
    await screen.findByText("Clear this personal message");
    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    assert.ok(screen.getByText("Clear this personal message"));
    window.confirm = () => true;
    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    await waitFor(() => assert.ok(!screen.queryByText("Clear this personal message")));
    assert.deepEqual((await agent.session(alice)).messages, []);
    assert.equal(screen.queryByLabelText("Tab is typing"), null);
  } finally {
    window.confirm = confirm;
  }
});

test("cancel a chat draft with confirmation and retain its history in Money", async () => {
  agentRunner = async (context) => {
    await context.prepareExpense({ roomId: initial.id, description: "Cancelled dinner", totalCents: 2000, payerId: alice.id, shares: [{ userId: alice.id, cents: 1000 }, { userId: bob.id, cents: 1000 }] });
    return "Review this bill.";
  };
  const source = await service.send(initial.id, alice, { clientId: randomUUID(), text: "@Tab prepare dinner for $20. I paid. Everyone split equally." });
  await agent.respond(alice, { kind: "room", roomId: initial.id }, source.id);
  initial = roomView(await service.memberRoom(initial.id, alice));
  const originalConfirm = window.confirm;
  try {
    render(<Harness chat />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const review = within(await screen.findByRole("region", { name: "Edit bill" }));
    window.confirm = () => false;
    fireEvent.click(review.getByRole("button", { name: "Cancel bill" }));
    assert.equal((await service.memberRoom(initial.id, alice)).expenses[0].status, "draft");
    window.confirm = () => true;
    fireEvent.click(review.getByRole("button", { name: "Cancel bill" }));
    await screen.findByText("Cancelled", { exact: true });
    await waitFor(() => assert.ok(!screen.queryByRole("button", { name: "Edit" })));
    const saved = await service.memberRoom(initial.id, alice);
    assert.equal(saved.expenses.length, 1);
    assert.equal(saved.expenses[0].status, "cancelled");
    assert.equal(totals(saved, bob.id).owe, 0);
    cleanup();
    initial = roomView(saved);
    render(<Harness />);
    await screen.findByText("Cancelled bill");
    assert.ok(!screen.queryByRole("button", { name: "Confirm expense" }));
  } finally { window.confirm = originalConfirm; }
});

test("owner enables smart assistance and the chat accepts untagged replies to Tab", async () => {
  render(<Harness members />);
  fireEvent.change(screen.getByLabelText("Tab assistance"), { target: { value: "smart" } });
  await waitFor(async () => assert.equal((await service.memberRoom(initial.id, alice)).assistance?.mode, "smart"));
  cleanup();
  const topic = await service.send(initial.id, bob, { clientId: randomUUID(), text: "We should split a USD 60 dinner bill" });
  initial = roomView(await service.memberRoom(initial.id, alice));
  agent = new DinnerAgentService(client.db("dinner-ui"), service, async () => "For you two or everyone?", undefined, async input => ({ action: input.state.offer?.status === "open" ? "accept" : "offer", topicId: topic.id, evidenceIds: [topic.id, input.messages.at(-1)!.id] }));
  render(<Harness chat />);
  const input = screen.getByRole("textbox", { name: /Message/ });
  fireEvent.change(input, { target: { value: "Let's do it" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await screen.findByText("Want me to prepare a bill for that plan?");
  fireEvent.change(input, { target: { value: "Yes" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await screen.findByText("For you two or everyone?");
  assert.equal((await agent.roomProposals(alice, initial.id)).length, 0);
});

test("Confirm on a new bill card skips editing and posts a single group notice", async () => {
  agentRunner = async context => {
    await context.prepareExpense({ roomId: initial.id, description: "Quick dinner", totalCents: 120, payerId: alice.id, shares: [{ userId: alice.id, cents: 60 }, { userId: bob.id, cents: 60 }] });
    return "The bill is ready.";
  };
  const source = await service.send(initial.id, alice, { clientId: randomUUID(), text: "@Tab prepare dinner for $1.20. I paid. Everyone split equally." });
  await agent.respond(alice, { kind: "room", roomId: initial.id }, source.id);
  initial = roomView(await service.memberRoom(initial.id, alice));
  render(<Harness chat />);
  fireEvent.click(await screen.findByRole("button", { name: /^Confirm$/ }));
  await screen.findByText("Confirmed", { exact: true });
  assert.equal(screen.queryByRole("dialog"), null);
  const saved = await service.memberRoom(initial.id, alice);
  assert.equal(saved.expenses.length, 1);
  assert.equal(saved.expenses[0].status, "confirmed");
  assert.equal(saved.messages.filter(m => m.text.includes("Alice confirmed “Quick dinner” · $1.20.")).length, 1);
});
