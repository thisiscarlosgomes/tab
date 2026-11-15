import { randomUUID } from "node:crypto";
import { dependencies, sessions } from "./state";
import { labStatus, runRound, scenarioProgress } from "./live-lab";
const check = (value: boolean, message: string) => {
  if (!value) throw new Error(message);
};
const active = globalThis as typeof globalThis & { tabOptoutRunning?: boolean };
export async function runOptoutScenario(roomId: string) {
  if (active.tabOptoutRunning || labStatus().roomId !== roomId) return;
  active.tabOptoutRunning = true;
  const outingDate = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  const maya = sessions[1].actor,
    owen = sessions[4].actor;
  const say = (person: typeof maya, text: string) =>
    dependencies.service.send(roomId, person, { clientId: randomUUID(), text });
  const tab = async (person: typeof maya, text: string) => {
    const m = await say(person, text);
    const reply = await dependencies.agent.respond(
      person,
      { kind: "room", roomId },
      m.id,
    );
    check(reply.status === "complete", "Tab reply did not finish");
    return m;
  };
  try {
    scenarioProgress("Opt-out test · chatting before dinner");
    await runRound(undefined, "discuss");
    check(!labStatus().error, labStatus().error);
    await runRound(undefined, "chat");
    check(!labStatus().error, labStatus().error);
    let plan = await dependencies.plans.create(maya, roomId, {
      clientId: randomUUID(),
      title: "Vegetarian dinner",
      participantIds: sessions.slice(1).map((s) => s.actor.id),
      timeZone: "America/New_York",
      location: "Midtown test cafe (simulated)",
      budgetCents: 2500,
      deadline: null,
      slots: [{ localStart: `${outingDate}T19:00`, localEnd: `${outingDate}T20:30` }],
    });
    plan = await dependencies.plans.command(maya, roomId, plan.id, {
      action: "publish",
      clientId: randomUUID(),
      expectedRevision: plan.revision,
    });
    plan = await dependencies.plans.command(maya, roomId, plan.id, {
      action: "propose",
      clientId: randomUUID(),
      expectedRevision: plan.revision,
      terms: {
        localStart: `${outingDate}T19:00`,
        localEnd: `${outingDate}T20:30`,
        timeZone: plan.timeZone,
        location: plan.location,
        budgetCents: 2500,
      },
    });
    await say(
      maya,
      "I've saved 7 pm. Maya, Leo and Nina, let's confirm our own places while Owen checks his timing.",
    );
    scenarioProgress("Opt-out test · three participants accepting");
    await runRound(
      undefined,
      "decide",
      sessions.slice(1, 4).map((s) => s.actor.id),
    );
    check(!labStatus().error, labStatus().error);
    plan = await dependencies.plans.get(maya, roomId, plan.id);
    check(
      plan.decisions.filter((d) => d.decision === "accepted").length === 3,
      "Expected three actual acceptances",
    );
    await say(
      owen,
      "Something came up in this rehearsal—I can't get there until 9.",
    );
    await tab(owen, "@Tab can we do later?");
    plan = await dependencies.plans.get(maya, roomId, plan.id);
    check(
      !plan.decisions.some((d) => d.userId === owen.id),
      "Negotiation was incorrectly recorded as a decline",
    );
    await say(
      maya,
      "Nine is too late for us. Want us to go ahead and catch you next time?",
    );
    scenarioProgress("Opt-out test · Owen opting out");
    const optout = await tab(owen, "@Tab go ahead without me");
    await dependencies.agent.respond(owen, { kind: "room", roomId }, optout.id);
    plan = await dependencies.plans.get(maya, roomId, plan.id);
    check(
      plan.state === "confirming" &&
        plan.decisions.find((d) => d.userId === owen.id)?.decision ===
          "declined",
      "Opt-out did not persist correctly",
    );
    scenarioProgress("Opt-out test · organizer giving the final yes");
    const yes = await tab(maya, "@Tab yes, go ahead");
    await dependencies.agent.respond(maya, { kind: "room", roomId }, yes.id);
    plan = await dependencies.plans.get(maya, roomId, plan.id);
    check(
      plan.state === "confirmed" &&
        plan.confirmedIds.length === 3 &&
        !plan.confirmedIds.includes(owen.id),
      "Organizer did not lock exactly the three accepting attendees",
    );
    check(
      plan.history.filter((h) => h.action === "finalize").length === 1,
      "Retry duplicated organizer finalization",
    );
    const room = await dependencies.service.memberRoom(roomId, owen);
    check(
      room.members.length === 5 && room.expenses.length === 0,
      "Opt-out affected membership or expenses",
    );
    await say(owen, "Enjoy it! I’ll bring the terrible playlist next time.");
    scenarioProgress(
      "Opt-out test passed · three going, Owen out, room intact",
    );
  } catch (error) {
    scenarioProgress(
      `Opt-out test needs attention: ${error instanceof Error ? error.message : "Unexpected error"}`,
    );
  } finally {
    active.tabOptoutRunning = false;
  }
}

export async function runWithdrawalScenario(roomId: string) {
  if (active.tabOptoutRunning || labStatus().roomId !== roomId) return;
  active.tabOptoutRunning = true;
  const maya = sessions[1].actor,
    nina = sessions[3].actor;
  try {
    const plans = await dependencies.plans.list(maya, roomId);
    check(
      plans.length === 1 && plans[0].state === "confirmed",
      "Expected one locked plan",
    );
    const before = plans[0];
    check(
      before.confirmedIds.includes(nina.id),
      "Nina must be attending before this test",
    );
    scenarioProgress("Withdrawal test · Nina leaving the locked outing");
    await dependencies.service.send(roomId, nina, {
      clientId: randomUUID(),
      text: "Something came up after we locked it in. You'll have to judge the playlist without me.",
    });
    const source = await dependencies.service.send(roomId, nina, {
      clientId: randomUUID(),
      text: "@Tab I can't make it",
    });
    await dependencies.agent.respond(nina, { kind: "room", roomId }, source.id);
    await dependencies.agent.respond(nina, { kind: "room", roomId }, source.id);
    const after = await dependencies.plans.get(maya, roomId, before.id);
    check(
      after.state === "confirmed",
      "Withdrawal reopened or cancelled the plan",
    );
    check(
      JSON.stringify(after.confirmedIds) ===
        JSON.stringify(before.confirmedIds.filter((id) => id !== nina.id)),
      "Withdrawal changed another attendee",
    );
    check(
      JSON.stringify(after.terms) === JSON.stringify(before.terms) &&
        after.termsVersion === before.termsVersion,
      "Withdrawal changed the agreed details",
    );
    check(
      after.history.filter((h) => h.action === "withdraw").length ===
        before.history.filter((h) => h.action === "withdraw").length + 1,
      "Retry duplicated withdrawal",
    );
    const room = await dependencies.service.memberRoom(roomId, nina);
    check(
      room.members.length === 5 && room.expenses.length === 0,
      "Withdrawal changed room membership or expenses",
    );
    const summary = await dependencies.service.send(roomId, maya, {
      clientId: randomUUID(),
      text: "@Tab who's confirmed now?",
    });
    await dependencies.agent.respond(
      maya,
      { kind: "room", roomId },
      summary.id,
    );
    scenarioProgress(
      "Withdrawal test passed · Maya and Leo going, Nina and Owen out, plan still locked",
    );
  } catch (error) {
    scenarioProgress(
      `Withdrawal test needs attention: ${error instanceof Error ? error.message : "Unexpected error"}`,
    );
  } finally {
    active.tabOptoutRunning = false;
  }
}

export async function runRejoinScenario(roomId: string) {
  if (active.tabOptoutRunning || labStatus().roomId !== roomId) return;
  active.tabOptoutRunning = true;
  const maya = sessions[1].actor,
    nina = sessions[3].actor;
  const say = async (person: typeof maya, text: string) => {
    const m = await dependencies.service.send(roomId, person, {
      clientId: randomUUID(),
      text,
    });
    await dependencies.agent.respond(person, { kind: "room", roomId }, m.id);
    return m;
  };
  try {
    const [before] = await dependencies.plans.list(maya, roomId);
    check(
      !!before &&
        before.state === "confirmed" &&
        !before.confirmedIds.includes(nina.id),
      "Expected Nina outside the locked outing",
    );
    scenarioProgress("Rejoin test · Nina asking to return");
    await dependencies.service.send(roomId, nina, {
      clientId: randomUUID(),
      text: "My evening just cleared up. I'd love to join you after all.",
    });
    const request = await say(nina, "@Tab I want to rejoin");
    await dependencies.agent.respond(
      nina,
      { kind: "room", roomId },
      request.id,
    );
    let plan = await dependencies.plans.get(maya, roomId, before.id);
    check(
      plan.state === "confirmed" &&
        JSON.stringify(plan.confirmedIds) ===
          JSON.stringify(before.confirmedIds),
      "Request added attendance before organizer approval",
    );
    check(
      plan.decisions.find((d) => d.userId === nina.id)?.decision === "accepted",
      "Current consent was not recorded",
    );
    scenarioProgress(
      "Rejoin test · waiting for Maya; existing attendees unchanged",
    );
    await new Promise((resolve) => setTimeout(resolve, 8000));
    const approval = await say(maya, "@Tab go ahead");
    await dependencies.agent.respond(
      maya,
      { kind: "room", roomId },
      approval.id,
    );
    plan = await dependencies.plans.get(maya, roomId, before.id);
    check(
      plan.state === "confirmed" &&
        plan.confirmedIds.length === before.confirmedIds.length + 1 &&
        plan.confirmedIds.includes(nina.id),
      "Organizer approval did not add Nina exactly once",
    );
    check(
      JSON.stringify(plan.terms) === JSON.stringify(before.terms) &&
        plan.termsVersion === before.termsVersion,
      "Rejoin changed the agreed details",
    );
    check(
      before.confirmedIds.every((id) => plan.confirmedIds.includes(id)),
      "Rejoin removed another attendee",
    );
    check(
      plan.history.filter((h) => h.action === "request_rejoin").length === 1 &&
        plan.history.filter((h) => h.action === "approve_rejoins").length === 1,
      "Retry duplicated a rejoin event",
    );
    const room = await dependencies.service.memberRoom(roomId, nina);
    check(
      room.members.length === 5 && room.expenses.length === 0,
      "Rejoin affected membership or expenses",
    );
    scenarioProgress(
      "Rejoin test passed · Nina back with Maya and Leo; Owen still out",
    );
  } catch (error) {
    scenarioProgress(
      `Rejoin test needs attention: ${error instanceof Error ? error.message : "Unexpected error"}`,
    );
  } finally {
    active.tabOptoutRunning = false;
  }
}
