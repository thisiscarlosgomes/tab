import { planProposalSchema } from "./plan-proposals";
import { z } from "zod";
import { entityId, retryId, expenseInput } from "../model";
export const personalMessageInput = z
  .object({ clientId: retryId, text: z.string().trim().min(1).max(2000) })
  .strict();
export const turnSchema = z.object({
  id: entityId,
  clientId: retryId,
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  createdAt: z.string(),
  replyTo: entityId.nullable(),
});
export type Turn = z.infer<typeof turnSchema>;
export const noteInput = z
  .object({
    text: z.string().trim().max(4000),
    expectedVersion: z.number().int().min(0),
    clientId: retryId,
  })
  .strict();
export const noteSchema = z.object({
  text: z.string(),
  version: z.number(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  history: z.array(
    z.object({
      text: z.string(),
      version: z.number(),
      updatedBy: z.string(),
      updatedAt: z.string(),
    }),
  ),
});
export type Note = z.infer<typeof noteSchema>;
export const reminderInput = z
  .object({
    clientId: retryId,
    roomId: entityId,
    text: z.string().trim().min(1).max(240),
    dueAt: z.string().datetime(),
  })
  .strict();
export const reminderSchema = z.object({
  id: entityId,
  clientId: retryId,
  userId: entityId,
  roomId: entityId,
  text: z.string(),
  dueAt: z.string(),
  createdAt: z.string(),
  dismissed: z.boolean(),
});
export type Reminder = z.infer<typeof reminderSchema>;
export const prepareInput = expenseInput
  .omit({ clientId: true })
  .partial()
  .extend({
    roomId: entityId,
    sourcePlanId: entityId.optional(),
    correctionOf: entityId.optional(),
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict();
// Model-facing optional values are explicitly nullable. Responses models may
// otherwise fill omitted fields (including correction IDs) with invented values.
export const prepareToolInput = z.object({
  roomId: entityId,
  description: prepareInput.shape.description.unwrap().nullable(),
  payerId: prepareInput.shape.payerId.unwrap().nullable().describe("Accepted member ID explicitly identified as payer; null if unknown"),
  totalCents: prepareInput.shape.totalCents.unwrap().nullable(),
  shares: prepareInput.shape.shares.unwrap().nullable().describe("Only explicitly specified participants; null when participants are unknown, even if equal splitting was requested"),
  attachmentId: entityId.nullable(),
  sourcePlanId: entityId.nullable().optional().describe("Completed outing ID only when explicitly preparing its expense; otherwise null"),
  correctionOf: entityId.nullable().describe("Existing expense ID only when a correction was explicitly requested; otherwise null"),
  expectedVersion: z.number().int().min(1).nullable().describe("Existing expense version for a correction; otherwise null"),
}).strict();
export function normalizePreparation(input: z.infer<typeof prepareToolInput>) {
  return prepareInput.parse(Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null)));
}
export const proposalSchema = z.object({
  sourcePlanId: entityId.optional(),
  id: entityId,
  userId: entityId,
  roomId: entityId,
  runKey: z.string(),
  visibility: z.enum(["personal", "room"]),
  publication: z.object({ sourceId: entityId, revision: z.string() }).optional(),
  members: z.array(z.object({ userId: entityId, name: z.string() })),
  createdAt: z.string(),
  fields: expenseInput.omit({ clientId: true }),
  appliedExpenseId: entityId.nullable(),
  correctionOf: entityId.optional(),
  expectedVersion: z.number().int().optional(),
});
export type NeedsDetails = {
  kind: "needs_details";
  missing: string[];
  message: string;
  extracted: unknown;
};
export type Proposal = z.infer<typeof proposalSchema>;
export const agentViewSchema = z.object({
  messages: z.array(turnSchema),
  proposals: z.array(proposalSchema),
  planProposals: z.array(planProposalSchema),
});
export const TAB_BOT_ID = "00000000-0000-4000-8000-000000000001";
export function mentionsTab(text: string): boolean {
  return /(^|[\s([{"',;!?])@tab(?=$|[\s,!?;:()[\]{}"']|\.(?=\s|$))/iu.test(
    text,
  );
}
