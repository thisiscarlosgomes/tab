import "./dom";
import React, { useState, useRef, useCallback } from "react";
import { before, after, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { DinnerContext } from "../../src/components/dinner/DinnerShell";
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
  chat = false,
  loseAck = false,
  actor = alice,
  personal = false,
  plan = false,
  reminders = false,
}: {
  chat?: boolean;
  loseAck?: boolean;
  actor?: Actor;
  personal?: boolean;
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
      {personal ? (
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

test("chat send, reply and reaction are visible only after persistence", async () => {
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
  fireEvent.click(screen.getAllByRole("button", { name: "React 👍" })[0]);
  await waitFor(() =>
    assert.equal(
      screen
        .getAllByRole("button", { name: "React 👍" })[0]
        .getAttribute("aria-pressed"),
      "true",
    ),
  );
  await waitFor(async () =>
    assert.equal(
      (await service.memberRoom(initial.id, bob)).messages[0].reactions.length,
      1,
    ),
  );
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
  await screen.findByText("Not sent");
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
    assert.equal(
      screen.queryByRole("button", { name: "Review outside report" }),
      null,
    ),
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
  await screen.findByText("Tab · room assistant");
  assert.ok(
    screen.getByText("Here is your verified summary. Nothing has been paid."),
  );
  const saved = await service.memberRoom(initial.id, bob);
  assert.equal(saved.messages.length, 3);
  assert.equal(saved.messages[2].kind, "tab");
});
test("an addressed split proposal needs a human save and still creates no obligation", async () => {
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
    target: { value: "@Tab prepare our split" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const save = await screen.findByRole("button", {
    name: "Save editable draft",
  });
  assert.equal((await service.memberRoom(initial.id, bob)).expenses.length, 0);
  fireEvent.click(save);
  await screen.findByText("Review saved draft in Money ↗");
  const saved = await service.memberRoom(initial.id, bob);
  assert.equal(saved.expenses[0].status, "draft");
  assert.equal(totals(saved, bob.id).owe, 0);
});
test("the private agent restores its server conversation and explicit preferences after remount", async () => {
  let view = render(<Harness personal />);
  fireEvent.change(screen.getByLabelText("Message Tab"), {
    target: { value: "What do I owe?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask Tab" }));
  await screen.findByText("Tab · personal assistant");
  fireEvent.change(screen.getByLabelText("Your preferences"), {
    target: { value: "Keep replies brief" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
  await screen.findByText(/Version 1/);
  view.unmount();
  view = render(<Harness personal />);
  await screen.findByText("What do I owe?");
  await screen.findByDisplayValue("Keep replies brief");
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
