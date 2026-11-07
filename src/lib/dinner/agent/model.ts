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
  .omit({ clientId: true, attachmentId: true })
  .extend({ roomId: entityId })
  .strict();
export const proposalSchema = z.object({
  id: entityId,
  userId: entityId,
  roomId: entityId,
  runKey: z.string(),
  visibility: z.enum(["personal", "room"]),
  members: z.array(z.object({ userId: entityId, name: z.string() })),
  createdAt: z.string(),
  fields: expenseInput.omit({ clientId: true }),
  appliedExpenseId: entityId.nullable(),
});
export type Proposal = z.infer<typeof proposalSchema>;
export const agentViewSchema = z.object({
  messages: z.array(turnSchema),
  proposals: z.array(proposalSchema),
});
export const TAB_BOT_ID = "00000000-0000-4000-8000-000000000001";
export function mentionsTab(text: string): boolean {
  return /(^|[\s([{"',;!?])@tab(?=$|[\s,!?;:()[\]{}"']|\.(?=\s|$))/iu.test(
    text,
  );
}
