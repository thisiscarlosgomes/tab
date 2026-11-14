import { z } from "zod";
import { entityId, retryId } from "../model";

export const slotInput = z
  .object({
    localStart: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    localEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  })
  .strict();
export const termsInput = slotInput.extend({
  timeZone: z.string().min(1).max(100),
  location: z.string().trim().min(1).max(240),
  budgetCents: z.number().int().min(0).max(100_000_000),
});
export const createPlanInput = z
  .object({
    clientId: retryId,
    title: z.string().trim().min(1).max(100),
    participantIds: z.array(entityId).min(1).max(50),
    timeZone: z.string().min(1).max(100),
    location: z.string().trim().min(1).max(240),
    budgetCents: z.number().int().min(0).max(100_000_000),
    slots: z.array(slotInput).min(1).max(5),
    deadline: z.string().datetime().nullable(),
  })
  .strict();
const commandBase = { clientId: retryId };
const organizerBase = {
  ...commandBase,
  expectedRevision: z.number().int().min(0),
};
export const commandInput = z.discriminatedUnion("action", [
  z
    .object({
      ...commandBase,
      action: z.literal("request_rejoin"),
      termsVersion: z.number().int().min(1),
      expectedDecisionVersion: z.number().int().min(0),
    })
    .strict(),
  z.object({ ...organizerBase, action: z.literal("approve_rejoins") }).strict(),
  z
    .object({
      ...organizerBase,
      action: z.literal("edit_draft"),
      fields: createPlanInput.omit({ clientId: true }),
    })
    .strict(),
  z
    .object({
      ...organizerBase,
      action: z.literal("extend_deadline"),
      deadline: z.string().datetime().nullable(),
    })
    .strict(),
  z
    .object({
      ...organizerBase,
      action: z.literal("add_participants"),
      participantIds: z.array(entityId).min(1).max(50),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      action: z.literal("withdraw"),
      termsVersion: z.number().int().min(1),
      expectedDecisionVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      action: z.literal("clear_note"),
      expectedResponseVersion: z.number().int().min(0),
    })
    .strict(),
  z.object({ ...organizerBase, action: z.literal("publish") }).strict(),
  z.object({ ...organizerBase, action: z.literal("cancel") }).strict(),
  z.object({ ...organizerBase, action: z.literal("complete") }).strict(),
  z.object({ ...organizerBase, action: z.literal("finalize") }).strict(),
  z
    .object({
      ...organizerBase,
      action: z.literal("propose"),
      terms: termsInput,
    })
    .strict(),
  z
    .object({
      ...organizerBase,
      action: z.literal("rework"),
      slots: z.array(slotInput).min(1).max(5),
      deadline: z.string().datetime().nullable(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      action: z.literal("respond"),
      optionsVersion: z.number().int(),
      expectedResponseVersion: z.number().int().min(0),
      votes: z.record(z.enum(["works", "if_needed", "cant"])),
      budget: z.enum(["works", "doesnt_work", "unsure"]),
      privateNote: z.string().trim().max(500),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      action: z.literal("decide"),
      termsVersion: z.number().int().min(1),
      expectedDecisionVersion: z.number().int().min(0),
      decision: z.enum(["accepted", "declined"]),
    })
    .strict(),
]);
export const slotSchema = slotInput.extend({
  id: entityId,
  startAt: z.string(),
  endAt: z.string(),
});
export const termsSchema = termsInput.extend({
  startAt: z.string(),
  endAt: z.string(),
});
const responseSchema = z.object({
  userId: entityId,
  version: z.number(),
  votes: z.record(z.enum(["works", "if_needed", "cant"])),
  budget: z.enum(["works", "doesnt_work", "unsure"]),
  privateNote: z.string().optional(),
  updatedAt: z.string(),
});
export const planSchema = z.object({
  id: entityId,
  roomId: entityId,
  creatorId: entityId,
  title: z.string(),
  participantIds: z.array(entityId),
  timeZone: z.string(),
  location: z.string(),
  budgetCents: z.number(),
  currency: z.literal("USD"),
  state: z.enum([
    "draft",
    "collecting",
    "confirming",
    "confirmed",
    "completed",
    "cancelled",
  ]),
  revision: z.number(),
  optionsVersion: z.number(),
  termsVersion: z.number(),
  slots: z.array(slotSchema),
  deadline: z.string().nullable(),
  responses: z.array(responseSchema),
  terms: termsSchema.nullable(),
  decisions: z.array(
    z.object({
      userId: entityId,
      termsVersion: z.number(),
      version: z.number(),
      decision: z.enum(["accepted", "declined"]),
      at: z.string(),
    }),
  ),
  confirmedIds: z.array(entityId),
  history: z.array(
    z.object({
      id: entityId,
      action: z.string(),
      actorId: entityId,
      at: z.string(),
      termsVersion: z.number(),
      terms: termsSchema.nullable().optional(),
      decision: z.enum(["accepted", "declined"]).optional(),
      confirmedIds: z.array(entityId).optional(),
      participantIds: z.array(entityId).optional(),
      deadline: z.string().nullable().optional(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PlanView = z.infer<typeof planSchema>;
export type Plan = PlanView & {
  creationId: string;
  creationHash: string;
  requests: { id: string; actorId: string; hash: string }[];
};
export type PlanCommand = z.infer<typeof commandInput>;
export function compareOptions(plan: PlanView) {
  return plan.slots
    .map((slot) => ({
      ...slot,
      works: plan.responses.filter((r) => r.votes[slot.id] === "works").length,
      flexible: plan.responses.filter((r) => r.votes[slot.id] === "if_needed")
        .length,
      cant: plan.responses.filter((r) => r.votes[slot.id] === "cant").length,
      unanswered:
        plan.participantIds.length -
        plan.responses.filter((r) => r.votes[slot.id]).length,
    }))
    .sort(
      (a, b) =>
        b.works + b.flexible - (a.works + a.flexible) ||
        b.works - a.works ||
        a.startAt.localeCompare(b.startAt),
    );
}

export function planAttentionLabel(
  plan: PlanView,
  userId: string,
  now = Date.now(),
) {
  if (plan.state === "confirmed" && plan.terms) {
    if (Date.parse(plan.terms.endAt) <= now)
      return plan.creatorId === userId
        ? "Past outing · mark complete"
        : "Past outing · awaiting organizer";
    if (!plan.confirmedIds.length)
      return "No confirmed attendees · review plan";
    if (!plan.confirmedIds.includes(userId))
      return "Finalized · you’re not included";
    return Date.parse(plan.terms.startAt) <= now
      ? "Happening now · you’re going"
      : "Upcoming · you’re going";
  }
  if (!plan.participantIds.includes(userId))
    return "Review your group’s progress";
  if (plan.state === "confirming")
    return plan.decisions.some((d) => d.userId === userId)
      ? "Review confirmations"
      : "Confirm your participation";
  if (plan.deadline && Date.parse(plan.deadline) <= now)
    return "Response deadline passed";
  return plan.responses.some((r) => r.userId === userId)
    ? "Waiting for the group"
    : "Share your availability";
}
