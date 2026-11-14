import { compareOptions, type PlanView } from "../plans/model";
import type { AgentContext } from "./capabilities";

/** Read fresh scoped facts before generation, even if the model skips its read tool. */
export async function currentPlanningContext(
  context: Pick<AgentContext, "scope" | "readPlans" | "recordTool">,
) {
  if (context.scope.kind !== "room") return null;
  const facts = await context.readPlans(context.scope.roomId);
  await context.recordTool("read_plans", "room-read", "read");
  return facts;
}

/** Explicit allowlist: even organizer-visible private notes never enter agent context. */
export function planningFacts(
  plan: PlanView,
  members: { userId: string; name: string }[],
) {
  const people = (ids: string[]) =>
    ids.map((userId) => ({
      userId,
      name: members.find((m) => m.userId === userId)?.name ?? "Member",
    }));
  const matching = (predicate: (id: string) => boolean) =>
    people(plan.participantIds.filter(predicate));
  const response = (id: string) => plan.responses.find((r) => r.userId === id);
  const decision = (id: string) =>
    plan.decisions.find(
      (d) => d.userId === id && d.termsVersion === plan.termsVersion,
    );
  return {
    id: plan.id,
    title: plan.title,
    state: plan.state,
    revision: plan.revision,
    optionsVersion: plan.optionsVersion,
    termsVersion: plan.termsVersion,
    timeZone: plan.timeZone,
    location: plan.location,
    budgetCents: plan.budgetCents,
    currency: plan.currency,
    deadline: plan.deadline,
    terms: plan.terms,
    link: `/app/rooms/${plan.roomId}?view=plan&plan=${plan.id}`,
    missingResponses: matching((id) => !response(id)),
    options: compareOptions(plan).map((slot) => ({
      ...slot,
      worksMembers: matching((id) => response(id)?.votes[slot.id] === "works"),
      flexibleMembers: matching(
        (id) => response(id)?.votes[slot.id] === "if_needed",
      ),
      unavailableMembers: matching(
        (id) => response(id)?.votes[slot.id] === "cant",
      ),
      unansweredMembers: matching((id) => !response(id)?.votes[slot.id]),
    })),
    budget: {
      works: matching((id) => response(id)?.budget === "works"),
      doesntWork: matching((id) => response(id)?.budget === "doesnt_work"),
      unknown: matching(
        (id) => !response(id) || response(id)?.budget === "unsure",
      ),
    },
    finalDecisions: plan.terms
      ? {
          accepted: matching((id) => decision(id)?.decision === "accepted"),
          declined: matching((id) => decision(id)?.decision === "declined"),
          missing: matching((id) => !decision(id)),
        }
      : null,
    confirmedMembers: people(plan.confirmedIds),
    expenseDraftLink:
      plan.state === "completed"
        ? `/app/rooms/${plan.roomId}?view=money&fromPlan=${plan.id}`
        : null,
    notice:
      "Options ranked by works + if needed, then works; chronological order breaks ties, not preference. Unanswered is unknown. Availability and budget responses are not final approval. Private notes are excluded; dietary/accessibility compatibility is unknown. No plan was changed.",
  };
}
export type PlanningFacts = ReturnType<typeof planningFacts>;

/** Consent status is authoritative product state, not a model inference. */
export function planningStatusReply(
  request: string,
  facts: { plans: PlanningFacts[]; hasMore: boolean },
  replyText?: string,
) {
  const explicitlyNamed = facts.plans.filter((p) =>
    request.toLowerCase().includes(p.title.toLowerCase()),
  );
  const activePlans = facts.plans.filter((p) =>
    ["confirming", "confirmed"].includes(p.state),
  );
  const statusQuestion = /\b(?:confirmed|decisions|all set|final details|who(?:'s| is| are)? (?:joining|going|coming|attending)|(?:is|are) .{1,80} (?:joining|going|coming|attending))\b/i.test(request);
  if (!statusQuestion || /\b(?:instead|happen|change|prepare|create)\b/i.test(request)) return null;
  const linked = facts.plans.filter(p => replyText?.includes(p.link));
  if (linked.length && explicitlyNamed.length && !explicitlyNamed.some(p => linked.some(l => l.id === p.id)))
    return "Those plan references conflict. Which outing do you want to check?";
  const candidates = linked.length ? linked : explicitlyNamed.length ? explicitlyNamed : activePlans;
  if (facts.hasMore || candidates.length !== 1) return null;
  const plan = candidates[0];
  if (!plan.terms || !["confirmed", "confirming"].includes(plan.state))
    return `${plan.title} is ${plan.state}. ${plan.link}`;
  const names = (people: { name: string }[]) =>
    new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(
      people.map((p) => p.name.replace(/ · agent$/, "")),
    );
  const when = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${plan.terms.localStart}:00Z`));
  const detail = `${plan.title} ${plan.state === "confirmed" ? "is set" : "is proposed"} for ${when} (${plan.terms.timeZone}) at ${plan.terms.location}, up to $${(plan.terms.budgetCents / 100).toFixed(2)} each.`;
  if (plan.state === "confirmed") {
    const decisions = plan.finalDecisions!;
    const mentioned = [...decisions.accepted, ...decisions.declined, ...decisions.missing].filter(person => {
      const name = person.name.replace(/ · agent$/, "").toLowerCase();
      return (` ${request.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ")} `).includes(` ${name} `);
    });
    const notes = mentioned.filter(person => !plan.confirmedMembers.some(member => member.userId === person.userId)).map(person => {
      const name = person.name.replace(/ · agent$/, "");
      return decisions.declined.some(p => p.userId === person.userId)
        ? `${name} isn't joining ${plan.title}.`
        : decisions.accepted.some(p => p.userId === person.userId)
          ? `${name} accepted but isn't on the confirmed roster yet.`
          : `${name} hasn't confirmed for ${plan.title} yet.`;
    });
    return [...notes, detail, `${names(plan.confirmedMembers)} are joining.`, plan.link].join(" ");
  }
  const decision = plan.finalDecisions!;
  const parts = [detail];
  if (decision.declined.length)
    parts.push(`${names(decision.declined)} declined this time.`);
  if (decision.accepted.length)
    parts.push(`${names(decision.accepted)} accepted this time.`);
  if (decision.missing.length)
    parts.push(`Still waiting for ${names(decision.missing)}.`);
  parts.push(`It isn't locked in. ${plan.link}`);
  return parts.join(" ");
}
