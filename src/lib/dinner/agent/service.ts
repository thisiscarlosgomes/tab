import { Db, MongoServerError } from "mongodb";
import { randomUUID } from "node:crypto";
import {
  Actor,
  RoomView,
  fail,
  roomView,
  totals,
  obligations,
  validateShares,
} from "../model";
import { DinnerService } from "../service";
import { pendingOutside } from "../projections";
import {
  Note,
  Turn,
  Proposal,
  Reminder,
  personalMessageInput,
  noteInput,
  reminderInput,
  prepareInput,
  mentionsTab,
} from "./model";
import { AgentRunner, AgentScope, AgentContext } from "./capabilities";
import { runTabAgent } from "./runtime";

type Session = { userId: string; messages: Turn[] };
type StoredNote = Note & { key: string; lastClientId: string };
type Run = {
  key: string;
  userId: string;
  scope: AgentScope;
  status: "running" | "complete" | "failed";
  lease: string;
  until: string;
  tools: { name: string; scope: string; outcome: string }[];
};
export function walletProjection(rooms: RoomView[], userId: string) {
  const balances = rooms.map((room) => ({
    roomId: room.id,
    name: room.name,
    ...totals(room, userId),
  }));
  return {
    availableUsdCents: null,
    availableLabel: "No spendable USD balance is connected to Rooms beta",
    owe: balances.reduce((n, r) => n + r.owe, 0),
    owed: balances.reduce((n, r) => n + r.owed, 0),
    balances,
    pending: pendingOutside(rooms, userId),
  };
}
export class DinnerAgentService {
  private readiness?: Promise<unknown>;
  constructor(
    private db: Db,
    private dinner: DinnerService,
    private runner: AgentRunner = runTabAgent,
  ) {}
  private get ready() {
    return (this.readiness ??= Promise.all([
      this.db
        .collection<Session>("dinner-agent-sessions")
        .createIndex({ userId: 1 }, { unique: true }),
      this.db
        .collection<StoredNote>("dinner-agent-notes")
        .createIndex({ key: 1 }, { unique: true }),
      this.db
        .collection<Run>("dinner-agent-runs")
        .createIndex({ key: 1 }, { unique: true }),
      this.db
        .collection<Proposal>("dinner-agent-proposals")
        .createIndex({ runKey: 1 }, { unique: true }),
      this.db
        .collection<Reminder>("dinner-reminders")
        .createIndex({ userId: 1, clientId: 1 }, { unique: true }),
    ]));
  }
  async wallet(actor: Actor) {
    const { rooms } = await this.dinner.list(actor);
    return walletProjection(rooms, actor.id);
  }
  async session(actor: Actor) {
    await this.ready;
    const session = await this.db
      .collection<Session>("dinner-agent-sessions")
      .findOne({ userId: actor.id });
    const proposals = await this.db
      .collection<Proposal>("dinner-agent-proposals")
      .find({ userId: actor.id }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return { messages: session?.messages ?? [], proposals };
  }
  async personalSend(actor: Actor, raw: unknown) {
    await this.ready;
    const input = personalMessageInput.parse(raw);
    const collection = this.db.collection<Session>("dinner-agent-sessions");
    try {
      await collection.updateOne(
        { userId: actor.id },
        { $setOnInsert: { userId: actor.id, messages: [] } },
        { upsert: true },
      );
    } catch (e) {
      if (!(e instanceof MongoServerError) || e.code !== 11000) throw e;
    }
    const current =
      (await collection.findOne({ userId: actor.id })) ??
      fail(503, "Could not open your agent conversation");
    const previous = current.messages.find(
      (m) => m.role === "user" && m.clientId === input.clientId,
    );
    if (previous) {
      if (previous.text !== input.text)
        fail(409, "Retry ID already used for different text");
      return previous;
    }
    if (current.messages.length >= 400)
      fail(
        422,
        "This beta conversation has reached its history limit; history is preserved",
      );
    const message: Turn = {
      id: randomUUID(),
      clientId: input.clientId,
      role: "user",
      text: input.text,
      createdAt: new Date().toISOString(),
      replyTo: null,
    };
    await collection.updateOne(
      {
        userId: actor.id,
        messages: {
          $not: { $elemMatch: { role: "user", clientId: input.clientId } },
        },
        $expr: { $lt: [{ $size: "$messages" }, 400] },
      },
      { $push: { messages: message } },
    );
    const saved =
      (await collection.findOne({ userId: actor.id }))?.messages.find(
        (m) => m.role === "user" && m.clientId === input.clientId,
      ) ?? fail(409, "Conversation is busy. Retry the same message");
    if (saved.text !== input.text)
      fail(409, "Retry ID already used for different text");
    return saved;
  }
  private async scopeRoom(actor: Actor, scope: AgentScope, roomId: string) {
    if (scope.kind === "room" && scope.roomId !== roomId)
      fail(403, "A room agent cannot access a different room");
    return this.dinner.memberRoom(roomId, actor);
  }
  private roomFacts(room: RoomView) {
    return {
      id: room.id,
      name: room.name,
      purpose: room.purpose,
      members: room.members.map(({ userId, name }) => ({ userId, name })),
      expenses: room.expenses.slice(-10),
      obligations: obligations(room),
      notice:
        "Shared obligations, not cash. Outside reports remain outstanding until creditor confirmation in Money.",
    };
  }
  async note(actor: Actor, scope: AgentScope, kind: "memory" | "agreements") {
    await this.ready;
    if (scope.kind === "room")
      await this.dinner.memberRoom(scope.roomId, actor);
    else if (kind !== "memory") fail(400, "Agreements belong to rooms");
    const key = `${scope.kind === "room" ? `room:${scope.roomId}` : `user:${actor.id}`}:${kind}`;
    const value = await this.db
      .collection<StoredNote>("dinner-agent-notes")
      .findOne({ key }, { projection: { _id: 0 } });
    return {
      key,
      value: value ?? {
        key,
        text: "",
        version: 0,
        updatedBy: actor.id,
        updatedAt: new Date().toISOString(),
        lastClientId: "",
        history: [],
      },
    };
  }
  async saveNote(
    actor: Actor,
    scope: AgentScope,
    kind: "memory" | "agreements",
    raw: unknown,
  ) {
    const input = noteInput.parse(raw);
    const { key, value } = await this.note(actor, scope, kind);
    if (value.lastClientId === input.clientId) {
      if (value.text !== input.text) fail(409, "Retry content changed");
      return value;
    }
    if (value.version !== input.expectedVersion)
      fail(
        409,
        "Notes changed. Refresh before saving; your text has not overwritten them.",
      );
    const next: StoredNote = {
      key,
      text: input.text,
      version: value.version + 1,
      updatedBy: actor.id,
      updatedAt: new Date().toISOString(),
      lastClientId: input.clientId,
      history:
        kind === "agreements"
          ? [
              ...value.history,
              {
                text: value.text,
                version: value.version,
                updatedBy: value.updatedBy,
                updatedAt: value.updatedAt,
              },
            ].slice(-20)
          : [],
    };
    const collection = this.db.collection<StoredNote>("dinner-agent-notes");
    if (value.version === 0) {
      try {
        await collection.insertOne(next);
      } catch (e) {
        if (e instanceof MongoServerError && e.code === 11000)
          fail(409, "Notes changed. Refresh before saving.");
        throw e;
      }
    } else if (
      !(
        await collection.replaceOne(
          { key, version: input.expectedVersion },
          next,
        )
      ).matchedCount
    )
      fail(409, "Notes changed. Refresh before saving.");
    return next;
  }
  async reminders(actor: Actor) {
    await this.ready;
    return this.db
      .collection<Reminder>("dinner-reminders")
      .find({ userId: actor.id, dismissed: false }, { projection: { _id: 0 } })
      .sort({ dueAt: 1 })
      .limit(100)
      .toArray();
  }
  async remind(actor: Actor, raw: unknown): Promise<Reminder> {
    await this.ready;
    const input = reminderInput.parse(raw);
    await this.dinner.memberRoom(input.roomId, actor);
    const collection = this.db.collection<Reminder>("dinner-reminders");
    const existing = await collection.findOne({
      userId: actor.id,
      clientId: input.clientId,
    });
    if (existing) {
      if (
        existing.text !== input.text ||
        existing.dueAt !== input.dueAt ||
        existing.roomId !== input.roomId
      )
        fail(409, "Reminder retry changed");
      return existing;
    }
    if (Date.parse(input.dueAt) <= Date.now())
      fail(400, "Choose a future reminder time");
    if (
      (await collection.countDocuments({
        userId: actor.id,
        dismissed: false,
      })) >= 100
    )
      fail(422, "Dismiss an existing reminder before adding more");
    const reminder: Reminder = {
      ...input,
      id: randomUUID(),
      userId: actor.id,
      dismissed: false,
      createdAt: new Date().toISOString(),
    };
    try {
      await collection.insertOne({ ...reminder });
    } catch (e) {
      if (!(e instanceof MongoServerError) || e.code !== 11000) throw e;
      return this.remind(actor, raw);
    }
    return reminder;
  }
  async dismiss(actor: Actor, id: string) {
    await this.ready;
    const result = await this.db
      .collection<Reminder>("dinner-reminders")
      .findOneAndUpdate(
        { id, userId: actor.id },
        { $set: { dismissed: true } },
        { returnDocument: "after", projection: { _id: 0 } },
      );
    return result ?? fail(404, "Reminder not found");
  }
  async roomProposals(actor: Actor, roomId: string) {
    await this.ready;
    await this.dinner.memberRoom(roomId, actor);
    return this.db
      .collection<Proposal>("dinner-agent-proposals")
      .find({ roomId, visibility: "room" }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
  }
  async applyProposal(actor: Actor, id: string) {
    await this.ready;
    const collection = this.db.collection<Proposal>("dinner-agent-proposals");
    const proposal =
      (await collection.findOne({ id, userId: actor.id })) ??
      fail(404, "Proposal not found");
    const room = await this.dinner.memberRoom(proposal.roomId, actor);
    if (proposal.appliedExpenseId)
      return (
        room.expenses.find((e) => e.id === proposal.appliedExpenseId) ??
        fail(404, "Saved draft not found")
      );
    const expense = await this.dinner.draft(room.id, actor, {
      ...proposal.fields,
      clientId: proposal.id,
    });
    await collection.updateOne(
      { id, userId: actor.id },
      { $set: { appliedExpenseId: expense.id } },
    );
    return expense;
  }
  private async prepare(
    actor: Actor,
    scope: AgentScope,
    runKey: string,
    raw: unknown,
  ): Promise<Proposal> {
    const input = prepareInput.parse(raw);
    const room = await this.scopeRoom(actor, scope, input.roomId);
    const { roomId, ...fields } = input;
    validateShares({ ...fields, clientId: randomUUID() }, room);
    const collection = this.db.collection<Proposal>("dinner-agent-proposals");
    const previous = await collection.findOne(
      { runKey },
      { projection: { _id: 0 } },
    );
    if (previous) return previous;
    const proposal: Proposal = {
      id: randomUUID(),
      userId: actor.id,
      roomId,
      runKey,
      visibility: scope.kind,
      members: room.members.map(({ userId, name }) => ({ userId, name })),
      createdAt: new Date().toISOString(),
      fields,
      appliedExpenseId: null,
    };
    try {
      await collection.insertOne({ ...proposal });
    } catch (e) {
      if (!(e instanceof MongoServerError) || e.code !== 11000) throw e;
      return this.prepare(actor, scope, runKey, raw);
    }
    return proposal;
  }
  async respond(actor: Actor, scope: AgentScope, sourceId: string) {
    await this.ready;
    let conversation: AgentContext["conversation"];
    if (scope.kind === "room") {
      const room = await this.dinner.memberRoom(scope.roomId, actor);
      const source =
        room.messages.find(
          (m) =>
            m.id === sourceId && m.authorId === actor.id && m.kind !== "tab",
        ) ?? fail(404, "Your addressed message was not found");
      if (!mentionsTab(source.text))
        fail(400, "Tab replies only to an explicit @Tab mention");
      const existing = room.messages.find(
        (m) => m.kind === "tab" && m.runId === sourceId,
      );
      if (existing) return { status: "complete", text: existing.text };
      conversation = room.messages
        .filter((m) => m.seq <= source.seq)
        .slice(-25)
        .map((m) => ({
          role: m.kind === "tab" ? "assistant" : "user",
          content:
            m.kind === "tab"
              ? m.text
              : `${room.members.find((member) => member.userId === m.authorId)?.name ?? "Member"}: ${m.text}`,
        }));
    } else {
      const session = await this.session(actor);
      const source =
        session.messages.find((m) => m.id === sourceId && m.role === "user") ??
        fail(404, "Your message was not found");
      const existing = session.messages.find(
        (m) => m.role === "assistant" && m.replyTo === sourceId,
      );
      if (existing) return { status: "complete", text: existing.text };
      conversation = session.messages
        .slice(0, session.messages.indexOf(source) + 1)
        .slice(-25)
        .map((m) => ({ role: m.role, content: m.text }));
    }
    const key = `${scope.kind === "room" ? `room:${scope.roomId}` : `user:${actor.id}`}:${sourceId}`;
    const runs = this.db.collection<Run>("dinner-agent-runs");
    const lease = randomUUID();
    const now = new Date().toISOString();
    const value: Run = {
      key,
      userId: actor.id,
      scope,
      status: "running",
      lease,
      until: new Date(Date.now() + 70_000).toISOString(),
      tools: [],
    };
    let claimed = false;
    try {
      await runs.insertOne({ ...value });
      claimed = true;
    } catch (e) {
      if (!(e instanceof MongoServerError) || e.code !== 11000) throw e;
    }
    if (!claimed) {
      const result = await runs.findOneAndUpdate(
        {
          key,
          $or: [
            { status: "failed" },
            { status: "running", until: { $lt: now } },
          ],
        },
        { $set: { status: "running", lease, until: value.until } },
      );
      if (!result)
        return {
          status: "running",
          text: "Tab is already preparing a reply. Refresh shortly; the saved message is safe.",
        };
    }
    const active = async () => {
      if (!(await runs.findOne({ key, lease, status: "running" })))
        fail(409, "Agent run was superseded. Refresh safely.");
    };
    try {
      const memory = (await this.note(actor, scope, "memory")).value.text;
      const agreements =
        scope.kind === "room"
          ? (await this.note(actor, scope, "agreements")).value.text
          : "";
      const readRoom = async (roomId: string) => {
        await active();
        return this.roomFacts(
          roomView(await this.scopeRoom(actor, scope, roomId)),
        );
      };
      const context: AgentContext = {
        scope,
        conversation,
        memory,
        agreements,
        readRoom,
        readContext: async () => {
          await active();
          if (scope.kind === "room") return readRoom(scope.roomId);
          const { rooms } = await this.dinner.list(actor);
          return {
            rooms: rooms.map((r) => ({
              id: r.id,
              name: r.name,
              ...totals(r, actor.id),
            })),
            pendingOutside: pendingOutside(rooms, actor.id),
            notice:
              "Your obligations only, not available cash. No connected financial execution.",
          };
        },
        prepareExpense: async (raw) => {
          await active();
          return this.prepare(actor, scope, key, raw);
        },
        recordTool: async (name, toolScope, outcome) => {
          await runs.updateOne(
            { key, lease, status: "running" },
            { $push: { tools: { name, scope: toolScope, outcome } } },
          );
        },
      };
      const text =
        (await this.runner(context)).trim().slice(0, 2000) ||
        "I have no verified update. Open Money to review the recorded facts.";
      await active();
      if (scope.kind === "room")
        await this.dinner.botReply(scope.roomId, actor, sourceId, text);
      else {
        const message: Turn = {
          id: randomUUID(),
          clientId: sourceId,
          role: "assistant",
          text,
          createdAt: new Date().toISOString(),
          replyTo: sourceId,
        };
        await this.db.collection<Session>("dinner-agent-sessions").updateOne(
          {
            userId: actor.id,
            messages: {
              $not: { $elemMatch: { role: "assistant", replyTo: sourceId } },
            },
          },
          { $push: { messages: message } },
        );
      }
      await runs.updateOne({ key, lease }, { $set: { status: "complete" } });
      return { status: "complete", text };
    } catch {
      await runs.updateOne({ key, lease }, { $set: { status: "failed" } });
      fail(
        503,
        "Tab could not finish this reply. Your message is saved; retry it. No payment or confirmation was performed.",
      );
    }
  }
}
