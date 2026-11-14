import { randomUUID } from "node:crypto";
import { dependencies, sessions } from "./state";
import { labStatus, runRound, scenarioProgress } from "./live-lab";
import type { PlanView } from "@/lib/dinner/plans/model";
const shared = globalThis as typeof globalThis & { tabTargetRunning?: boolean };
const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};
export async function runTargetScenario(roomId: string) {
  if (shared.tabTargetRunning || labStatus().roomId !== roomId) return;
  shared.tabTargetRunning = true;
  const [maya, leo, nina] = sessions.slice(1).map((s) => s.actor);
  const nextFriday = new Date();
  nextFriday.setUTCDate(nextFriday.getUTCDate() + ((5 - nextFriday.getUTCDay() + 7) % 7 || 7));
  const nextSaturday = new Date(nextFriday.getTime() + 86400_000);
  let passed = 0;
  const pass = (name: string) => {
    passed++;
    scenarioProgress(`Two-plan test · ${passed} checks passed · ${name}`);
  };
  const say = (person: typeof maya, text: string, replyTo?: string) =>
    dependencies.service.send(roomId, person, {
      clientId: randomUUID(),
      text,
      ...(replyTo ? { replyTo } : {}),
    });
  const tab = async (person: typeof maya, text: string, replyTo?: string) => {
    const m = await say(person, text, replyTo);
    const result = await dependencies.agent.respond(
      person,
      { kind: "room", roomId },
      m.id,
    );
    check(result.status === "complete", "Tab did not finish");
    const room = await dependencies.service.memberRoom(roomId, maya);
    return {
      message: m,
      result,
      reply: room.messages.find((x) => x.kind === "tab" && x.runId === m.id)!,
    };
  };
  const get = (p: PlanView) => dependencies.plans.get(maya, roomId, p.id);
  const create = async (title: string, day: string) => {
    let p = await dependencies.plans.create(maya, roomId, {
      clientId: randomUUID(),
      title,
      participantIds: sessions.slice(1).map((s) => s.actor.id),
      timeZone: "America/New_York",
      location: "Midtown test cafe (simulated)",
      budgetCents: 2500,
      deadline: null,
      slots: [
        {
          localStart: `${day}T19:00`,
          localEnd: `${day}T21:00`,
        },
      ],
    });
    p = await dependencies.plans.command(maya, roomId, p.id, {
      action: "publish",
      clientId: randomUUID(),
      expectedRevision: p.revision,
    });
    p = await dependencies.plans.command(maya, roomId, p.id, {
      action: "propose",
      clientId: randomUUID(),
      expectedRevision: p.revision,
      terms: {
        localStart: `${day}T19:00`,
        localEnd: `${day}T21:00`,
        timeZone: p.timeZone,
        location: p.location,
        budgetCents: 2500,
      },
    });
    await say(
      maya,
      `${title} is at 7 pm, $25 each. Maya, Leo and Nina, confirm your own places; Owen hasn't decided.`,
    );
    await runRound(undefined, "decide", [maya.id, leo.id, nina.id], p.id);
    check(!labStatus().error, labStatus().error);
    p = await get(p);
    check(
      p.state === "confirming" &&
        p.decisions.filter((d) => d.decision === "accepted").length === 3,
      `${title} did not get three saved acceptances`,
    );
    return p;
  };
  try {
    check(
      (await dependencies.plans.list(maya, roomId)).length === 0,
      "Use a fresh room for this test",
    );
    scenarioProgress("Two-plan test · confirming Friday dinner");
    let a = await create("Friday dinner", nextFriday.toISOString().slice(0, 10));
    scenarioProgress("Two-plan test · confirming Saturday dinner");
    let b = await create("Saturday dinner", nextSaturday.toISOString().slice(0, 10));
    const ambiguous = await tab(maya, "@Tab go ahead");
    check(
      ambiguous.result.text.includes("Which plan") &&
        (await get(a)).revision === a.revision &&
        (await get(b)).revision === b.revision,
      "Ambiguous request changed a plan",
    );
    pass("Ambiguous request changes neither plan");
    const named = await tab(maya, "@Tab go ahead for Friday dinner");
    a = await get(a);
    check(
      a.state === "confirmed" && (await get(b)).revision === b.revision,
      "Named request changed the wrong plan",
    );
    pass("Exact name locks Friday only");
    const optout = await tab(nina, "@Tab I can't make it", named.reply.id);
    await dependencies.agent.respond(
      nina,
      { kind: "room", roomId },
      optout.message.id,
    );
    a = await get(a);
    check(
      !a.confirmedIds.includes(nina.id) &&
        (await get(b)).revision === b.revision,
      "Reply-based opt-out affected Saturday",
    );
    pass("Nina opts out of Friday only");
    const denied = await tab(leo, "@Tab go ahead for Saturday dinner");
    check(
      denied.result.text.includes("Only the plan organizer") &&
        (await get(b)).revision === b.revision,
      "Target bypassed organizer permission",
    );
    pass("Targeting preserves organizer permission");
    const saturday = await say(
      maya,
      `Saturday details: /app/rooms/${roomId}?view=plan&plan=${b.id}`,
    );
    const conflict = await tab(
      maya,
      "@Tab go ahead for Friday dinner",
      saturday.id,
    );
    check(
      conflict.result.text.includes("conflict") &&
        (await get(a)).revision === a.revision &&
        (await get(b)).revision === b.revision,
      "Conflicting references changed a plan",
    );
    pass("Conflicting name and reply changes neither");
    const locked = await tab(maya, "@Tab go ahead", saturday.id);
    await dependencies.agent.respond(
      maya,
      { kind: "room", roomId },
      locked.message.id,
    );
    b = await get(b);
    check(
      b.state === "confirmed" &&
        b.confirmedIds.includes(nina.id) &&
        (await get(a)).revision === a.revision,
      "Reply approval mixed plan rosters",
    );
    pass("Saturday locks with Nina; Friday stays unchanged");
    a = await dependencies.plans.command(maya, roomId, a.id, {
      action: "cancel",
      clientId: randomUUID(),
      expectedRevision: a.revision,
    });
    const closed = await tab(nina, "@Tab I want to rejoin", named.reply.id);
    check(
      closed.result.text.includes("cancelled") &&
        (await get(b)).revision === b.revision &&
        (await get(a)).revision === a.revision,
      "Closed-plan reference fell through to Saturday",
    );
    pass("Cancelled Friday never redirects to Saturday");
    const room = await dependencies.service.memberRoom(roomId, maya);
    check(
      room.members.length === 5 && room.expenses.length === 0,
      "Unexpected side effects",
    );
    await say(
      maya,
      "Friday's rehearsal is closed. Saturday stays on for Maya, Leo and Nina. Owen hasn't joined either plan.",
    );
    scenarioProgress(
      `Two-plan test passed · ${passed} checks · Saturday locked, Friday cancelled`,
    );
  } catch (error) {
    scenarioProgress(
      `Two-plan test needs attention: ${error instanceof Error ? error.message : "Unexpected error"}`,
    );
  } finally {
    shared.tabTargetRunning = false;
  }
}
