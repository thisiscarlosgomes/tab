import { z } from "zod";
import { expenseInput } from "./model";

export const meSchema = z.object({ id: z.string(), name: z.string() });
export const messageSchema = z.object({
  id: z.string(),
  seq: z.number(),
  authorId: z.string(),
  clientId: z.string(),
  text: z.string(),
  replyTo: z.string().nullable(),
  attachmentIds: z.array(z.string()),
  createdAt: z.string(),
  reactions: z.array(z.object({ userId: z.string(), emoji: z.string() })),
});
const expenseBase = expenseInput.extend({
  id: z.string(),
  creatorId: z.string(),
  createdAt: z.string(),
  version: z.number(),
  flags: z.array(z.object({ userId: z.string(), reason: z.string() })),
});
export const expenseSchema = z.discriminatedUnion("status", [
  expenseBase.extend({ status: z.literal("draft") }),
  expenseBase.extend({
    status: z.literal("confirmed"),
    confirmedAt: z.string(),
    confirmationId: z.string(),
    obligations: z.array(
      z.object({
        id: z.string(),
        expenseId: z.string(),
        debtorId: z.string(),
        creditorId: z.string(),
        cents: z.number().int(),
        currency: z.literal("USD"),
        status: z.literal("outstanding"),
      }),
    ),
  }),
]);
export const roomSchema = z.object({
  id: z.string(),
  revision: z.number(),
  name: z.string(),
  purpose: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
  members: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      role: z.enum(["owner", "member"]),
      joinedAt: z.string(),
      readSeq: z.number(),
    }),
  ),
  messages: z.array(messageSchema),
  expenses: z.array(expenseSchema),
  invitations: z.array(
    z.object({
      id: z.string(),
      clientId: z.string(),
      inviterId: z.string(),
      targetSubject: z.string().nullable(),
      targetLabel: z.string().nullable(),
      status: z.enum(["pending", "accepted", "declined", "revoked"]),
      resolvedBy: z.string().nullable(),
      expiresAt: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export const listSchema = z.object({
  rooms: z.array(
    roomSchema.extend({
      unread: z.number(),
      lastMessage: z.string().nullable(),
    }),
  ),
  invites: z.array(
    z.object({
      id: z.string(),
      roomId: z.string(),
      name: z.string(),
      purpose: z.string(),
      members: z.array(z.string()),
      inviter: z.string(),
      expiresAt: z.string(),
    }),
  ),
});
export const previewSchema = z.object({
  roomId: z.string(),
  name: z.string(),
  purpose: z.string(),
  inviter: z.string(),
  members: z.array(z.string()),
  status: z.enum(["pending", "accepted", "declined", "revoked", "expired"]),
  targetLabel: z.string().nullable(),
  expiresAt: z.string(),
});
