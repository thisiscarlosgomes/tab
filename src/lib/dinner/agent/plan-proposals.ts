import { z } from "zod";
import { entityId } from "../model";
import { createPlanInput } from "../plans/model";

const fields = createPlanInput.omit({ clientId: true, deadline: true });
export const planIdeaFields = z
  .object({
    title: fields.shape.title.nullable(),
    participantIds: fields.shape.participantIds.nullable(),
    timeZone: fields.shape.timeZone.nullable(),
    location: fields.shape.location.nullable(),
    budgetCents: fields.shape.budgetCents.nullable(),
    slots: fields.shape.slots.nullable(),
  })
  .strict();
export const preparePlanInput = z
  .object({
    roomId: entityId,
    idea: z.string().trim().min(1).max(500),
    fields: planIdeaFields,
  })
  .strict();
export const planProposalSchema = preparePlanInput.extend({
  id: entityId,
  userId: entityId,
  runKey: z.string(),
  visibility: z.enum(["personal", "room"]),
  createdAt: z.string(),
  appliedPlanId: entityId.nullable(),
});
export type PlanProposal = z.infer<typeof planProposalSchema>;
export const missingPlanDetails = (value: PlanProposal["fields"]) =>
  (
    [
      ["title", "title"],
      ["participantIds", "participants"],
      ["timeZone", "time zone"],
      ["location", "place"],
      ["budgetCents", "budget"],
      ["slots", "time options"],
    ] as const
  )
    .filter(([key]) => value[key] === null)
    .map(([, label]) => label);

/** Presentation grouping only; matching titles never revoke an older proposal. */
export function proposalPresentation(
  proposal: PlanProposal,
  all: PlanProposal[],
) {
  const title = (p: PlanProposal) =>
    (p.fields.title ?? p.idea).trim().toLocaleLowerCase();
  const related = all
    .filter(
      (p) =>
        p.roomId === proposal.roomId &&
        p.userId === proposal.userId &&
        p.visibility === proposal.visibility &&
        title(p) === title(proposal),
    )
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  const index = related.findIndex((p) => p.id === proposal.id);
  const previous = index > 0 ? related[index - 1] : undefined;
  const latest = related.at(-1) ?? proposal;
  const labels = {
    title: "Title",
    participantIds: "Participants",
    timeZone: "Time zone",
    location: "Place",
    budgetCents: "Budget",
    slots: "Time options",
  };
  const changed = previous
    ? (Object.keys(labels) as (keyof typeof labels)[])
        .filter(
          (key) =>
            JSON.stringify(previous.fields[key]) !==
            JSON.stringify(proposal.fields[key]),
        )
        .map((key) => labels[key])
    : [];
  return { latest, earlier: latest.id !== proposal.id, previous, changed };
}
export function proposalSourceId(proposal: PlanProposal) {
  return proposal.runKey.split(":").at(-1) ?? "";
}

/** Suggestions cannot advertise publication, voting, or confirmation. */
export function planPreparationReply(proposal: PlanProposal) {
  const missing = missingPlanDetails(proposal.fields);
  return `I saved a suggestion for ${proposal.fields.title ?? "the outing"}.${missing.length ? ` I still need ${new Intl.ListFormat("en").format(missing)}.` : ""} Review it in Plan before publishing; voting hasn't started. /app/rooms/${proposal.roomId}?view=plan&proposal=${proposal.id}`;
}
