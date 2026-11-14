import "./dom";
import React, { useCallback, useState } from "react";
import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
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
import { CreatePlan, PlanCard } from "../../src/components/dinner/Plans";
import { DinnerService } from "../../src/lib/dinner/service";
import { MongoRoomStore } from "../../src/lib/dinner/mongo-store";
import { PlanService } from "../../src/lib/dinner/plans/service";
import { PlanView } from "../../src/lib/dinner/plans/model";
import { Actor, RoomView } from "../../src/lib/dinner/model";
import { handleDinner } from "../../src/lib/dinner/http";
import { Attachments } from "../../src/lib/dinner/attachments";
const alice: Actor = { id: randomUUID(), name: "Alice", twitterSubject: null };
const bob: Actor = { id: randomUUID(), name: "Bob", twitterSubject: null };
let mongo: MongoMemoryServer;
let client: MongoClient;
let dinner: DinnerService;
let plans: PlanService;
let room: RoomView;
before(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
beforeEach(async () => {
  const db = client.db("plans-ui");
  await db.dropDatabase();
  dinner = new DinnerService(new MongoRoomStore(db));
  plans = new PlanService(db, dinner);
  room = await dinner.create(alice, {
    clientId: randomUUID(),
    name: "Friends",
    purpose: "Dinner",
  });
  const invite = await dinner.invite(room.id, alice, {
    clientId: randomUUID(),
  });
  await dinner.respond(bob, { token: invite.token }, "accepted");
  room = await dinner.memberRoom(room.id, alice);
});
afterEach(cleanup);
function Harness({
  initial,
  actor = alice,
}: {
  initial?: PlanView;
  actor?: Actor;
}) {
  const [plan, setPlan] = useState(initial);
  const api = useCallback(
    async <T,>(path: string, init: RequestInit, schema: z.ZodType<T>) => {
      const response = await handleDinner(
        new Request(`http://localhost${path}`, init),
        path.slice(1).split("/"),
        {
          enabled: true,
          actor: async () => actor,
          service: dinner,
          plans,
          attachments: new Attachments(client.db("plans-ui"), dinner),
        },
      );
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      return schema.parse(value);
    },
    [actor],
  );
  return (
    <DinnerContext.Provider
      value={{ api, me: actor, image: async () => new Blob() }}
    >
      {plan ? (
        <PlanCard plan={plan} room={room} saved={setPlan} />
      ) : (
        <CreatePlan room={room} saved={setPlan} />
      )}
    </DinnerContext.Provider>
  );
}
test("DOM journey creates, publishes, collects availability and separately confirms participation", async () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("What are we planning?"), {
    target: { value: "Dinner next week" },
  });
  fireEvent.change(screen.getByLabelText("Area or venue"), {
    target: { value: "Downtown" },
  });
  fireEvent.change(
    screen.getByLabelText("Estimated maximum per person · USD"),
    { target: { value: "50" } },
  );
  fireEvent.change(screen.getByLabelText("Event time zone"), {
    target: { value: "Asia/Shanghai" },
  });
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2035-01-05T19:00" },
  });
  fireEvent.change(screen.getByLabelText("Ends"), {
    target: { value: "2035-01-05T21:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save plan draft" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Publish options" }),
  );
  fireEvent.click(await screen.findByRole("radio", { name: "Works" }));
  fireEvent.change(screen.getByLabelText(/Does the/), {
    target: { value: "works" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save my response" }));
  await waitFor(async () =>
    assert.equal((await plans.list(alice, room.id))[0].responses.length, 1),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Propose final details" }),
  );
  fireEvent.change(screen.getByLabelText("Exact venue or meeting point"), {
    target: { value: "Cafe One" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Request confirmations" }),
  );
  const accept = await screen.findByRole("button", {
    name: "Confirm my participation",
  });
  assert.equal((await plans.list(alice, room.id))[0].decisions.length, 0);
  fireEvent.click(accept);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Finalize for 1 accepted person",
    }),
  );
  await screen.findByRole("button", { name: "Download calendar event" });
  const result = (await plans.list(alice, room.id))[0];
  assert.equal(result.state, "confirmed");
  assert.deepEqual(result.confirmedIds, [alice.id]);
  assert.equal((await dinner.memberRoom(room.id, alice)).expenses.length, 0);
});
test("participant cannot see organizer controls or another member private note", async () => {
  let p = await plans.create(alice, room.id, {
    clientId: randomUUID(),
    title: "Dinner",
    participantIds: [alice.id, bob.id],
    timeZone: "UTC",
    location: "Cafe",
    budgetCents: 1000,
    slots: [{ localStart: "2035-01-01T19:00", localEnd: "2035-01-01T20:00" }],
    deadline: null,
  });
  p = await plans.command(alice, room.id, p.id, {
    clientId: randomUUID(),
    action: "publish",
    expectedRevision: p.revision,
  });
  await plans.command(alice, room.id, p.id, {
    clientId: randomUUID(),
    action: "respond",
    optionsVersion: 1,
    expectedResponseVersion: 0,
    votes: { [p.slots[0].id]: "works" },
    budget: "works",
    privateNote: "Organizer secret",
  });
  render(<Harness initial={await plans.get(bob, room.id, p.id)} actor={bob} />);
  assert.equal(screen.queryByText("Organizer secret"), null);
  assert.equal(screen.queryByRole("button", { name: "Cancel plan" }), null);
  assert.equal(
    screen.queryByRole("button", { name: "Propose final details" }),
    null,
  );
  assert(screen.getByRole("button", { name: "Save my response" }));
});

test("unanimously confirmed plans render a short conversational summary with an edit link", async () => {
  const { ConversationPlans, ConversationPlanEvent } = await import(
    "../../src/components/dinner/PlanConversation"
  );
  let plan = await plans.create(alice, room.id, {
    clientId: randomUUID(),
    title: "Friday dinner",
    participantIds: [alice.id, bob.id],
    timeZone: "UTC",
    location: "Cafe",
    budgetCents: 2500,
    deadline: null,
    slots: [{ localStart: "2035-01-04T19:30", localEnd: "2035-01-04T21:00" }],
  });
  plan = await plans.command(alice, room.id, plan.id, {
    action: "publish",
    clientId: randomUUID(),
    expectedRevision: plan.revision,
  });
  plan = await plans.command(alice, room.id, plan.id, {
    action: "propose",
    clientId: randomUUID(),
    expectedRevision: plan.revision,
    terms: {
      localStart: "2035-01-04T19:30",
      localEnd: "2035-01-04T21:00",
      timeZone: "UTC",
      location: "Cafe",
      budgetCents: 2500,
    },
  });
  for (const actor of [alice, bob])
    plan = await plans.command(actor, room.id, plan.id, {
      action: "decide",
      clientId: randomUUID(),
      termsVersion: plan.termsVersion,
      expectedDecisionVersion: 0,
      decision: "accepted",
    });
  const feed = await plans.conversation(alice, room.id);
  const view = render(
    <ConversationPlans room={room} feed={feed} userId={alice.id} />,
  );
  assert.ok(screen.getByText("Locked in: Friday dinner."));
  assert.ok(screen.getByRole("link", { name: "View or edit details" }));
  assert.equal(view.container.querySelector(".plan-conversation-card"), null);
  view.unmount();
  const event = feed.events.find((e) => e.action === "auto_finalize")!;
  render(<ConversationPlanEvent room={room} event={event} />);
  assert.ok(screen.getByText("Everyone confirmed—Friday dinner."));
  assert.equal(
    screen.queryByText("Review the current plan before responding."),
    null,
  );
});
