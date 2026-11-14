import { replyChain } from "./coordination";
import type { Burst } from "./bursts";
import { orderedPayerAnswer, type BillQuestionField, resolvePayerEvidence, type PayerExtractor, type PayerEvidence } from "./payer-extraction";
import { requestsManualBill, referencedRoomMessage } from "./receipt-reference";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { z } from "zod";
import {
  fail,
  parseUsd,
  splitEvenly,
  validateShares,
  expenseInput,
  type Actor,
  type Room,
  type Message,
} from "../model";
import { answersTabQuestion, directlyAddressesTab, stripTabAddress } from "./awareness-schema";
import { selectedParticipants } from "./participants";
import type { prepareInput, Proposal } from "./model";

type Fields = Omit<
  z.infer<typeof prepareInput>,
  "roomId" | "correctionOf" | "expectedVersion"
>;
export type BillTask = {
  _id: string;
  id: string;
  roomId: string;
  userId: string;
  version: number;
  status: "collecting" | "preparing" | "ready" | "cancelled";
  startedSeq: number;
  lastSeq: number;
  sourceIds: string[];
  evidence: Pick<Message, "id" | "seq" | "authorId" | "text">[];
  fields: Fields;
  payerEvidence?: PayerEvidence;
  participantIds: string[] | null;
  equal: boolean;
  question: string | null;
  questionFields?: BillQuestionField[];
  questionMessageId: string | null;
  proposalId: string | null;
  updatedAt: string;
};
const clean = (text: string) =>
  stripTabAddress(text)
    .replace(/@tab\b/gi, "")
    .replace(/^\s*tab[,!:]?\s+/i, "")
    .trim()
    .replace(/[.!]+$/, "")
    .toLowerCase();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Room-owned evidence and slots survive model windows and process restarts. */
export class BillTasks {
  constructor(private db: Db) {}
  private get tasks() {
    return this.db.collection<BillTask>("dinner-bill-tasks");
  }
  async open(
    room: Room,
    actor: Actor,
    source: Message,
    participants: string[] | null,
    focused: boolean,
    action?: "create" | "continue",
    payerExtractor?: PayerExtractor,
    burst?: Burst,
  ): Promise<BillTask | null> {
    if (burst) source = { ...source, seq: burst.messages.at(-1)!.seq };
    const reference = action === "create" && source.replyTo ? undefined : referencedRoomMessage(room.messages, source);
    const manualReference = !source.replyTo && reference?.authorId === actor.id && requestsManualBill(room.messages, reference) ? reference : undefined;
    if (manualReference) source = { ...source, text: manualReference.text };
    if (
      source.attachmentIds.length ||
      !action && /\b(receipt|correction|amend|owes?|owed|balance|nudge|remind)\b/i.test(
        source.text,
      )
    )
      return null;
    const requestText = clean(source.text);
    if (!requestText || /^(?:hey|hi|hello|thanks|thank you|how are you|are you there)[?!,. ]*$/i.test(requestText)) return null;
    const topic = focused ? room.messages.find(m => m.id === room.assistance?.offer?.topicId && m.seq <= source.seq) : undefined;
    const billFocus = !!topic && (/\b(bill|expense|split|paid|payer|cost)\b/i.test(topic.text) || requestsManualBill(room.messages, topic));
    if (!action && directlyAddressesTab(source.text) && !billFocus && !requestsManualBill(room.messages, source) && !/\b(bill|expense|split|paid|payer|total|amount|participants|everyone|equally|resume|retry|continue|cancel)\b/i.test(requestText)) return null;
    const all = await this.tasks
      .find({
        roomId: room.id,
        userId: actor.id,
        startedSeq: { $lte: source.seq },
      })
      .sort({ startedSeq: -1 })
      .toArray();
    let task = all.find(
      (t) =>
        t.sourceIds.includes(source.id) ||
        (action !== "create" && source.replyTo &&
          (t.questionMessageId === source.replyTo ||
            t.sourceIds.includes(source.replyTo))),
    );
    if (!task && action !== "create" && source.replyTo) {
      const ids = new Set(replyChain(room.messages, source).messages.map(m => m.id));
      const matches = all.filter(t => ids.has(t.questionMessageId ?? "") || t.sourceIds.some(id => ids.has(id)));
      if (matches.length === 1) task = matches[0];
      else if (matches.length > 1) fail(409, "This reply refers to multiple bills. Reply to the bill question you mean.");
      // An explicit unrelated reply must not fall through to the most recent task.
      if (!task && action === "continue") return null;
    }
    // A caret can point to an untagged answer to our persisted question.
    // Bind that explicit evidence to the question's task even if routing calls it creation.
    if (!task && reference?.authorId === actor.id && !requestsManualBill(room.messages, reference)) {
      const question = room.messages.filter(m => m.seq < reference.seq).at(-1);
      if (question?.kind === "tab" && question.requestedBy === actor.id)
        task = all.find(t => t.questionMessageId === question.id && ["collecting", "preparing"].includes(t.status));
    }
    const fresh = action === "create" || (!action && requestsManualBill(room.messages, source));
    // Addressing already accepts adjacent answers. Bind that same answer to the
    // persisted question's task before considering any unrelated active drafts.
    if (!task && !fresh && answersTabQuestion(room.messages, source)) {
      const question = room.messages.filter(m => m.seq < source.seq).at(-1);
      task = all.find(t => t.questionMessageId === question?.id &&
        ["collecting", "preparing"].includes(t.status));
    }
    const active = all.filter((t) =>
      ["collecting", "preparing"].includes(t.status),
    );
    if (
      !task &&
      !fresh &&
      /\b(retry|resume|continue|same bill)\b/i.test(source.text)
    )
      task = all[0];
    if (!task && !fresh) {
      if (active.length > 1)
        fail(
          409,
          "Several bills need details. Reply to the question for the bill you mean.",
        );
      task = active[0];
    }
    if (
      !task &&
      !(
        action === "create" || billFocus || requestsManualBill(room.messages, source) ||
        /\b(create|prepare|make|split)\b.*\b(bill|expense|dinner|lunch|rent|taxi|cost)|\bsplit\b/i.test(
          source.text,
        )
      )
    )
      return null;
    if (!task) {
      const topic = focused
        ? room.messages.find(
            (m) =>
              m.id === room.assistance?.offer?.topicId && m.seq <= source.seq,
          )
        : source;
      const startedSeq = (reference?.authorId === actor.id ? reference.seq : undefined) ?? burst?.messages[0].seq ?? topic?.seq ?? source.seq;
      const initial: BillTask = {
        _id: `${room.id}:${actor.id}:${source.id}`,
        id: randomUUID(),
        roomId: room.id,
        userId: actor.id,
        version: 0,
        status: "collecting",
        startedSeq,
        lastSeq: startedSeq - 1,
        sourceIds: [],
        evidence: [],
        fields: {},
        participantIds: null,
        equal: false,
        question: null,
        questionMessageId: null,
        proposalId: null,
        updatedAt: new Date().toISOString(),
      };
      await this.tasks.updateOne(
        { _id: initial._id },
        { $setOnInsert: initial },
        { upsert: true },
      );
      task = (await this.tasks.findOne({ _id: initial._id }))!;
    }
    if (task.lastSeq > source.seq)
      fail(409, "This bill has newer details. Reply to its latest question.");
    if ((task.sourceIds.includes(source.id) || task.status !== "collecting") && !(burst && source.seq > task.lastSeq && task.sourceIds.includes(source.id) && task.status !== "cancelled"))
      return task;
    if (burst && task.status === "preparing") task = await this.replace(task, { ...task, status: "collecting", fields: { ...task.fields, shares: undefined } });
    const evidence = room.messages.filter(
      (m) =>
        m.kind !== "tab" &&
        m.seq >= task!.startedSeq &&
        m.seq <= source.seq &&
        (burst ? (burst.messages.some(b => b.id === m.id) || (reference?.authorId === actor.id && m.id === reference.id)) : (m.seq <=
          (room.messages.find((x) => x.id === task!.sourceIds[0])?.seq ??
            source.seq) ||
          m.id === source.id || (reference?.authorId === actor.id && m.id === reference.id))),
    );
    const newEvidence = evidence.filter(
      (m) => !task!.evidence.some((e) => e.id === m.id),
    );
    const fields = { ...task.fields };
    let equal = task.equal;
    for (const m of newEvidence) {
      const totals = [
        ...m.text.matchAll(/(?:\bUSD\s*|\$)(\d+(?:\.\d{1,2})?)(?!\d|\.\d)/gi),
      ]
        .map((match) => parseUsd(match[1]))
        .filter((v): v is number => !!v);
      if (totals.length === 1) fields.totalCents = totals[0];
      else if (
        !fields.totalCents &&
        /total|amount|how much/i.test(task.question ?? "") &&
        m.id === source.id
      ) {
        const amount = parseUsd(clean(m.text));
        if (amount) fields.totalCents = amount;
      }
      if (!payerExtractor) {
      if (/\bi (?:paid|was the payer)\b/i.test(m.text))
        fields.payerId = m.authorId;
      for (const member of room.members) {
        if (
          room.members.filter(
            (x) => x.name.toLowerCase() === member.name.toLowerCase(),
          ).length !== 1
        )
          continue;
        if (
          new RegExp(
            `\\b${escape(member.name)} (?:paid|was the payer)\\b`,
            "i",
          ).test(m.text)
        )
          fields.payerId = member.userId;
        if (
          /who paid|payer/i.test(task.question ?? "") &&
          m.id === source.id &&
          clean(m.text) === member.name.toLowerCase()
        )
          fields.payerId = member.userId;
      }
      if (
        /who paid|payer/i.test(task.question ?? "") &&
        m.id === source.id &&
        /^(?:me|myself)$/i.test(clean(m.text))
      )
        fields.payerId = actor.id;
      }
      if (/\b(equally|equal|evenly)\b/i.test(m.text)) equal = true;
      if (
        /split.*equal/i.test(task.question ?? "") &&
        m.id === source.id &&
        /^yes(?: please)?$/i.test(clean(m.text))
      )
        equal = true;
    }
    let payerEvidence = task.payerEvidence;
    if (payerExtractor && newEvidence.length) {
      const input = { messages: newEvidence.map(({ id, authorId, text }) => ({ id, authorId, text })),
        members: room.members.map(({ userId, name }) => ({ userId, name })), question: task.question,
        currentPayerId: task.fields.payerId };
      const answer = burst ? newEvidence.at(-1) : newEvidence.find(m => m.id === source.id);
      const ordered = answer && orderedPayerAnswer(answer, input.members, task.questionFields);
      const resolved = resolvePayerEvidence(input, ordered ?? await payerExtractor(input));
      if (resolved.kind === "set") { fields.payerId = resolved.payerId; payerEvidence = resolved.evidence; }
      else if (resolved.kind === "clear") { delete fields.payerId; payerEvidence = resolved.evidence; }
    }
    const selection =
      participants ??
      selectedParticipants(newEvidence.filter(m => m.authorId === actor.id).map(m => m.text), room.members, actor.id) ??
      task.participantIds;
    const next = {
      ...task,
      fields,
      payerEvidence,
      equal,
      participantIds: selection,
      sourceIds: [...new Set([...task.sourceIds, source.id])],
      evidence: [
        ...task.evidence,
        ...newEvidence.map(({ id, seq, authorId, text }) => ({
          id,
          seq,
          authorId,
          text,
        })),
      ],
      lastSeq: source.seq,
    };
    if (/\b(cancel|forget)\b/i.test(burst ? burst.messages.at(-1)!.text : source.text)) next.status = "cancelled";
    return this.replace(task, next);
  }
  async replace(previous: BillTask, next: BillTask) {
    const result = await this.tasks.findOneAndReplace(
      { _id: previous._id, version: previous.version },
      {
        ...next,
        version: previous.version + 1,
        updatedAt: new Date().toISOString(),
      },
      { returnDocument: "after" },
    );
    if (!result) fail(409, "This bill changed. Retry with its latest details.");
    return result;
  }
  async prepare(
    task: BillTask,
    raw: z.infer<typeof prepareInput>,
    room: Room,
    strict = true,
  ) {
    const latest =
      (await this.tasks.findOne({ _id: task._id })) ??
      fail(404, "Bill task not found");
    if (latest.lastSeq > task.lastSeq)
      fail(409, "Newer details superseded this bill request");
    if (latest.status === "cancelled") fail(409, "This bill was cancelled");
    if (latest.status === "preparing" || latest.status === "ready")
      return latest;
    const fields: Fields = {
      ...(!strict
        ? {
            totalCents: raw.totalCents,
            payerId: raw.payerId,
            shares: raw.shares,
          }
        : {}),
      ...latest.fields,
      description:
        raw.description ?? latest.fields.description ?? "Shared bill",
    };
    const members = new Set(room.members.map((m) => m.userId));
    if (fields.payerId && !members.has(fields.payerId)) delete fields.payerId;
    const participants = latest.participantIds?.every((id) => members.has(id))
      ? latest.participantIds
      : !strict && raw.shares?.every((s) => members.has(s.userId))
        ? raw.shares.map((s) => s.userId)
        : null;
    if (participants && fields.totalCents && latest.equal)
      fields.shares = splitEvenly(fields.totalCents, [...participants].sort());
    else if (
      participants &&
      raw.shares &&
      JSON.stringify(raw.shares.map((s) => s.userId).sort()) ===
        JSON.stringify([...participants].sort())
    )
      fields.shares = raw.shares;
    else delete fields.shares;
    if (fields.totalCents && fields.payerId && fields.shares?.length)
      validateShares(
        expenseInput.parse({ ...fields, clientId: randomUUID() }),
        room,
      );
    return this.replace(latest, {
      ...latest,
      fields,
      participantIds: participants,
      status:
        fields.totalCents && fields.payerId && fields.shares?.length
          ? "preparing"
          : "collecting",
    });
  }
  async recordReply(task: BillTask, reply: Message, proposal: Proposal | null, questionFields?: BillQuestionField[]) {
    // Never overwrite a newer turn's question or fields.
    await this.tasks.updateOne(
      { _id: task._id, lastSeq: task.lastSeq },
      {
        $set: {
          question: (reply.kind === "tab" && reply.expectsReply) || reply.text.includes("?") ? reply.text : null,
          questionMessageId: reply.id,
          questionFields: questionFields ?? [],
          ...(proposal ? { proposalId: proposal.id, status: "ready" } : {}),
          updatedAt: new Date().toISOString(),
        },
        $inc: { version: 1 },
      },
    );
  }
  context(task: BillTask, room: Room) {
    return JSON.stringify({
      taskId: task.id,
      status: task.status,
      fields: task.fields,
      confirmedParticipants: task.participantIds,
      splitEqually: task.equal,
      awaitingQuestion: task.question,
      evidence: task.evidence.slice(-25).map((m) => ({
        ...m,
        speaker:
          room.members.find((u) => u.userId === m.authorId)?.name ??
          "Former member",
      })),
    });
  }
}
