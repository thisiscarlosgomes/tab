import "./dom";
import React, { useState, useRef } from "react";
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
});
afterEach(cleanup);
async function api<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await handleDinner(
    new Request(`http://localhost/api/dinner${path}`, init),
    path.slice(1).split("/"),
    { enabled: true, actor: async () => alice, service, attachments },
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
}: {
  chat?: boolean;
  loseAck?: boolean;
}) {
  const lost = useRef(false);
  async function request<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const result = await api(path, init, schema);
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
  }
  const [room, setRoom] = useState(initial);
  async function refresh() {
    setRoom(roomView(await service.memberRoom(room.id, alice)));
  }
  return (
    <DinnerContext.Provider
      value={{
        api: request,
        me: { id: alice.id, name: alice.name },
        image: async () => new Blob(),
      }}
    >
      {chat ? (
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
  await screen.findByText("Confirmed expense · not paid");
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
