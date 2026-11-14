import { canDeleteSplit } from "./model";
import { answersTabQuestion, repliesToTab, defaultAssistance, directlyAddressesTab } from "./agent/awareness-schema";
import { TAB_BOT_ID, mentionsTab } from "./agent/model";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  Actor,
  OutsideReport,
  Room,
  Invitation,
  Preview,
  Message,
  Expense,
  DinnerError,
  fail,
  usd,
  requireMember,
  roomView,
  invitationStatus,
  roomInput,
  inviteInput,
  messageInput,
  expenseInput,
  validateShares,
  retryId,
  correctionInput,
  validateCorrectionShares,
  Obligation,
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
  private actionMessage(room: Room, actor: Actor, key: string, text: string) {
    const runId = `action:${key}`;
    if (room.messages.some(m => m.kind === "tab" && m.runId === runId)) return;
    if (room.messages.length >= 1000) fail(422, "This room has reached its message limit. History is preserved.");
    room.messages.push({ id: randomUUID(), clientId: runId, kind: "tab", authorId: TAB_BOT_ID,
      requestedBy: actor.id, runId, text, expectsReply: false, replyTo: null, attachmentIds: [],
      createdAt: this.now(), seq: (room.messages.at(-1)?.seq ?? 0) + 1, reactions: [] });
  }
  private memberName(room: Room, id: string) {
    return room.members.find(m => m.userId === id)?.name ?? room.removals?.find(m => m.userId === id)?.name ?? "Member";
  }

  constructor(
    private store: RoomStore,
    private now: () => string = () => new Date().toISOString(),
  ) {}
  async memberRoom(id: string, actor: Actor): Promise<Room> {
    const room = (await this.store.get(id)) ?? fail(404, "Room not found");
    requireMember(room, actor);
    room.assistance ??= defaultAssistance();
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
        assistance: defaultAssistance(),
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
  async removeMember(
    id: string,
    actor: Actor,
    userId: string,
    clientId: string,
  ) {
    retryId.parse(clientId);
    return this.change(id, actor, (room) => {
      if (room.ownerId !== actor.id)
        fail(403, "Only the room owner can remove a member");
      const previous = room.removals?.find(
        (r) => r.clientId === clientId && r.removedBy === actor.id,
      );
      if (previous) {
        if (previous.userId !== userId) fail(409, "Removal retry changed");
        return previous;
      }
      if (userId === room.ownerId)
        fail(409, "The room owner cannot be removed or transferred here");
      const member =
        room.members.find((m) => m.userId === userId) ??
        fail(404, "Accepted member not found");
      if ((room.removals?.length ?? 0) >= 100)
        fail(422, "Membership history limit reached");
      const event = {
        id: randomUUID(),
        clientId,
        userId,
        name: member.name,
        joinedAt: member.joinedAt,
        removedAt: this.now(),
        removedBy: actor.id,
      };
      room.removals = [...(room.removals ?? []), event];
      room.members = room.members.filter((m) => m.userId !== userId);
      return event;
    });
  }
  // Used only for personal money projections, never as authorization to read a room.
  async financialRooms(actor: Actor) {
    return (await this.store.list(actor.id, null))
      .filter(
        (r) =>
          r.members.some((m) => m.userId === actor.id) ||
          r.removals?.some((m) => m.userId === actor.id),
      )
      .map(roomView);
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
      accountBound: invite.targetSubject !== null,
      expiresAt: invite.expiresAt,
    };
  }
  async inviteAccount(token: string, actor: Actor) {
    const preview = await this.preview(token);
    const room =
      (await this.store.byToken(tokenHash(token))) ??
      fail(404, "Invitation not found");
    const invite =
      room.invitations.find((i) => i.tokenHash === tokenHash(token)) ??
      fail(404, "Invitation not found");
    if (preview.status === "accepted" || preview.status === "declined")
      return {
        canRespond: invite.resolvedBy === actor.id,
        reason: invite.resolvedBy === actor.id ? null : "resolved_by_another",
      };
    if (preview.status !== "pending")
      return { canRespond: false, reason: "unavailable" };
    if (invite.targetSubject && invite.targetSubject !== actor.twitterSubject)
      return { canRespond: false, reason: "different_account" };
    return {
      canRespond: preview.status === "pending",
      reason: preview.status === "pending" ? null : "unavailable",
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
      if (invite.status === decision && invite.resolvedBy === actor.id)
        return { roomId: room.id, status: decision };
      if (invite.targetSubject && invite.targetSubject !== actor.twitterSubject)
        fail(
          403,
          "This invitation is for a different X account. Sign out and sign in with the invited X account; this link will stay here.",
        );
      if (invitationStatus(invite, this.now()) !== "pending")
        fail(409, "This invitation is no longer pending");
      if (
        decision === "accepted" &&
        room.removals?.some(
          (m) => m.userId === actor.id && invite.createdAt <= m.removedAt,
        )
      )
        fail(409, "Ask the room owner for a new invitation after removal");
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
  async setAssistance(id: string, actor: Actor, mode: "mentions" | "smart") {
    return this.change(id, actor, (room) => {
      if (room.ownerId !== actor.id) fail(403, "Only the room owner can change Smart assistance");
      room.assistance = { mode, checkedSeq: room.messages.at(-1)?.seq ?? 0, offeredTopics: room.assistance?.offeredTopics ?? [], authorized: [], ...(room.assistance?.offer ? { offer: { ...room.assistance.offer, status: "expired" as const } } : {}) };
      return roomView(room);
    });
  }
  async botReply(id: string, requester: Actor, sourceId: string, text: string, expectsReply = text.includes("?"), publication?: { revision: string; validate: (room: Room) => void }) {
    return this.change(id, requester, (room) => {
      const source = room.messages.find(
        (m) =>
          m.id === sourceId && m.authorId === requester.id && m.kind !== "tab",
      );
      if (!source || !(mentionsTab(source.text) || directlyAddressesTab(source.text) || (repliesToTab(room.messages, source.replyTo) || answersTabQuestion(room.messages, source)) || (room.assistance?.mode === "smart" && room.assistance.authorized.includes(source.id))))
        fail(
          403,
          "Only an addressed, persisted member message can request Tab",
        );
      const previous = room.messages.find(
        (m) => m.kind === "tab" && m.runId === sourceId,
      );
      if (previous) return previous;
      publication?.validate(room);
      if (room.messages.length >= 1000)
        fail(
          422,
          "This beta room has reached its message limit. History is preserved.",
        );
      const message: Message = {
        id: randomUUID(),
        authorId: TAB_BOT_ID,
        clientId: sourceId,
        kind: "tab",
        requestedBy: requester.id,
        expectsReply,
        runId: sourceId,
        ...(publication ? { agentRevision: publication.revision } : {}),
        text,
        replyTo: sourceId,
        attachmentIds: [],
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
  async draft(id: string, actor: Actor, raw: unknown, expenseId?: string, expectedVersion?: number, sourcePlanId?: string) {
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
        if (expectedVersion !== undefined && expense.version !== expectedVersion)
          fail(409, "The draft changed. Reload the latest bill before saving.");
        Object.assign(expense, {
          version: expense.version + 1,
          description: input.description,
          payerId: input.payerId,
          totalCents: input.totalCents,
          shares: input.shares,
        });
        if (input.attachmentId) expense.attachmentId = input.attachmentId;
        else delete expense.attachmentId;
        this.actionMessage(room, actor, `bill-edited:${expense.id}:${expense.version}`, `${this.memberName(room, actor.id)} edited “${expense.description}” · ${usd(expense.totalCents)}.`);
        return expense;
      }
      if (sourcePlanId) {
        const linked = room.expenses.find(
          (e) => e.sourcePlanId === sourcePlanId,
        );
        if (
          linked &&
          (linked.creatorId !== actor.id || linked.clientId !== input.clientId)
        )
          fail(
            409,
            "This outing already has an expense. Open Money to review it.",
          );
      }
      const existing = room.expenses.find(
        (e) => e.clientId === input.clientId && e.creatorId === actor.id,
      );
      if (existing) {
        if (sourcePlanId && existing.sourcePlanId !== sourcePlanId)
          fail(409, "Retry ID belongs to another expense");
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
        ...(sourcePlanId ? { sourcePlanId } : {}),
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
  async deleteSplit(id: string, actor: Actor, expenseId: string, requestId: string, expectedVersion: number) {
    retryId.parse(requestId);
    return this.change(id, actor, room => {
      const expense = room.expenses.find(e => e.id === expenseId) ?? fail(404, "Bill not found");
      if (expense.creatorId !== actor.id) fail(403, "Only the bill creator can delete this split");
      if (expense.status === "cancelled" && expense.deletedAt) return expense;
      if (expense.version !== expectedVersion) fail(409, "The bill changed. Reload it before deleting.");
      if (!canDeleteSplit(expense)) fail(409, "Only unpaid confirmed splits can be deleted. Resolve any pending payment report first; splits with recorded payments cannot be deleted.");
      // Keep the original record for audit. Cancelled records contribute no obligations.
      const deleted: Expense = { ...expense, status: "cancelled", deletedAt: this.now(),
        cancelledAt: this.now(), cancelledBy: actor.id, cancellationId: requestId, version: expense.version + 1 };
      room.expenses = room.expenses.map(e => e.id === expenseId ? deleted : e);
      this.actionMessage(room, actor, `bill-deleted:${expense.id}`, `${this.memberName(room, actor.id)} deleted “${expense.description}”.`);
      return deleted;
    });
  }
  async cancelDraft(id: string, actor: Actor, expenseId: string, requestId: string, expectedVersion: number) {
    retryId.parse(requestId);
    return this.change(id, actor, (room) => {
      const expense = room.expenses.find((e) => e.id === expenseId) ?? fail(404, "Bill not found");
      if (expense.creatorId !== actor.id) fail(403, "Only the author can cancel this draft");
      if (expense.status === "cancelled") return expense;
      if (expense.status !== "draft") fail(409, "Confirmed bills cannot be cancelled. Propose a correction instead.");
      if (expense.version !== expectedVersion) fail(409, "The draft changed. Reload the bill before cancelling.");
      const cancelled: Expense = { ...expense, status: "cancelled", version: expense.version + 1,
        cancelledAt: this.now(), cancelledBy: actor.id, cancellationId: requestId };
      room.expenses = room.expenses.map((e) => e.id === expenseId ? cancelled : e);
      this.actionMessage(room, actor, `bill-cancelled:${expense.id}`, `${this.memberName(room, actor.id)} cancelled “${expense.description}”.`);
      return cancelled;
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
      if (expense.status === "cancelled") fail(409, "This bill was cancelled");
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
      this.actionMessage(room, actor, `bill-confirmed:${expense.id}`, `${this.memberName(room, actor.id)} confirmed “${expense.description}” · ${usd(expense.totalCents)}.`);
      return confirmed;
    });
  }
  async proposeCorrection(
    id: string,
    actor: Actor,
    expenseId: string,
    raw: unknown,
  ) {
    const input = correctionInput.parse(raw);
    return this.change(id, actor, (room) => {
      const expense = room.expenses.find((e) => e.id === expenseId);
      if (!expense || expense.status !== "confirmed")
        return fail(404, "Confirmed expense not found");
      const { clientId, expectedVersion, ...fields } = input;
      const previous = expense.corrections?.find(
        (c) => c.clientId === clientId && c.proposedBy === actor.id,
      );
      if (previous) {
        if (
          !same(previous.fields, fields) ||
          previous.expectedVersion !== expectedVersion
        )
          fail(409, "Correction retry changed");
        return previous;
      }
      if (expense.version !== expectedVersion)
        fail(409, "Expense changed. Review its current version");
      validateCorrectionShares({ ...fields, clientId }, room, expense);
      if ((expense.corrections?.length ?? 0) >= 50)
        fail(422, "Correction history limit reached");
      const correction = {
        id: randomUUID(),
        clientId,
        expectedVersion,
        fields,
        proposedBy: actor.id,
        createdAt: this.now(),
        status: "proposed" as const,
        flags: [],
      };
      expense.corrections = [...(expense.corrections ?? []), correction];
      return correction;
    });
  }
  async disputeCorrection(
    id: string,
    actor: Actor,
    expenseId: string,
    correctionId: string,
    reason: string,
  ) {
    return this.change(id, actor, (room) => {
      const expense = room.expenses.find((e) => e.id === expenseId);
      if (!expense || expense.status !== "confirmed")
        return fail(404, "Expense not found");
      const correction =
        expense.corrections?.find((c) => c.id === correctionId) ??
        fail(404, "Correction not found");
      if (
        ![
          expense.payerId,
          correction.fields.payerId,
          ...expense.shares.map((s) => s.userId),
          ...correction.fields.shares.map((s) => s.userId),
        ].includes(actor.id)
      )
        fail(403, "Only an affected participant can dispute this correction");
      if (correction.status === "applied")
        fail(409, "Already applied. Flag the current share instead");
      correction.status = "disputed";
      correction.flags = [
        ...correction.flags.filter((f) => f.userId !== actor.id),
        { userId: actor.id, reason },
      ];
      return correction;
    });
  }
  async confirmCorrection(
    id: string,
    actor: Actor,
    expenseId: string,
    correctionId: string,
    clientId: string,
  ) {
    retryId.parse(clientId);
    return this.change(id, actor, (room) => {
      const expense = room.expenses.find((e) => e.id === expenseId);
      if (!expense || expense.status !== "confirmed")
        return fail(404, "Expense not found");
      if (![expense.creatorId, room.ownerId].includes(actor.id))
        fail(
          403,
          "Only the expense author or room owner can accept a correction",
        );
      const correction =
        expense.corrections?.find((c) => c.id === correctionId) ??
        fail(404, "Correction not found");
      if (correction.status === "applied") {
        if (
          correction.confirmationId === clientId &&
          correction.appliedBy === actor.id
        )
          return expense;
        fail(409, "Correction already applied");
      }
      if (correction.status === "disputed")
        fail(
          409,
          "Disputed correction cannot be applied. Prepare a new proposal after clarification",
        );
      if (correction.expectedVersion !== expense.version)
        fail(
          409,
          "Expense changed. Prepare a correction against its current version",
        );
      validateCorrectionShares(
        { ...correction.fields, clientId },
        room,
        expense,
      );
      if (
        expense.obligations.some((o) =>
          o.outsideReports?.some((r) => r.status === "pending"),
        )
      )
        fail(
          409,
          "Resolve or cancel pending outside reports before accepting a correction",
        );
      const at = this.now();
      const history = expense.history ?? [];
      // Deduplicate settled obligations across snapshots. Credits stay real even if a share is reduced;
      // a negative remainder becomes an obligation back to the person who overpaid, never a refund payment.
      const paid = new Map<string, Obligation>();
      for (const o of [
        ...history.flatMap((h) => h.obligations),
        ...expense.obligations,
      ])
        if (o.status === "confirmed_outside") paid.set(o.id, o);
      const net = new Map<string, { a: string; b: string; cents: number }>();
      const add = (from: string, to: string, cents: number) => {
        const [a, b] = [from, to].sort();
        const key = `${a}:${b}`;
        const row = net.get(key) ?? { a, b, cents: 0 };
        row.cents += from === a ? cents : -cents;
        net.set(key, row);
      };
      for (const share of correction.fields.shares)
        if (share.userId !== correction.fields.payerId)
          add(share.userId, correction.fields.payerId, share.cents);
      for (const o of paid.values()) add(o.debtorId, o.creditorId, -o.cents);
      const next: Obligation[] = [...net.values()]
        .filter((n) => n.cents !== 0)
        .map((n) => ({
          id: randomUUID(),
          expenseId,
          debtorId: n.cents > 0 ? n.a : n.b,
          creditorId: n.cents > 0 ? n.b : n.a,
          cents: Math.abs(n.cents),
          currency: "USD",
          status: "outstanding",
        }));
      if (next.some((o) => o.cents > 100_000_000))
        fail(
          422,
          "Adjustment exceeds the beta amount limit; history is preserved",
        );
      expense.history = [
        ...history,
        {
          description: expense.description,
          payerId: expense.payerId,
          totalCents: expense.totalCents,
          shares: expense.shares,
          ...(expense.attachmentId
            ? { attachmentId: expense.attachmentId }
            : {}),
          version: expense.version,
          confirmedAt: expense.confirmedAt,
          confirmationId: expense.confirmationId,
          flags: expense.flags,
          obligations: expense.obligations,
          reversedAt: at,
          reversedBy: actor.id,
          correctionId,
        },
      ];
      delete expense.attachmentId;
      Object.assign(expense, correction.fields, {
        version: expense.version + 1,
        obligations: next,
        confirmedAt: at,
        confirmationId: clientId,
      });
      correction.status = "applied";
      correction.appliedAt = at;
      correction.appliedBy = actor.id;
      correction.confirmationId = clientId;
      return expense;
    });
  }
  async reportOutside(
    id: string,
    actor: Actor,
    obligationId: string,
    clientId: string,
  ) {
    retryId.parse(clientId);
    return this.change(id, actor, (room) => {
      const expense = room.expenses.find(
        (e) =>
          e.status === "confirmed" &&
          e.obligations.some((o) => o.id === obligationId),
      );
      if (!expense || expense.status !== "confirmed")
        return fail(404, "Obligation not found");
      const obligation =
        expense.obligations.find((o) => o.id === obligationId) ??
        fail(404, "Obligation not found");
      if (actor.id !== obligation.debtorId && actor.id !== expense.creatorId)
        fail(
          403,
          "Only the debtor or expense author can report an outside payment",
        );
      const reports = obligation.outsideReports ?? [];
      const previous = reports.find(
        (r) => r.clientId === clientId && r.reportedBy === actor.id,
      );
      if (previous) return previous;
      if (obligation.status !== "outstanding")
        fail(409, "The recipient already confirmed receipt outside Tab");
      if (reports.some((r) => r.status === "pending"))
        fail(409, "An outside report is already awaiting the recipient");
      if (reports.length >= 50)
        fail(
          422,
          "This obligation has reached its beta report limit. History is preserved.",
        );
      const report: OutsideReport = {
        id: randomUUID(),
        clientId,
        reportedBy: actor.id,
        cents: obligation.cents,
        createdAt: this.now(),
        status: "pending",
      };
      obligation.outsideReports = [...reports, report];
      this.actionMessage(room, actor, `payment-reported:${report.id}`, `${this.memberName(room, actor.id)} reported an outside payment of ${usd(report.cents)} from ${this.memberName(room, obligation.debtorId)} to ${this.memberName(room, obligation.creditorId)} for “${expense.description}”. Awaiting recipient confirmation.`);
      return report;
    });
  }
  async resolveOutside(
    id: string,
    actor: Actor,
    obligationId: string,
    reportId: string,
    decision: "confirmed" | "rejected" | "cancelled",
    clientId: string,
  ) {
    retryId.parse(clientId);
    return this.change(id, actor, (room) => {
      const expense = room.expenses.find(
        (e) =>
          e.status === "confirmed" &&
          e.obligations.some((o) => o.id === obligationId),
      );
      if (!expense || expense.status !== "confirmed")
        return fail(404, "Obligation not found");
      const obligation =
        expense.obligations.find((o) => o.id === obligationId) ??
        fail(404, "Obligation not found");
      const report =
        obligation.outsideReports?.find((r) => r.id === reportId) ??
        fail(404, "Outside report not found");
      if (
        decision === "cancelled"
          ? actor.id !== report.reportedBy
          : actor.id !== obligation.creditorId
      )
        fail(
          403,
          decision === "cancelled"
            ? "Only the reporter can cancel this report"
            : "Only the recipient can confirm or reject this report",
        );
      if (report.status !== "pending") {
        if (
          report.status === decision &&
          report.resolvedBy === actor.id &&
          report.resolutionId === clientId
        )
          return report;
        return fail(
          409,
          "This report was already resolved. Refresh to see its current state.",
        );
      }
      if (obligation.status !== "outstanding")
        fail(409, "This obligation is already closed");
      const resolved: OutsideReport = {
        ...report,
        status: decision,
        resolvedBy: actor.id,
        resolutionId: clientId,
        resolvedAt: this.now(),
      };
      obligation.outsideReports = (obligation.outsideReports ?? []).map((r) =>
        r.id === reportId ? resolved : r,
      );
      if (decision === "confirmed") {
        expense.obligations = expense.obligations.map((o) =>
          o.id === obligationId
            ? {
                ...o,
                status: "confirmed_outside",
                confirmedReportId: report.id,
              }
            : o,
        );
      }
      this.actionMessage(room, actor, `payment-resolved:${report.id}`, decision === "confirmed"
        ? `${this.memberName(room, actor.id)} confirmed receiving ${usd(report.cents)} from ${this.memberName(room, obligation.debtorId)} for “${expense.description}”. This share is settled outside Tab.`
        : `${this.memberName(room, actor.id)} ${decision} the ${usd(report.cents)} payment report for “${expense.description}”.`);
      // Flags are independent, durable dispute records. Never clear them here.
      return resolved;
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
