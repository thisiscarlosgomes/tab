import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  Actor,
  Room,
  Invitation,
  Preview,
  Message,
  Expense,
  DinnerError,
  fail,
  requireMember,
  roomView,
  invitationStatus,
  roomInput,
  inviteInput,
  messageInput,
  expenseInput,
  validateShares,
  retryId,
} from "./model";

export interface RoomStore {
  insert(room: Room): Promise<Room>;
  get(id: string): Promise<Room | null>;
  list(userId: string, subject: string | null): Promise<Room[]>;
  byToken(hash: string): Promise<Room | null>;
  compareAndSwap(room: Room, revision: number): Promise<boolean>;
}
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export class DinnerService {
  constructor(
    private store: RoomStore,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async memberRoom(id: string, actor: Actor): Promise<Room> {
    const room = (await this.store.get(id)) ?? fail(404, "Room not found");
    requireMember(room, actor);
    return room;
  }
  async change<T>(
    id: string,
    actor: Actor,
    update: (room: Room) => T,
  ): Promise<T> {
    for (let attempt = 0; attempt < 15; attempt++) {
      const room = await this.memberRoom(id, actor);
      const revision = room.revision;
      const result = update(room);
      room.revision++;
      if (await this.store.compareAndSwap(room, revision)) return result;
    }
    return fail(409, "Room is busy. Retry with the same request ID.");
  }
  async create(actor: Actor, raw: unknown) {
    const input = roomInput.parse(raw);
    return roomView(
      await this.store.insert({
        id: randomUUID(),
        creationId: input.clientId,
        revision: 0,
        name: input.name,
        purpose: input.purpose,
        ownerId: actor.id,
        createdAt: this.now(),
        members: [
          {
            userId: actor.id,
            name: actor.name,
            role: "owner",
            joinedAt: this.now(),
            readSeq: 0,
          },
        ],
        invitations: [],
        messages: [],
        expenses: [],
      }),
    );
  }
  async list(actor: Actor) {
    const rooms = await this.store.list(actor.id, actor.twitterSubject);
    return {
      rooms: rooms
        .filter((r) => r.members.some((m) => m.userId === actor.id))
        .map((r) => ({
          ...roomView(r),
          messages: [],
          unread: r.messages.filter(
            (m) =>
              m.seq >
                (r.members.find((member) => member.userId === actor.id)
                  ?.readSeq ?? 0) && m.authorId !== actor.id,
          ).length,
          lastMessage: r.messages.at(-1)?.text ?? null,
        })),
      invites: rooms.flatMap((r) =>
        r.invitations
          .filter(
            (i) =>
              i.targetSubject &&
              i.targetSubject === actor.twitterSubject &&
              invitationStatus(i, this.now()) === "pending",
          )
          .map((i) => ({
            id: i.id,
            roomId: r.id,
            name: r.name,
            purpose: r.purpose,
            members: r.members.map((m) => m.name),
            inviter:
              r.members.find((m) => m.userId === i.inviterId)?.name ??
              "A friend",
            expiresAt: i.expiresAt,
          })),
      ),
    };
  }
  async invite(id: string, actor: Actor, raw: unknown) {
    const input = inviteInput.parse(raw);
    const token = randomBytes(32).toString("base64url");
    const invite: Invitation = {
      id: randomUUID(),
      clientId: input.clientId,
      tokenHash: tokenHash(token),
      inviterId: actor.id,
      targetSubject: input.targetSubject ?? null,
      targetLabel: input.targetLabel ?? null,
      status: "pending",
      resolvedBy: null,
      expiresAt: new Date(Date.parse(this.now()) + 7 * 86400_000).toISOString(),
      createdAt: this.now(),
    };
    await this.change(id, actor, (room) => {
      if (
        room.invitations.some(
          (i) => i.clientId === input.clientId && i.inviterId === actor.id,
        )
      )
        fail(409, "Link already created. Create a new link if you lost it.");
      if (room.invitations.length >= 100)
        fail(422, "This beta room has reached its invitation limit");
      room.invitations.push(invite);
    });
    return { id: invite.id, token, expiresAt: invite.expiresAt };
  }
  async preview(token: string): Promise<Preview> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(404, "Invitation not found");
    const room =
      (await this.store.byToken(tokenHash(token))) ??
      fail(404, "Invitation not found");
    const invite =
      room.invitations.find((i) => i.tokenHash === tokenHash(token)) ??
      fail(404, "Invitation not found");
    return {
      roomId: room.id,
      name: room.name,
      purpose: room.purpose,
      inviter:
        room.members.find((m) => m.userId === invite.inviterId)?.name ??
        "A friend",
      members: room.members.map((m) => m.name),
      status: invitationStatus(invite, this.now()),
      targetLabel: invite.targetLabel,
      expiresAt: invite.expiresAt,
    };
  }
  async respond(
    actor: Actor,
    input: { token?: string; roomId?: string; invitationId?: string },
    decision: "accepted" | "declined",
  ) {
    const hash = input.token ? tokenHash(input.token) : null;
    const found = hash
      ? await this.store.byToken(hash)
      : input.roomId
        ? await this.store.get(input.roomId)
        : null;
    if (!found) fail(404, "Invitation not found");
    for (let attempt = 0; attempt < 15; attempt++) {
      const room =
        (await this.store.get(found.id)) ?? fail(404, "Invitation not found");
      const invite =
        room.invitations.find((i) =>
          hash
            ? i.tokenHash === hash
            : i.id === input.invitationId &&
              i.targetSubject !== null &&
              i.targetSubject === actor.twitterSubject,
        ) ?? fail(404, "Invitation not found");
      if (invite.targetSubject && invite.targetSubject !== actor.twitterSubject)
        fail(403, "This invitation is for a different X account");
      if (invite.status === decision && invite.resolvedBy === actor.id)
        return { roomId: room.id, status: decision };
      if (invitationStatus(invite, this.now()) !== "pending")
        fail(409, "This invitation is no longer pending");
      if (
        decision === "accepted" &&
        !room.members.some((m) => m.userId === actor.id)
      ) {
        if (room.members.length >= 50)
          fail(422, "This beta room has reached its member limit");
        room.members.push({
          userId: actor.id,
          name: actor.name,
          role: "member",
          joinedAt: this.now(),
          readSeq: 0,
        });
      }
      invite.status = decision;
      invite.resolvedBy = actor.id;
      const revision = room.revision++;
      if (await this.store.compareAndSwap(room, revision))
        return { roomId: room.id, status: decision };
    }
    return fail(409, "Room is busy. Retry your invitation response.");
  }
  async revoke(id: string, actor: Actor, invitationId: string) {
    return this.change(id, actor, (room) => {
      const invite =
        room.invitations.find((i) => i.id === invitationId) ??
        fail(404, "Invitation not found");
      if (actor.id !== invite.inviterId && actor.id !== room.ownerId)
        fail(403, "Only the inviter or room owner can revoke");
      if (invitationStatus(invite, this.now()) !== "pending")
        fail(409, "Only pending invitations can be revoked");
      invite.status = "revoked";
      return { status: invite.status };
    });
  }
  async send(id: string, actor: Actor, raw: unknown) {
    const input = messageInput.parse(raw);
    return this.change(id, actor, (room) => {
      const previous = room.messages.find(
        (m) => m.authorId === actor.id && m.clientId === input.clientId,
      );
      if (previous) {
        if (
          !same(
            {
              text: previous.text,
              replyTo: previous.replyTo ?? undefined,
              attachmentIds: previous.attachmentIds,
            },
            {
              text: input.text,
              replyTo: input.replyTo,
              attachmentIds: input.attachmentIds,
            },
          )
        )
          fail(409, "Retry ID was already used for a different message");
        return previous;
      }
      if (room.messages.length >= 1000)
        fail(
          422,
          "This beta room has reached its message limit. History is preserved.",
        );
      if (input.replyTo && !room.messages.some((m) => m.id === input.replyTo))
        fail(400, "Reply target does not exist in this room");
      const message: Message = {
        id: randomUUID(),
        authorId: actor.id,
        clientId: input.clientId,
        text: input.text,
        replyTo: input.replyTo ?? null,
        attachmentIds: input.attachmentIds,
        createdAt: this.now(),
        seq: (room.messages.at(-1)?.seq ?? 0) + 1,
        reactions: [],
      };
      room.messages.push(message);
      return message;
    });
  }
  async react(
    id: string,
    actor: Actor,
    messageId: string,
    emoji: string,
    active: boolean,
  ) {
    if (!["👍", "❤️", "🎉"].includes(emoji)) fail(400, "Unsupported reaction");
    return this.change(id, actor, (room) => {
      const message =
        room.messages.find((m) => m.id === messageId) ??
        fail(404, "Message not found");
      message.reactions = message.reactions.filter(
        (r) => !(r.userId === actor.id && r.emoji === emoji),
      );
      if (active) message.reactions.push({ userId: actor.id, emoji });
      return message;
    });
  }
  async read(id: string, actor: Actor, seq: number) {
    return this.change(id, actor, (room) => {
      const member = requireMember(room, actor);
      member.readSeq = Math.max(
        member.readSeq,
        Math.min(seq, room.messages.at(-1)?.seq ?? 0),
      );
      return { readSeq: member.readSeq };
    });
  }
  async draft(id: string, actor: Actor, raw: unknown, expenseId?: string) {
    const input = expenseInput.parse(raw);
    return this.change(id, actor, (room) => {
      validateShares(input, room);
      if (expenseId) {
        const expense =
          room.expenses.find((e) => e.id === expenseId) ??
          fail(404, "Expense not found");
        if (expense.creatorId !== actor.id)
          fail(403, "Only the author can edit this draft");
        if (expense.status !== "draft")
          fail(409, "Confirmed expenses cannot be edited");
        Object.assign(expense, {
          version: expense.version + 1,
          description: input.description,
          payerId: input.payerId,
          totalCents: input.totalCents,
          shares: input.shares,
        });
        if (input.attachmentId) expense.attachmentId = input.attachmentId;
        else delete expense.attachmentId;
        return expense;
      }
      const existing = room.expenses.find(
        (e) => e.clientId === input.clientId && e.creatorId === actor.id,
      );
      if (existing) {
        if (
          !same(
            {
              description: existing.description,
              payerId: existing.payerId,
              totalCents: existing.totalCents,
              shares: existing.shares,
              attachmentId: existing.attachmentId,
            },
            {
              description: input.description,
              payerId: input.payerId,
              totalCents: input.totalCents,
              shares: input.shares,
              attachmentId: input.attachmentId,
            },
          )
        )
          fail(
            409,
            "Retry ID was already used for a different expense. Review the saved draft before editing.",
          );
        return existing;
      }
      if (room.expenses.length >= 200)
        fail(422, "This beta room has reached its expense limit");
      const expense: Expense = {
        ...input,
        id: randomUUID(),
        creatorId: actor.id,
        status: "draft",
        version: 1,
        createdAt: this.now(),
        flags: [],
      };
      room.expenses.push(expense);
      return expense;
    });
  }
  async confirm(
    id: string,
    actor: Actor,
    expenseId: string,
    requestId: string,
    expectedVersion: number,
  ) {
    retryId.parse(requestId);
    return this.change(id, actor, (room) => {
      const expense =
        room.expenses.find((e) => e.id === expenseId) ??
        fail(404, "Expense not found");
      if (expense.creatorId !== actor.id)
        fail(403, "Only the author can confirm this expense");
      if (expense.status === "confirmed") {
        if (expense.confirmationId !== requestId)
          fail(409, "Expense is already confirmed");
        return expense;
      }
      if (expense.version !== expectedVersion)
        fail(
          409,
          "The draft changed. Review the latest version before confirming.",
        );
      validateShares(expense, room);
      const confirmed: Expense = {
        ...expense,
        status: "confirmed",
        confirmedAt: this.now(),
        confirmationId: requestId,
        obligations: expense.shares
          .filter((s) => s.userId !== expense.payerId && s.cents > 0)
          .map((s) => ({
            id: randomUUID(),
            expenseId: expense.id,
            debtorId: s.userId,
            creditorId: expense.payerId,
            cents: s.cents,
            currency: "USD",
            status: "outstanding",
          })),
      };
      room.expenses = room.expenses.map((e) =>
        e.id === expenseId ? confirmed : e,
      );
      return confirmed;
    });
  }
  async flag(id: string, actor: Actor, expenseId: string, reason: string) {
    return this.change(id, actor, (room) => {
      const expense =
        room.expenses.find((e) => e.id === expenseId) ??
        fail(404, "Expense not found");
      if (
        expense.status !== "confirmed" ||
        !expense.shares.some((s) => s.userId === actor.id)
      )
        fail(403, "Only a participant can flag a confirmed share");
      expense.flags = expense.flags.filter((f) => f.userId !== actor.id);
      expense.flags.push({ userId: actor.id, reason });
      return expense;
    });
  }
}
