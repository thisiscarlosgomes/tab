import { randomUUID } from "node:crypto";
import { compareOptions } from "@/lib/dinner/plans/model";
import { dependencies, sessions } from "./state";
import {
  runRound,
  labStatus,
  selectScenarioRoom,
  scenarioProgress,
} from "./live-lab";
const host = () => sessions[0].actor;
const organizer = () => sessions[1].actor;
export async function createScenario(second: boolean | "optout" = false) {
  if (labStatus().busy) throw new Error("Wait for the current round to finish");
  const room = await dependencies.service.create(organizer(), {
    clientId: randomUUID(),
    name:
      second === "optout"
        ? "Dinner rehearsal · go ahead without me"
        : second
          ? "Dinner rehearsal · Tab coordinates"
          : "Dinner rehearsal · first run",
    purpose:
      "Four AI test attendees coordinate; Carlos observes. Simulated venue, no booking or payment.",
  });
  for (const person of [sessions[0], ...sessions.slice(2)]) {
    const invite = await dependencies.service.invite(room.id, organizer(), {
      clientId: randomUUID(),
    });
    await dependencies.service.respond(
      person.actor,
      { token: invite.token },
      "accepted",
    );
  }
  selectScenarioRoom(room.id);
  if (second) scenarioProgress("Ready for second run");
  await dependencies.service.send(room.id, organizer(), {
    clientId: randomUUID(),
    text:
      second === "optout"
        ? `Dinner on ${new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10)} at 7 pm New York time? Vegetarian, $25 each at our imaginary Midtown cafe. Carlos is watching this rehearsal—nothing is being booked.`
        : "Hey, shall we get vegetarian dinner Friday, November 13? I was thinking 6:30 or 7:30 in the evening, New York time. We can use our imaginary Midtown test cafe—nothing's being booked. Let's find a time and budget that work for the four of us; Carlos is just watching this run.",
  });
  return room.id;
}
const requireThat = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
export async function runScenario(roomId: string) {
  if (
    labStatus().roomId !== roomId ||
    ![
      "Ready for first run",
      "First run needs attention: Discussion generation failed",
      "First run needs attention: Not all four agents saved availability",
    ].includes(labStatus().scenario)
  )
    return;
  const say = (text: string) =>
    dependencies.service.send(roomId, organizer(), {
      clientId: randomUUID(),
      text,
    });
  try {
    let plan = (await dependencies.plans.list(organizer(), roomId))[0];
    if (!plan) {
      scenarioProgress("Discussing time and budget");
      await runRound(undefined, "discuss");
      requireThat(!labStatus().error, "Discussion generation failed");
      await runRound(undefined, "chat");
      requireThat(!labStatus().error, "Discussion generation failed");
      plan = await dependencies.plans.create(organizer(), roomId, {
        clientId: randomUUID(),
        title: "Vegetarian dinner",
        participantIds: sessions.slice(1).map((s) => s.actor.id),
        timeZone: "America/New_York",
        location: "Midtown test cafe (simulated)",
        budgetCents: 2500,
        deadline: null,
        slots: [
          { localStart: "2026-11-13T18:30", localEnd: "2026-11-13T20:00" },
          { localStart: "2026-11-13T19:30", localEnd: "2026-11-13T21:00" },
        ],
      });
      plan = await dependencies.plans.command(organizer(), roomId, plan.id, {
        action: "publish",
        clientId: randomUUID(),
        expectedRevision: plan.revision,
      });
      await say(
        "Let's keep it to $25 each so Nina can join. I've put both evening times in the plan—add your availability and we'll go with the one that works best.",
      );
    }
    scenarioProgress("Collecting four saved availability responses");
    await runRound(undefined, "respond");
    plan = await dependencies.plans.get(host(), roomId, plan.id);
    requireThat(
      plan.responses.length === 4,
      "Not all four agents saved availability",
    );
    const option = compareOptions(plan)[0];
    requireThat(
      option.localStart.endsWith("19:30") && option.works === 4,
      "Availability did not converge on the compatible 19:30 option",
    );
    plan = await dependencies.plans.command(organizer(), roomId, plan.id, {
      action: "propose",
      clientId: randomUUID(),
      expectedRevision: plan.revision,
      terms: {
        localStart: option.localStart,
        localEnd: option.localEnd,
        timeZone: plan.timeZone,
        location: plan.location,
        budgetCents: 2500,
      },
    });
    await say(
      "7:30 works for all four of us. Friday November 13, 7:30–9 pm New York time at our Midtown test cafe, up to $25 each. Check those exact details and confirm for yourself if you're happy.",
    );
    scenarioProgress("Collecting four final decisions");
    await runRound(undefined, "decide");
    plan = await dependencies.plans.get(host(), roomId, plan.id);
    requireThat(
      plan.state === "confirmed" &&
        plan.confirmedIds.length === 4 &&
        !plan.confirmedIds.includes(host().id),
      "Final approvals did not lock exactly the four test attendees",
    );
    requireThat(
      plan.history.filter((h) => h.action === "auto_finalize").length === 1,
      "Expected exactly one lock-in event",
    );
    requireThat(
      (await dependencies.service.memberRoom(roomId, host())).expenses
        .length === 0,
      "Unexpected expense side effect",
    );
    await say(
      "We're set for vegetarian dinner on Friday November 13 at 7:30 pm New York time, up to $25 each at our Midtown test cafe. Maya, Leo, Nina and Owen are all confirmed. This is just our rehearsal, so nothing has been booked.",
    );
    scenarioProgress(
      "First run passed · four saved responses, four approvals, one locked plan",
    );
  } catch (error) {
    scenarioProgress(
      `First run needs attention: ${error instanceof Error ? error.message : "Unexpected failure"}`,
    );
  }
}
