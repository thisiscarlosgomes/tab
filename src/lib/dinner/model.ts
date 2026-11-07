import { z } from "zod";

export const retryId = z.string().uuid();
export const entityId = z.string().uuid();
const cents = z.number().int().min(0).max(100_000_000);
export const roomInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    purpose: z.string().trim().min(1).max(400),
    clientId: retryId,
  })
  .strict();
export const inviteInput = z
  .object({
    clientId: retryId,
    targetSubject: z
      .string()
      .regex(/^\d{1,30}$/)
      .optional(),
    targetLabel: z.string().trim().max(80).optional(),
  })
  .strict();
export const messageInput = z
  .object({
    clientId: retryId,
    text: z.string().trim().max(2000),
    replyTo: entityId.optional(),
    attachmentIds: z.array(entityId).max(3).default([]),
  })
  .strict()
  .refine(
    (v) => v.text.length > 0 || v.attachmentIds.length > 0,
    "Write a message or attach an image",
  );
export const expenseInput = z
  .object({
    clientId: retryId,
    description: z.string().trim().min(1).max(120),
    payerId: entityId,
    totalCents: cents.refine((n) => n > 0, "Total must be positive"),
    shares: z
      .array(z.object({ userId: entityId, cents }).strict())
      .min(1)
      .max(50),
    attachmentId: entityId.optional(),
  })
  .strict();
export type ExpenseFields = z.infer<typeof expenseInput>;
export type MessageFields = z.infer<typeof messageInput>;
export type Actor = { id: string; name: string; twitterSubject: string | null };
export type Member = {
  userId: string;
  name: string;
  role: "owner" | "member";
  joinedAt: string;
  readSeq: number;
};
export type Invitation = {
  id: string;
  clientId: string;
  tokenHash: string;
  inviterId: string;
  targetSubject: string | null;
  targetLabel: string | null;
  status: "pending" | "accepted" | "declined" | "revoked";
  resolvedBy: string | null;
  expiresAt: string;
  createdAt: string;
};
type MessageBase = {
  id: string;
  seq: number;
  authorId: string;
  clientId: string;
  text: string;
  replyTo: string | null;
  attachmentIds: string[];
  createdAt: string;
  reactions: { userId: string; emoji: string }[];
};
export type Message = MessageBase &
  ({ kind?: "member" } | { kind: "tab"; requestedBy: string; runId: string });
// An outside report is a member claim, never evidence of an in-app transfer.
const reportBase = z.object({
  id: entityId,
  clientId: retryId,
  reportedBy: entityId,
  cents: cents.refine((n) => n > 0),
  createdAt: z.string(),
});
export const outsideReportSchema = z.discriminatedUnion("status", [
  reportBase.extend({ status: z.literal("pending") }),
  reportBase.extend({
    status: z.enum(["confirmed", "rejected", "cancelled"]),
    resolvedBy: entityId,
    resolutionId: retryId,
    resolvedAt: z.string(),
  }),
]);
export type OutsideReport = z.infer<typeof outsideReportSchema>;
const obligationBase = z.object({
  id: entityId,
  expenseId: entityId,
  debtorId: entityId,
  creditorId: entityId,
  cents: cents.refine((n) => n > 0),
  currency: z.literal("USD"),
  // Optional for existing beta records; no legacy documents are rewritten.
  outsideReports: z.array(outsideReportSchema).optional(),
});
export const obligationSchema = z.discriminatedUnion("status", [
  obligationBase.extend({ status: z.literal("outstanding") }),
  obligationBase.extend({
    status: z.literal("confirmed_outside"),
    confirmedReportId: entityId,
  }),
]);
export type Obligation = z.infer<typeof obligationSchema>;
type ExpenseBase = Omit<ExpenseFields, "clientId"> & {
  id: string;
  version: number;
  clientId: string;
  creatorId: string;
  createdAt: string;
  flags: { userId: string; reason: string }[];
};
export type Expense =
  | (ExpenseBase & { status: "draft" })
  | (ExpenseBase & {
      status: "confirmed";
      confirmedAt: string;
      confirmationId: string;
      obligations: Obligation[];
    });
export type Room = {
  id: string;
  creationId: string;
  revision: number;
  name: string;
  purpose: string;
  ownerId: string;
  createdAt: string;
  members: Member[];
  invitations: Invitation[];
  messages: Message[];
  expenses: Expense[];
};
export type RoomView = Omit<Room, "invitations" | "creationId"> & {
  invitations: Omit<Invitation, "tokenHash">[];
};
export type Preview = {
  roomId: string;
  name: string;
  purpose: string;
  inviter: string;
  members: string[];
  status: Invitation["status"] | "expired";
  targetLabel: string | null;
  accountBound: boolean;
  expiresAt: string;
};
export class DinnerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, message: string): never {
  throw new DinnerError(status, message);
}
export function requireMember(room: Room, actor: Actor): Member {
  return (
    room.members.find((m) => m.userId === actor.id) ??
    fail(404, "Room not found")
  );
}
export function invitationStatus(
  invite: Pick<Invitation, "status" | "expiresAt">,
  now: string,
): Preview["status"] {
  return invite.status === "pending" && invite.expiresAt <= now
    ? "expired"
    : invite.status;
}
export function roomView(room: Room): RoomView {
  const { creationId: _creationId, invitations, ...view } = room;
  return {
    ...view,
    invitations: invitations.map(
      ({ tokenHash: _tokenHash, ...invite }) => invite,
    ),
  };
}
export function validateShares(input: ExpenseFields, room: Room): void {
  if (!room.members.some((m) => m.userId === input.payerId))
    fail(400, "Payer must be an accepted member");
  const ids = new Set(input.shares.map((s) => s.userId));
  if (ids.size !== input.shares.length)
    fail(400, "Participants must be unique");
  if (
    input.shares.some((s) => !room.members.some((m) => m.userId === s.userId))
  )
    fail(400, "Only accepted members can have a share");
  if (input.shares.reduce((sum, s) => sum + s.cents, 0) !== input.totalCents)
    fail(400, "Shares must add up exactly to the total");
}
export function parseUsd(value: string): number | null {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, decimal = ""] = value.trim().split(".");
  const valueCents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return valueCents <= 100_000_000 ? valueCents : null;
}
export function splitEvenly(
  total: number,
  ids: string[],
): { userId: string; cents: number }[] {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !ids.length ||
    new Set(ids).size !== ids.length
  )
    return [];
  return ids.map((userId, index) => ({
    userId,
    cents:
      Math.floor(total / ids.length) + (index < total % ids.length ? 1 : 0),
  }));
}
export function usd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}
export function obligations(room: Pick<Room, "expenses">): Obligation[] {
  return room.expenses.flatMap((e) =>
    e.status === "confirmed" ? e.obligations : [],
  );
}
export function totals(room: Pick<Room, "expenses">, userId: string) {
  return obligations(room).reduce(
    (sum, o) =>
      o.status !== "outstanding"
        ? sum
        : {
            owe: sum.owe + (o.debtorId === userId ? o.cents : 0),
            owed: sum.owed + (o.creditorId === userId ? o.cents : 0),
          },
    { owe: 0, owed: 0 },
  );
}
