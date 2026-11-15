// Local rehearsal only: real Tab replies, explicit harness organizer actions.
import { createHash } from "node:crypto";
import { dependencies, sessions } from "./state";
import { compareOptions, createPlanInput } from "@/lib/dinner/plans/model";
import { labStatus, runRound, scenarioProgress } from "./live-lab";
const organizer = () => sessions[1].actor;
const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};
const active = globalThis as typeof globalThis & {
  tabCoordinatorRuns?: Set<string>;
};
export async function runCoordinatorScenario(roomId: string) {
  active.tabCoordinatorRuns ??= new Set();
  if (active.tabCoordinatorRuns.has(roomId) || labStatus().roomId !== roomId)
    return;
  active.tabCoordinatorRuns.add(roomId);
  const id = (key: string) => {
    const h = createHash("sha256").update(`${roomId}:${key}`).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  const say = (key: string, text: string, person = organizer()) =>
    dependencies.service.send(roomId, person, { clientId: id(key), text });
  const tab = async (key: string, text: string) => {
    const message = await say(key, text);
    const reply = await dependencies.agent.respond(
      organizer(),
      { kind: "room", roomId },
      message.id,
    );
    check(reply.status === "complete", "Tab has not completed its reply");
    return reply;
  };
  const round = async (phase: "discuss" | "respond" | "decide" | "chat") => {
    await runRound(undefined, phase);
    check(!labStatus().error, labStatus().error || "Participant turn failed");
  };
  try {
    let plan = (await dependencies.plans.list(organizer(), roomId))[0];
    if (!plan) {
      scenarioProgress("Second run · chatting with Tab");
      if (
        !(await dependencies.agent.roomPlanProposals(organizer(), roomId))
          .length
      ) {
        await round("discuss");
        await round("chat");
        await tab(
          "prepare",
          "@Tab can you prepare our vegetarian dinner plan? Friday November 13, 2026, at the imaginary Midtown test cafe, America/New_York time. Options are 6:30–8 pm or 7:30–9 pm, up to $25 each. Include Maya, Leo, Nina and Owen only; Carlos is watching. Nothing is being booked.",
        );
      }
      const proposals = await dependencies.agent.roomPlanProposals(
        organizer(),
        roomId,
      );
      const proposal = proposals.find((p) => p.userId === organizer().id);
      check(!!proposal, "Tab did not create a plan suggestion");
      if (!proposal!.fields.title)
        await say(
          "name",
          "Let’s call it Vegetarian dinner. I’ll save those two options.",
        );
      const input = createPlanInput.parse({
        ...proposal!.fields,
        title: proposal!.fields.title ?? "Vegetarian dinner",
        clientId: proposal!.id,
        deadline: null,
      });
      check(
        input.participantIds.length === 4 &&
          sessions
            .slice(1)
            .every((s) => input.participantIds.includes(s.actor.id)),
        "Tab selected the wrong attendees",
      );
      check(
        input.budgetCents === 2500 &&
          input.timeZone === "America/New_York" &&
          input.slots.length === 2,
        "Tab changed the requested details",
      );
      plan = await dependencies.agent.applyPlanProposal(
        organizer(),
        proposal!.id,
        input,
      );
      plan = await dependencies.plans.command(organizer(), roomId, plan.id, {
        action: "publish",
        clientId: id("publish"),
        expectedRevision: plan.revision,
      });
      await say(
        "published",
        "Saved both options. Add your availability when you get a sec.",
      );
    }
    if (plan.state === "collecting") {
      scenarioProgress("Second run · saving availability");
      await round("respond");
      plan = await dependencies.plans.get(organizer(), roomId, plan.id);
      check(plan.responses.length === 4, "Missing saved availability");
      await tab(
        `compare-${plan.revision}`,
        "@Tab which time works for all four of us? Check our saved votes and tell us briefly.",
      );
      const best = compareOptions(plan)[0];
      check(
        best.localStart === "2026-11-13T19:30" && best.works === 4,
        "Votes did not converge on 7:30",
      );
      plan = await dependencies.plans.command(organizer(), roomId, plan.id, {
        action: "propose",
        clientId: id("propose"),
        expectedRevision: plan.revision,
        terms: {
          localStart: best.localStart,
          localEnd: best.localEnd,
          timeZone: plan.timeZone,
          location: plan.location,
          budgetCents: plan.budgetCents,
        },
      });
      await tab(
        "confirm-request",
        "@Tab the exact details are saved now. Briefly ask everyone to check and confirm their own place.",
      );
    }
    if (plan.state === "confirming" && plan.termsVersion === 1) {
      scenarioProgress("Second run · first approvals");
      await round("decide");
      plan = await dependencies.plans.get(organizer(), roomId, plan.id);
      check(
        plan.state === "confirmed",
        "Initial approvals did not lock the plan",
      );
    }
    if (plan.state === "confirmed" && plan.termsVersion === 1) {
      await tab(
        "first-summary",
        "@Tab are we all set? Check the saved plan and give us a short update.",
      );
      await say(
        "change-request",
        "Tiny change—could we do 7 instead? Same $25 budget.",
        sessions[4].actor,
      );
      await tab(
        "change-advice",
        "@Tab Owen wants 7 pm instead, still $25. What needs to happen to the existing confirmations? Keep it short.",
      );
      const oldVersion = plan.termsVersion;
      plan = await dependencies.plans.command(organizer(), roomId, plan.id, {
        action: "propose",
        clientId: id("change"),
        expectedRevision: plan.revision,
        terms: {
          localStart: "2026-11-13T19:00",
          localEnd: "2026-11-13T20:30",
          timeZone: plan.timeZone,
          location: plan.location,
          budgetCents: 2500,
        },
      });
      check(
        plan.state === "confirming" &&
          plan.decisions.length === 0 &&
          plan.confirmedIds.length === 0,
        "Old approvals survived the time change",
      );
      let rejected = false;
      try {
        await dependencies.plans.command(sessions[2].actor, roomId, plan.id, {
          action: "decide",
          clientId: id("stale-consent"),
          termsVersion: oldVersion,
          expectedDecisionVersion: 0,
          decision: "accepted",
        });
      } catch (error) {
        rejected =
          error instanceof Error &&
          error.message.includes("current final details");
      }
      check(rejected, "A stale approval was not rejected");
      await say(
        "changed",
        "Updated it to 7–8:30 pm. @Tab can you check who's confirmed for the new time?",
      );
      const message = (
        await dependencies.service.memberRoom(roomId, organizer())
      ).messages.find((m) => m.clientId === id("changed"))!;
      await dependencies.agent.respond(
        organizer(),
        { kind: "room", roomId },
        message.id,
      );
    }
    if (
      plan.state === "confirming" &&
      plan.termsVersion === 2 &&
      plan.decisions.length < 4
    ) {
      scenarioProgress("Second run · approving the changed time");
      await round("decide");
      plan = await dependencies.plans.get(organizer(), roomId, plan.id);
    }
    const allAccepted =
      plan.decisions.length === 4 &&
      plan.decisions.every((d) => d.decision === "accepted");
    check(
      plan.termsVersion === 2 &&
        plan.decisions.length === 4 &&
        plan.decisions.every((d) => d.termsVersion === 2),
      "Decisions do not match the current terms",
    );
    check(
      allAccepted
        ? plan.state === "confirmed" && plan.confirmedIds.length === 4
        : plan.state === "confirming" && plan.confirmedIds.length === 0,
      "Plan state does not respect participant consent",
    );
    check(
      plan.history.filter((h) => h.action === "auto_finalize").length ===
        (allAccepted ? 2 : 1),
      "A version locked without unanimous consent",
    );
    await tab(
      "verified-final-summary",
      "@Tab check the current saved decisions. Is the new time confirmed, or did someone decline? Name who declined and who accepted. Give us one short natural paragraph and a link to edit. No list.",
    );
    const room = await dependencies.service.memberRoom(roomId, organizer());
    check(room.expenses.length === 0, "Unexpected expense side effect");
    check(
      room.messages.filter((m) => m.kind === "tab").length >= 6,
      "Missing visible Tab replies",
    );
    scenarioProgress(
      allAccepted
        ? "Second run passed · updated time confirmed by all four"
        : "Second run · consent checks passed; changed time remains unconfirmed after a decline",
    );
  } catch (error) {
    scenarioProgress(
      `Second run needs attention: ${error instanceof Error ? error.message : "Unexpected failure"}`,
    );
  } finally {
    active.tabCoordinatorRuns.delete(roomId);
  }
}
