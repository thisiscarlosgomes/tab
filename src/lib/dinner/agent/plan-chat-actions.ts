import type { Actor, Message, RoomView } from "../model";
import { PlanService } from "../plans/service";
import { planningFacts, planningStatusReply } from "./planning";

import { planChatTarget } from "./plan-chat-target";

/** Only the persisted message author can issue these narrow, explicit commands. */
export async function handlePlanChatAction(
  plans: PlanService,
  actor: Actor,
  room: RoomView,
  source: Message,
) {
  const all = await plans.list(actor, room.id);
  const target = planChatTarget(
    source.text,
    room.id,
    all,
    room.messages.find((m) => m.id === source.replyTo)?.text,
  );
  if (!target) return null;
  const { intent } = target;
  if (target.invalid)
    return "Those plan references conflict or point to another room. Please reply to the intended plan’s message.";
  const candidates = target.explicit
    ? all.filter((p) => target.ids.includes(p.id))
    : all.filter((p) => ["confirming", "confirmed"].includes(p.state));
  if (!candidates.length)
    return target.explicit
      ? "I couldn't find that plan in this room. Please use its current details link."
      : "There isn’t an active plan to change. Cancelled or completed plans stay closed; ask the organizer to create a new one.";
  if (candidates.length !== 1)
    return "Which plan do you mean? Reply to a message with that plan’s details link, or add ‘for’ and its exact name to your request.";
  if (!["confirming", "confirmed"].includes(candidates[0].state))
    return `That plan is ${candidates[0].state} and can't be changed by this request. The other plans haven't changed.`;
  let plan = candidates[0];
  const link = `/app/rooms/${room.id}?view=plan&plan=${plan.id}`;
  if (intent === "negotiate")
    return `Would you like a later option, or should the others go ahead without you? You’re still invited. ${link}`;
  // A delayed/retried request cannot apply to terms proposed after the message.
  const latestTerms = plan.history.filter((h) => h.action === "propose").at(-1);
  if (latestTerms && latestTerms.at > source.createdAt)
    return `The details changed after that message. Please check the current plan and tell me again. ${link}`;
  if (intent === "rejoin") {
    if (!plan.participantIds.includes(actor.id))
      return `Ask the organizer to invite you first. ${link}`;
    if (plan.state !== "confirmed")
      return `The plan isn't locked yet. Check the current details and respond in Plans. ${link}`;
    if (plan.confirmedIds.includes(actor.id))
      return `You're already joining. ${link}`;
    const decision = plan.decisions.find((d) => d.userId === actor.id);
    if (!decision)
      return `Please respond to the current plan in Plans first. ${link}`;
    if (decision.decision !== "accepted")
      plan = await plans.command(actor, room.id, plan.id, {
        action: "request_rejoin",
        clientId: source.id,
        termsVersion: plan.termsVersion,
        expectedDecisionVersion: decision.version,
      });
    const organizer =
      room.members
        .find((m) => m.userId === plan.creatorId)
        ?.name.replace(/ · agent$/, "") ?? "The organizer";
    return `You've agreed to rejoin on the current details. ${organizer}, say “@Tab go ahead” to add them back. The existing plan stays locked. ${link}`;
  }
  if (intent === "opt_out") {
    if (!plan.participantIds.includes(actor.id))
      return `You aren't an attendee on this plan. ${link}`;
    if (
      plan.state === "confirmed" &&
      !plan.confirmedIds.includes(actor.id) &&
      plan.decisions.find((d) => d.userId === actor.id)?.decision !== "accepted"
    )
      return `You're already outside the confirmed group. The plan stays on. ${link}`;
    const decision = plan.decisions.find((d) => d.userId === actor.id);
    if (
      !(
        plan.state === "confirming" &&
        decision?.termsVersion === plan.termsVersion &&
        decision.decision === "declined"
      )
    )
      plan = await plans.command(actor, room.id, plan.id, {
        action: plan.state === "confirmed" ? "withdraw" : "decide",
        clientId: source.id,
        termsVersion: plan.termsVersion,
        expectedDecisionVersion: decision?.version ?? 0,
        ...(plan.state === "confirming" ? { decision: "declined" } : {}),
      });
    if (
      !plan.confirmedIds.length &&
      plan.decisions.every((d) => d.decision === "declined")
    )
      return `Nobody is attending now, so this outing is no longer locked in. You’re all still in the chat. ${link}`;
    const name =
      room.members
        .find((m) => m.userId === plan.creatorId)
        ?.name.replace(/ · agent$/, "") ?? "The organizer";
    return `You're out of this outing, but still in the chat. ${plan.state === "confirmed" ? "The plan stays on for the others." : `${name}, say “@Tab go ahead” to keep this plan for the people who accepted.`} ${link}`;
  }
  if (plan.creatorId !== actor.id)
    return `Only the plan organizer can lock it in for the group. Your own attendance hasn't changed. ${link}`;
  if (
    plan.state === "confirmed" &&
    plan.decisions.some(
      (d) =>
        d.termsVersion === plan.termsVersion &&
        d.decision === "accepted" &&
        !plan.confirmedIds.includes(d.userId),
    )
  ) {
    if (
      plan.history.some(
        (h) => h.action === "request_rejoin" && h.at > source.createdAt,
      )
    )
      return `A new request arrived after your message. Check it and say “@Tab go ahead” again. ${link}`;
    plan = await plans.command(actor, room.id, plan.id, {
      action: "approve_rejoins",
      clientId: source.id,
      expectedRevision: plan.revision,
    });
  }
  if (plan.state !== "confirmed") {
    if (
      !plan.decisions.some(
        (d) =>
          d.termsVersion === plan.termsVersion && d.decision === "accepted",
      )
    )
      return `Nobody has accepted these details yet. I'll need at least one acceptance before you can lock it in. ${link}`;
    plan = await plans.command(actor, room.id, plan.id, {
      action: "finalize",
      clientId: source.id,
      expectedRevision: plan.revision,
    });
  }
  return planningStatusReply("all set", {
    plans: [planningFacts(plan, room.members)],
    hasMore: false,
  });
}
