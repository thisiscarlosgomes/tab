import { z } from "zod";
import { planSchema, termsSchema } from "./model";

export const planSummarySchema = planSchema
  .pick({
    id: true,
    title: true,
    state: true,
    revision: true,
    creatorId: true,
    participantIds: true,
    timeZone: true,
    location: true,
    budgetCents: true,
    slots: true,
    deadline: true,
    terms: true,
    termsVersion: true,
    confirmedIds: true,
    updatedAt: true,
  })
  .extend({
    responses: z.array(z.object({ userId: z.string() })),
    decisions: z.array(
      z.object({
        userId: z.string(),
        termsVersion: z.number(),
        decision: z.enum(["accepted", "declined"]),
      }),
    ),
  });
export type PlanSummary = z.infer<typeof planSummarySchema>;
export const planEventActions = [
  "publish",
  "propose",
  "finalize",
  "auto_finalize",
  "withdraw",
  "request_rejoin",
  "approve_rejoins",
  "add_participants",
  "extend_deadline",
  "rework",
  "cancel",
  "complete",
] as const;
export const planEventSchema = z.object({
  id: z.string(),
  planId: z.string().uuid(),
  title: z.string(),
  at: z.string().datetime(),
  actorId: z.string().uuid(),
  action: z.enum(planEventActions),
  termsVersion: z.number(),
  index: z.number().int().min(0),
  terms: termsSchema.nullable().optional(),
});
export type PlanEvent = z.infer<typeof planEventSchema>;
export const planFeedSchema = z.object({
  plans: z.array(planSummarySchema),
  morePlans: z.boolean(),
  events: z.array(planEventSchema),
  nextCursor: z.string().nullable(),
});
export type PlanFeed = z.infer<typeof planFeedSchema>;
export const feedCursorSchema = z
  .object({
    at: z.string().datetime(),
    planId: z.string().uuid(),
    index: z.number().int().min(0),
  })
  .strict();
export function planAction(
  plan: PlanSummary,
  userId: string,
  now = Date.now(),
) {
  if (!plan.participantIds.includes(userId)) return "View details";
  if (
    plan.state === "collecting" &&
    (!plan.deadline || Date.parse(plan.deadline) > now)
  )
    return plan.responses.some((r) => r.userId === userId)
      ? "Edit response"
      : "Respond";
  if (
    plan.state === "confirming" &&
    !plan.decisions.some(
      (d) => d.userId === userId && d.termsVersion === plan.termsVersion,
    )
  )
    return "Confirm";
  return "View details";
}
export function eventDescription(event: PlanEvent, name: string) {
  if (event.action === "auto_finalize")
    return "Everyone confirmed · outing locked in";
  const descriptions: Record<PlanEvent["action"], string> = {
    publish: "published a plan",
    propose: "proposed new details",
    finalize: "finalized the outing",
    auto_finalize: "confirmed the outing",
    withdraw: "withdrew from the outing",
    request_rejoin: "asked to rejoin the outing",
    approve_rejoins: "approved returning attendees",
    add_participants: "invited more participants",
    extend_deadline: "updated the response deadline",
    rework: "reopened the options",
    cancel: "cancelled the outing",
    complete: "marked the outing complete",
  };
  return `${name} ${descriptions[event.action]}`;
}
