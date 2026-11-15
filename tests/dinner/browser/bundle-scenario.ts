import { randomUUID } from "node:crypto";
import { dependencies, sessions } from "./state";
import {
  labStatus,
  selectScenarioRoom,
  scenarioProgress,
  runRound,
} from "./live-lab";
import type { PlanView } from "@/lib/dinner/plans/model";
const shared = globalThis as typeof globalThis & {
  tabBundle?: {
    roomId: string;
    running: boolean;
    checks: string[];
    error: string;
  };
};
export const bundleReport = () => shared.tabBundle ?? null;
const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};
export async function createBundleRoom(
  name = "Plans · bundled edge-case session",
) {
  check(
    !labStatus().busy && !shared.tabBundle?.running,
    "A test is already running",
  );
  const maya = sessions[1].actor;
  const room = await dependencies.service.create(maya, {
    clientId: randomUUID(),
    name,
    purpose:
      "Isolated test: pending rejoin, changed terms, budget conflicts, consent, cancellation. No bookings or payments.",
  });
  for (const member of [sessions[0], ...sessions.slice(2)]) {
    const invite = await dependencies.service.invite(room.id, maya, {
      clientId: randomUUID(),
    });
    await dependencies.service.respond(
      member.actor,
      { token: invite.token },
      "accepted",
    );
  }
  selectScenarioRoom(room.id);
  shared.tabBundle = { roomId: room.id, running: false, checks: [], error: "" };
  scenarioProgress("Bundle ready · waiting to start");
  await dependencies.service.send(room.id, maya, {
    clientId: randomUUID(),
    text: "Let's try a couple of dinner ideas. We'll keep this a rehearsal—no actual bookings. Carlos can just watch.",
  });
  return room.id;
}
export async function runBundle(roomId: string) {
  const report = shared.tabBundle;
  if (
    !report ||
    report.roomId !== roomId ||
    report.running ||
    report.checks.length
  )
    return;
  report.running = true;
  const [maya, leo, nina, owen] = sessions.slice(1).map((s) => s.actor);
  const say = (person: typeof maya, text: string) =>
    dependencies.service.send(roomId, person, { clientId: randomUUID(), text });
  const tab = async (person: typeof maya, text: string) => {
    const m = await say(person, text);
    const result = await dependencies.agent.respond(
      person,
      { kind: "room", roomId },
      m.id,
    );
    check(result.status === "complete", "Tab did not finish");
    return { message: m, result };
  };
  const pass = (name: string) => {
    report.checks.push(name);
    scenarioProgress(
      `Bundle · ${report.checks.length} checks passed · ${name}`,
    );
  };
  const get = (p: PlanView) => dependencies.plans.get(maya, roomId, p.id);
  const command = (p: PlanView, action: string, extra = {}) =>
    dependencies.plans.command(maya, roomId, p.id, {
      action,
      clientId: randomUUID(),
      expectedRevision: p.revision,
      ...extra,
    });
  const terms = (time: string, budget: number) => ({
    localStart: `2026-11-13T${time}`,
    localEnd: "2026-11-13T21:00",
    timeZone: "America/New_York",
    location: "Midtown test cafe (simulated)",
    budgetCents: budget,
  });
  const create = async (title: string, budget: number) => {
    let p = await dependencies.plans.create(maya, roomId, {
      clientId: randomUUID(),
      title,
      participantIds: sessions.slice(1).map((s) => s.actor.id),
      timeZone: "America/New_York",
      location: "Midtown test cafe (simulated)",
      budgetCents: budget,
      deadline: null,
      slots: [{ localStart: "2026-11-13T19:00", localEnd: "2026-11-13T21:00" }],
    });
    p = await command(p, "publish");
    return command(p, "propose", { terms: terms("19:00", budget) });
  };
  const decide = async () => {
    await runRound(undefined, "decide");
    check(!labStatus().error, labStatus().error);
  };
  try {
    scenarioProgress("Bundle · agents warming up");
    await runRound(undefined, "chat");
    check(!labStatus().error, labStatus().error);
    await say(
      maya,
      "First idea: 7 pm Friday November 13, New York time, $25 each. Let's confirm our own places.",
    );
    let a = await create("Dinner A · changing the time", 2500);
    await decide();
    a = await get(a);
    check(
      a.state === "confirmed" && a.confirmedIds.length === 4,
      "Initial dinner did not lock for four",
    );
    await tab(nina, "@Tab I can't make it");
    await tab(nina, "@Tab I want to rejoin");
    a = await get(a);
    check(
      !a.confirmedIds.includes(nina.id),
      "Rejoin added Nina before approval",
    );
    const delayed = await say(maya, "@Tab go ahead");
    await say(leo, "Could we shift this one to 7:30? Still $25.");
    a = await command(a, "propose", { terms: terms("19:30", 2500) });
    check(
      a.decisions.length === 0 && a.confirmedIds.length === 0,
      "Changed terms kept old consent",
    );
    const staleReply = await dependencies.agent.respond(
      maya,
      { kind: "room", roomId },
      delayed.id,
    );
    check(
      staleReply.text.includes("details changed"),
      "Delayed organizer message approved changed terms",
    );
    let staleRejected = false;
    try {
      await dependencies.plans.command(nina, roomId, a.id, {
        action: "request_rejoin",
        clientId: randomUUID(),
        termsVersion: 1,
        expectedDecisionVersion: 3,
      });
    } catch {
      staleRejected = true;
    }
    check(staleRejected, "Stale rejoin was accepted");
    pass("Changed time invalidates pending rejoin and old consent");
    await say(
      maya,
      "The time changed, so everyone needs to agree to 7:30 afresh.",
    );
    await decide();
    a = await get(a);
    check(
      a.state === "confirmed" && a.decisions.every((d) => d.termsVersion === 2),
      "Fresh approval did not use changed terms",
    );
    pass("Fresh consent locks the revised time");
    a = await command(a, "cancel");
    await say(
      maya,
      "Closing that rehearsal. Second idea: same cafe at 7 pm, but this option is $35 each.",
    );
    let b = await create("Dinner B · budget and cancellations", 3500);
    await decide();
    b = await get(b);
    check(
      b.state === "confirming" &&
        b.decisions.find((d) => d.userId === nina.id)?.decision === "declined",
      "Nina's $25 cap did not reject the $35 plan",
    );
    await say(
      nina,
      "That’s over my $25 limit. Please don't count me in for this one.",
    );
    await tab(maya, "@Tab who's confirmed?");
    pass("Budget conflict stays unconfirmed");
    const revision = b.revision;
    await tab(leo, "@Tab go ahead");
    b = await get(b);
    check(b.revision === revision, "Non-organizer changed the plan");
    pass("Non-organizer cannot finalize");
    for (const text of [
      "@Tab maybe",
      "@Tab if Leo agrees go ahead",
      "@Tab can we do later?",
    ]) {
      await tab(owen, text);
      check(
        (await get(b)).revision === revision,
        `Ambiguous message changed consent: ${text}`,
      );
    }
    pass("Ambiguous messages do not change attendance");
    const yes = await tab(maya, "@Tab yes, go ahead");
    await dependencies.agent.respond(
      maya,
      { kind: "room", roomId },
      yes.message.id,
    );
    b = await get(b);
    check(
      b.state === "confirmed" &&
        b.confirmedIds.length === 3 &&
        !b.confirmedIds.includes(nina.id),
      "Subset finalize included an unaccepted participant",
    );
    const first = await tab(leo, "@Tab go ahead without me");
    await dependencies.agent.respond(
      leo,
      { kind: "room", roomId },
      first.message.id,
    );
    const once = await get(b);
    await tab(leo, "@Tab go ahead without me");
    b = await get(b);
    check(
      b.revision === once.revision &&
        b.history.filter((h) => h.action === "finalize").length === 1,
      "Retries duplicated actions",
    );
    pass("Repeated approvals and opt-outs apply once");
    await tab(owen, "@Tab I can't make it");
    const last = await tab(maya, "@Tab I can't make it");
    b = await get(b);
    check(
      b.state === "confirming" &&
        b.confirmedIds.length === 0 &&
        last.result.text.includes("no longer locked"),
      "Empty outing still looked confirmed",
    );
    pass("Everyone leaving removes the lock");
    b = await command(b, "cancel");
    const closedRevision = b.revision;
    const rejoin = await tab(nina, "@Tab I want to rejoin");
    b = await get(b);
    check(
      b.state === "cancelled" &&
        b.revision === closedRevision &&
        rejoin.result.text.includes("stay closed"),
      "Cancelled outing reopened",
    );
    pass("Cancelled plans reject rejoin");
    const room = await dependencies.service.memberRoom(roomId, maya);
    check(
      room.members.length === 5 && room.expenses.length === 0,
      "Test affected membership or expenses",
    );
    pass("Room membership intact; no expenses");
    await say(
      maya,
      "That's the rehearsal done. Both test plans are closed, everyone's still in the chat, and nothing was booked.",
    );
    scenarioProgress(
      `Bundle passed · ${report.checks.length} checks · ready for browser reload verification`,
    );
  } catch (error) {
    report.error =
      error instanceof Error ? error.message : "Unexpected failure";
    scenarioProgress(`Bundle needs attention: ${report.error}`);
  } finally {
    report.running = false;
  }
}
