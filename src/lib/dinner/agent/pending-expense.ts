import type { Burst } from "./bursts";
import { matchingBills } from "./bill-reference";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  fail,
  parseUsd,
  splitEvenly,
  usd,
  type Actor,
  type Room,
} from "../model";
import type { ReceiptExtraction } from "../../receipt";
import type { NeedsDetails, Proposal, prepareInput } from "./model";
import { referencedReceipt, referencedRoomMessage, requestsManualBill } from "./receipt-reference";
import { mentionsTab } from "./model";
import { selectedParticipants } from "./participants";

export const pendingPatch = z
  .object({
    payer: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullable()
      .describe('Explicit payer name or "me". Null keeps the saved payer.'),
    participants: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(50)
      .nullable()
      .describe(
        'Explicit participant names, or ["everyone"]. Never infer participants from equal splitting. Null keeps saved participants.',
      ),
    splitEqually: z.boolean().nullable(),
    totalUsd: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .describe(
        'Only an explicitly stated USD total, such as "84.80"; null keeps the receipt total.',
      ),
  })
  .strict();
export type PendingView = {
  status: "collecting" | "preparing" | "ready" | "cancelled";
  total: string | null;
  payer: string | null;
  participants: string[] | null;
  missing: string[];
  reply: string;
};
export type PendingWorkflow = {
  current: () => Promise<PendingView>;
  update: (patch: z.infer<typeof pendingPatch>) => Promise<PendingView>;
  evidence: string[];
};
type Task = {
  _id: string;
  taskId: string;
  roomId: string;
  userId: string;
  attachmentId: string;
  startedSeq: number;
  lastSeq: number;
  version: number;
  status: PendingView["status"];
  description: string;
  totalCents: number | null;
  receiptAmount?: number | null;
  receiptCurrency?: string | null;
  payerId: string | null;
  participantIds: string[] | null;
  equal: boolean;
  proposalKey: string | null;
  burstSourceId?: string;
};
type Dependencies = {
  selectedAttachmentId?: string;
  burst?: Burst;
  db: Db;
  actor: Actor;
  sourceId: string;
  room: () => Promise<Room>;
  extract: (
    roomId: string,
    attachmentId: string,
  ) => Promise<ReceiptExtraction | null>;
  prepare: (
    input: z.infer<typeof prepareInput>,
    key: string,
  ) => Promise<Proposal | NeedsDetails>;
};
const clean = (text: string) =>
  text
    .replace(/@tab\b/gi, "")
    .trim()
    .replace(/[.!?]+$/, "")
    .toLowerCase();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Server-owned state; no model-controlled room IDs, task IDs, versions or shares. */
export async function openPendingExpense(
  deps: Dependencies,
): Promise<PendingWorkflow | null> {
  let room = await deps.room();
  let source = room.messages.find(
    (m) => m.id === deps.sourceId && m.authorId === deps.actor.id,
  );
  if (!source) fail(404, "Your addressed message was not found");
  const originalSource = source;
  if (deps.burst) source = { ...source, seq: deps.burst.messages.at(-1)!.seq, text: deps.burst.messages.map(m => m.text).join("\n") };
  const text = source.text;
  if (requestsManualBill(room.messages, source)) return null;
  // Confirmation belongs to reviewed bill controls, never receipt slot collection.
  if (/\bconfirm\b/i.test(text) && !/\b(?:payer|currency|total|amount|participants)\b/i.test(text))
    return fixed("Use Edit to change bill details, or choose Confirm directly on the bill card. A chat reply does not confirm a bill or make a payment.");

  const referenced = referencedReceipt(room.messages, originalSource);
  const referencedMessage = referencedRoomMessage(room.messages, originalSource);
  const relevantReference =
    referencedMessage &&
    (referencedMessage.attachmentIds.length ||
      /\b(receipt|paid|payer|total|split|usd)\b/i.test(
        referencedMessage.text,
      ) ||
      selectedParticipants(
        [referencedMessage.text],
        room.members,
        deps.actor.id,
      ) !== null);
  // Preserve existing status, correction, nudge and custom-split capabilities.
  if (
    /\b(settle|pay|payment|owes?|owed|balance|pending payments|nudge|remind|correction|correct|amend|unequal|custom|percent)\b|%/i.test(
      text,
    )
  )
    return null;
  const tasks = deps.db.collection<Task>("dinner-pending-expenses");
  const candidates = await tasks
    .find({
      roomId: room.id,
      userId: deps.actor.id,
      startedSeq: { $lte: source.seq },
    })
    .sort({ lastSeq: -1, startedSeq: -1 })
    .toArray();
  let explicitImage = deps.selectedAttachmentId ?? (
    referenced?.attachmentIds.length === 1
      ? referenced.attachmentIds[0]
      : undefined);
  const referenceHint = /\b(?:one|bill|receipt|draft)\b/i.test(text) ||
    candidates.some(task => task.description.length >= 3 && text.toLowerCase().includes(task.description.toLowerCase()));
  const matches = !explicitImage && candidates.length && referenceHint ? matchingBills(text, candidates) : null;
  if (matches?.length === 1) explicitImage = matches[0].attachmentId;
  if (matches && matches.length !== 1) {
    return fixed(matches.length
      ? `Several receipt drafts match: ${matches.map(task => `${task.description}${task.totalCents ? ` (${usd(task.totalCents)})` : ""}`).join("; ")}. Add the bill name and amount, or use Reply on the original receipt image.`
      : "No receipt draft matches that name and amount. Check the bill name and amount, or use Reply on its receipt image.");
  }
  const activeTasks = candidates.filter((task) =>
    ["collecting", "preparing"].includes(task.status),
  );
  const selectedTask = explicitImage
    ? candidates.find((task) => task.attachmentId === explicitImage)
    : undefined;
  const prior = room.messages.filter(m => m.seq < source.seq).at(-1);
  const question = source.replyTo ? room.messages.find(m => m.id === source.replyTo) : prior;
  const origin = question?.kind === "tab" ? room.messages.find(m => m.id === question.runId) : undefined;
  const answeringReceipt = question?.kind === "tab" && question.requestedBy === deps.actor.id &&
    (question.expectsReply ?? question.text.includes("?")) &&
    !!origin && candidates.some(task => task.lastSeq === origin.seq);
  const receiptReference = /\b(?:receipts?|both|(?:these|those) drafts|(?:resume|retry) (?:the )?receipt)\b/i.test(text);
  if (!explicitImage && !referenced && !source.attachmentIds.length && !receiptReference && !answeringReceipt) return null;
  const expenseAnswer =
    /\b(receipt|bill|paid|payer|total|split|equal|equally|everyone|participants|cancel|forget|yes|usd)\b/i.test(
      text,
    ) ||
    parseUsd(clean(text)) !== null ||
    selectedParticipants([text], room.members, deps.actor.id) !== null;
  if (!explicitImage && activeTasks.length === 2 && /^i paid (?:for )?both(?: receipts| bills)?$/i.test(clean(text))) {
    if (activeTasks.some(task => task.status !== "collecting"))
      return fixed("One of these bills is already being prepared. Review that bill before changing its payer.");
    const replies: string[] = [];
    for (const target of activeTasks) {
      const workflow = await openPendingExpense({ ...deps, selectedAttachmentId: target.attachmentId });
      if (!workflow) fail(409, "Receipt is no longer available");
      const result = await workflow.update({ payer: "me", participants: null, totalUsd: null, splitEqually: null });
      replies.push(`${target.description}: ${result.reply}`);
    }
    return fixed(`Got it—you paid for both receipts. ${replies.join(" ")}`);
  }
  if (
    !explicitImage &&
    !referenced &&
    activeTasks.length > 1 &&
    (expenseAnswer || relevantReference)
  ) {
    return fixed(
      `Which receipt draft do you want to update? ${activeTasks.length} drafts need details: ${activeTasks.map((task) => `${task.description}${task.totalCents ? ` (${usd(task.totalCents)})` : task.receiptAmount ? ` (${task.receiptAmount.toFixed(2)})` : ""}`).join("; ")}. Tell me the bill name or amount (for example, “the $100 John Doe bill”), or use Reply on its receipt image. These drafts are not amounts you owe and do not prevent creating a separate bill.`,
    );
  }
  let task =
    selectedTask ??
    (explicitImage ? null : (activeTasks[0] ?? candidates[0] ?? null));
  // Older pending tasks may predate preserving the readable, currency-free amount.
  if (task && !task.totalCents && task.receiptAmount === undefined) {
    const fields = await deps.extract(room.id, task.attachmentId);
    await tasks.updateOne(
      { _id: task._id, version: task.version },
      {
        $set: {
          receiptAmount:
            fields && fields.confidence >= 0.7 ? fields.totalAmount : null,
          receiptCurrency: fields?.currency?.toUpperCase() ?? null,
        },
      },
    );
    task = await tasks.findOne({ _id: task._id });
  }
  const numericAnswer =
    !!task && !task.totalCents && parseUsd(clean(text)) !== null;
  const lastReply = room.messages
    .filter(
      (m) =>
        m.kind === "tab" &&
        m.requestedBy === deps.actor.id &&
        m.seq < source.seq,
    )
    .at(-1);
  const currencyAnswer =
    !!task &&
    !task.totalCents &&
    !!task.receiptAmount &&
    !task.receiptCurrency &&
    (/^(?:yes[, ]+)?(?:it(?:'s| is) )?(?:in )?usd$/i.test(clean(text)) ||
      (/^yes(?: please)?$/i.test(clean(text)) &&
        !!lastReply?.text.endsWith("Is that USD?")));
  const equalAnswer =
    !!task &&
    /^yes(?: please)?$/i.test(clean(text)) &&
    !!lastReply?.text.endsWith("Should I split it equally?");
  if (
    task &&
    ["ready", "cancelled"].includes(task.status) &&
    !source.attachmentIds.length &&
    !source.replyTo &&
    !/\b(receipt|this|that|it|same|retry|review|payer|paid|cancel)\b/i.test(
      text,
    )
  )
    return null;
  const priorReceipt = !task
    ? room.messages
        .filter(
          (m) =>
            m.authorId === deps.actor.id &&
            m.seq < source.seq &&
            mentionsTab(m.text) &&
            /\breceipt\b/i.test(m.text),
        )
        .at(-1)
    : undefined;
  const named =
    room.members.some((m) => clean(text) === m.name.toLowerCase()) ||
    selectedParticipants([text], room.members, deps.actor.id) !== null;
  if (
    !explicitImage &&
    !relevantReference &&
    !source.attachmentIds.length &&
    !/\b(receipt|payer|paid|split|equal|equally|evenly|participants|everyone|both|total|cancel|forget)\b|\$/i.test(
      text,
    ) &&
    !((task || priorReceipt) && named) &&
    !numericAnswer &&
    !currencyAnswer &&
    !equalAnswer
  )
    return null;
  let attachmentId: string | undefined;
  const linked = referenced;
  const recentImage = room.messages
    .filter((m) => m.seq <= source.seq && m.attachmentIds.length)
    .at(-1);
  const oldImage = priorReceipt?.attachmentIds.length
    ? priorReceipt
    : priorReceipt
      ? (room.messages.find(
          (m) => m.id === priorReceipt.replyTo && m.seq <= priorReceipt.seq,
        ) ??
        room.messages
          .filter((m) => m.seq <= priorReceipt.seq && m.attachmentIds.length)
          .at(-1))
      : undefined;
  const image = explicitImage ? room.messages.find(m => m.attachmentIds.includes(explicitImage!) && m.seq <= source.seq) : linked?.attachmentIds.length
    ? linked
    : /\breceipt\b/i.test(text) &&
        (!task || /\b(split|new|another)\b/i.test(text))
      ? recentImage
      : oldImage;
  const anchor =
    referenced ?? (image === oldImage && priorReceipt ? priorReceipt : source);
  if (image?.attachmentIds.length === 1) attachmentId = image.attachmentIds[0];
  if (image && image.attachmentIds.length > 1)
    return fixed(
      "Please share or reply to one receipt image so I know which one to split.",
    );
  if (attachmentId) {
    const id = `${room.id}:${deps.actor.id}:${attachmentId}`;
    const previous = await tasks.findOne({ _id: id });
    if (previous) task = previous;
    else {
      const existing = await deps.db
        .collection<Proposal>("dinner-agent-proposals")
        .findOne(
          {
            roomId: room.id,
            userId: deps.actor.id,
            "fields.attachmentId": attachmentId,
            correctionOf: { $exists: false },
          },
          { sort: { createdAt: -1 } },
        );
      if (
        !existing &&
        room.expenses.some((expense) => expense.attachmentId === attachmentId)
      )
        return fixed(
          "This receipt already has an expense. Open Money to review its current status.",
        );
      const fields = existing
        ? null
        : await deps.extract(room.id, attachmentId);
      const created: Task = {
        _id: id,
        taskId: randomUUID(),
        roomId: room.id,
        userId: deps.actor.id,
        attachmentId,
        startedSeq: deps.burst?.messages[0].seq ?? anchor.seq,
        lastSeq: (deps.burst?.messages[0].seq ?? anchor.seq) - 1,
        version: 0,
        status: "collecting",
        description: (fields?.merchant || "Receipt").slice(0, 120),
        totalCents:
          fields?.currency?.toUpperCase() === "USD" &&
          fields.confidence >= 0.7 &&
          fields.totalAmount
            ? parseUsd(String(fields.totalAmount))
            : null,
        receiptAmount:
          fields && fields.confidence >= 0.7 ? fields.totalAmount : null,
        receiptCurrency: fields?.currency?.toUpperCase() ?? null,
        payerId: null,
        participantIds: null,
        equal: /\b(equal|equally|evenly)\b/i.test(anchor.text),
        proposalKey: null,
      };
      if (existing)
        Object.assign(created, {
          status: "ready",
          description: existing.fields.description,
          totalCents: existing.fields.totalCents,
          payerId: existing.fields.payerId,
          participantIds: existing.fields.shares.map((share) => share.userId),
          equal: true,
          proposalKey: existing.runKey,
        });
      await tasks.updateOne(
        { _id: id },
        { $setOnInsert: created },
        { upsert: true },
      );
      task = await tasks.findOne({ _id: id });
    }
  }
  if (!task) return null;
  if (deps.burst && task.burstSourceId === deps.burst.sourceId && task.proposalKey && ["ready", "preparing"].includes(task.status)) {
    const prior = await deps.db.collection<Proposal>("dinner-agent-proposals").findOne({ runKey: task.proposalKey });
    const published = room.messages.some(m => m.kind === "tab" && m.runId === deps.burst!.sourceId);
    if ((!prior || prior.publication?.revision !== deps.burst.revision) && !published) {
      await tasks.updateOne({ _id: task._id, version: task.version }, { $set: { status: "collecting", proposalKey: null }, $inc: { version: 1 } });
      task = (await tasks.findOne({ _id: task._id }))!;
    }
  }
  let value: Task = task;
  const authorize = async () => {
    room = await deps.room();
    if (
      !room.messages.some(
        (m) =>
          m.seq <= source.seq && m.attachmentIds.includes(value.attachmentId),
      )
    )
      fail(404, "Receipt is no longer available");
    const latest = await tasks.findOne({ _id: value._id });
    if (!latest) fail(404, "Pending expense not found");
    value = latest;
    if (value.lastSeq > source.seq)
      fail(
        409,
        "A newer clarification updated this receipt. Use the latest conversation.",
      );
  };
  await authorize();
  const nextReceiptSeq = candidates
    .filter(
      (task) =>
        task.attachmentId !== value.attachmentId &&
        task.startedSeq > value.startedSeq,
    )
    .reduce((end, task) => Math.min(end, task.startedSeq), Infinity);
  const evidenceMessages = room.messages.filter(
    (m) =>
      m.authorId === deps.actor.id &&
      m.seq >= value.startedSeq &&
      m.seq <= source.seq &&
      (m.seq < nextReceiptSeq || m.id === source.id) &&
      (!deps.burst || m.seq < deps.burst.messages[0].seq || deps.burst.messages.some(b => b.id === m.id)),
  );
  const evidence = evidenceMessages.map((m) => m.text);
  const name = (id: string) =>
    room.members.find((m) => m.userId === id)?.name ?? "Former member";
  const replace = async (next: Task) => {
    const saved = await tasks.findOneAndReplace(
      { _id: value._id, version: value.version },
      { ...next, version: value.version + 1, lastSeq: source.seq },
      { returnDocument: "after" },
    );
    if (!saved)
      fail(409, "This receipt changed. Retry using its latest saved details.");
    value = saved;
  };
  const missing = () =>
    [
      !value.totalCents && "total",
      !value.payerId && "payer",
      !value.participantIds?.length && "participants",
      !value.equal && "split method",
    ].filter((v): v is string => !!v);
  const ensureProposal = async () => {
    if (value.status === "collecting" && !missing().length) {
      // Freeze a validated payload before writing the proposal. The stable key
      // deduplicates recovery even when a later addressed message resumes it.
      await replace({
        ...value,
        status: "preparing",
        ...(deps.burst ? { burstSourceId: deps.burst.sourceId } : {}),
        proposalKey: `pending:${value.taskId}:${value.version + 1}`,
      });
    }
    if (value.status !== "preparing") return;
    if (
      !value.totalCents ||
      !value.payerId ||
      !value.participantIds?.length ||
      !value.proposalKey
    )
      fail(409, "Incomplete pending expense");
    const prepared = await deps.prepare(
      {
        roomId: value.roomId,
        attachmentId: value.attachmentId,
        description: value.description,
        totalCents: value.totalCents,
        payerId: value.payerId,
        shares: splitEvenly(value.totalCents, [...value.participantIds].sort()),
      },
      value.proposalKey,
    );
    if ("kind" in prepared) fail(422, prepared.message);
    await replace({ ...value, status: "ready", proposalKey: prepared.runKey });
  };
  const current = async (): Promise<PendingView> => {
    await authorize();
    const invalidMember =
      (value.payerId &&
        !room.members.some((m) => m.userId === value.payerId)) ||
      value.participantIds?.some(
        (id) => !room.members.some((m) => m.userId === id),
      );
    if (invalidMember && value.status === "collecting") {
      await replace({
        ...value,
        payerId:
          value.payerId && room.members.some((m) => m.userId === value.payerId)
            ? value.payerId
            : null,
        participantIds: value.participantIds?.every((id) =>
          room.members.some((m) => m.userId === id),
        )
          ? value.participantIds
          : null,
      });
    }
    if (invalidMember && value.status === "preparing")
      return render(
        "Room membership changed while this proposal was being prepared. Review the room members and prepare a new expense in Money.",
      );
    await ensureProposal();
    if (value.status === "cancelled")
      return render(
        "This pending receipt split is cancelled. No expense was confirmed.",
      );
    if (value.status === "ready") {
      const proposal = await deps.db
        .collection<Proposal>("dinner-agent-proposals")
        .findOne({ runKey: value.proposalKey! });
      if (!proposal)
        fail(409, "The review proposal is unavailable. Retry shortly.");
      const savedBill = room.expenses.find(
        (expense) => expense.id === proposal.appliedExpenseId,
      );
      if (savedBill?.status === "cancelled")
        return render(
          "This bill was cancelled. Its history is preserved; no debt or payment was created.",
        );
      return render(
        `${usd(proposal.fields.totalCents)} total; ${name(proposal.fields.payerId)} paid. Shares: ${proposal.fields.shares.map((s) => `${name(s.userId)} ${usd(s.cents)}`).join(", ")}. ${proposal.appliedExpenseId ? "Open Money to review the saved expense and its current status." : "Choose Confirm on the card, or Edit to change the details. No expense is confirmed or payment made by this proposal."}`,
      );
    }
    const known = [
      value.totalCents && `Receipt total: ${usd(value.totalCents)}.`,
      value.payerId && `${name(value.payerId)} paid.`,
      value.participantIds?.length &&
        `Sharing: ${value.participantIds.map(name).join(", ")}.`,
    ]
      .filter(Boolean)
      .join(" ");
    const question = (
      {
        total: value.receiptAmount
          ? value.receiptCurrency && value.receiptCurrency !== "USD"
            ? `I read ${value.receiptAmount.toFixed(2)} ${value.receiptCurrency} on the receipt. What USD amount should I use?`
            : `I read ${value.receiptAmount.toFixed(2)} on the receipt, but no currency is shown. Is that USD?`
          : "I couldn't reliably read the receipt total. What is the total in USD?",
        payer: "Who paid?",
        participants: "Who should share this receipt?",
        "split method": "Should I split it equally?",
      } as Record<string, string>
    )[missing()[0]];
    return render([known, question].filter(Boolean).join(" "));
  };
  function render(reply: string): PendingView {
    return {
      status: value.status,
      total: value.totalCents ? usd(value.totalCents) : null,
      payer: value.payerId ? name(value.payerId) : null,
      participants: value.participantIds?.map(name) ?? null,
      missing: missing(),
      reply,
    };
  }
  if (/\b(cancel|forget)\b/i.test(text)) {
    if (value.status === "preparing")
      return fixed(
        "This receipt proposal is already being prepared. Retry shortly to review its saved result.",
      );
    if (value.status === "ready")
      return fixed(
        "This receipt already has a review proposal. Review the proposal or its saved expense in Money.",
      );
    if (
      value.proposalKey &&
      (await deps.db
        .collection("dinner-agent-proposals")
        .findOne({ runKey: value.proposalKey }))
    )
      return fixed(
        "A review proposal already exists for this receipt. Open Money to review it.",
      );
    await replace({ ...value, status: "cancelled" });
  }
  return {
    current,
    evidence: evidence
      .filter((t) =>
        /\b(paid|payer|total|split|equal|equally|evenly|between|participants|everyone|both)\b|\$/i.test(
          t,
        ),
      )
      .slice(-20),
    update: async (raw) => {
      const patch = pendingPatch.parse(raw);
      await current();
      if (value.status !== "collecting") return current();
      const next = { ...value };
      if (currencyAnswer && value.receiptAmount && !value.receiptCurrency)
        next.totalCents = parseUsd(value.receiptAmount.toFixed(2));
      const resolve = (s: string) => {
        if (["me", "myself"].includes(clean(s))) return deps.actor.id;
        const found = room.members.filter(
          (m) => m.name.toLowerCase() === clean(s),
        );
        return found.length === 1 ? found[0].userId : null;
      };
      const newMessages = evidenceMessages.filter(
        (m) => m.seq > value.lastSeq || m.seq === source.seq,
      );
      if (patch.payer) {
        const id = resolve(patch.payer);
        if (
          id &&
          newMessages
            .filter(
              (m) =>
                /\b(paid|payer)\b/i.test(m.text) ||
                ["me", "myself"].includes(clean(m.text)) ||
                room.members.some(
                  (member) => clean(m.text) === member.name.toLowerCase(),
                ),
            )
            .slice(-1)
            .some(
              (m) =>
                (id === deps.actor.id &&
                  /\bi\s+(?:was\s+the\s+payer|paid)\b/i.test(m.text)) ||
                new RegExp(
                  `\\b${escape(name(id))}\\s+(?:paid|was the payer)\\b|\\bpayer (?:is|was) ${escape(name(id))}\\b`,
                  "i",
                ).test(m.text) ||
                (!value.payerId &&
                  (clean(m.text) === name(id).toLowerCase() ||
                    (id === deps.actor.id &&
                      ["me", "myself"].includes(clean(m.text))))),
            )
        )
          next.payerId = id;
      }
      if (patch.participants) {
        const bareParticipant =
          value.payerId && !value.participantIds
            ? resolve(clean(source.text))
            : null;
        const allowed =
          selectedParticipants(evidence, room.members, deps.actor.id) ??
          (bareParticipant ? [bareParticipant] : null);
        const ids =
          patch.participants.length === 1 &&
          clean(patch.participants[0]) === "everyone"
            ? room.members.map((m) => m.userId)
            : patch.participants.map(resolve);
        if (
          allowed &&
          ids.every(Boolean) &&
          JSON.stringify([...ids].sort()) ===
            JSON.stringify([...allowed].sort())
        )
          next.participantIds = allowed;
      }
      if (
        patch.splitEqually === true &&
        (equalAnswer ||
          evidence.some((t) => /\b(equal|equally|evenly)\b/i.test(t)))
      )
        next.equal = true;
      if (patch.totalUsd) {
        const total = parseUsd(patch.totalUsd.replace(/^\$/, "").trim());
        const stated = newMessages.flatMap((m) =>
          [
            ...m.text.matchAll(
              /(?:\btotal(?:\s+is)?\s*[:=]?\s*(?:USD\s*)?\$?|\bUSD\s*|\$)(\d+(?:\.\d{1,2})?)(?!\d|\.\d)/gi,
            ),
          ].map((match) => parseUsd(match[1])),
        );
        if (!value.totalCents && numericAnswer)
          stated.push(parseUsd(clean(source.text)));
        if (total && stated.at(-1) === total) next.totalCents = total;
      }
      // Valid fields survive other unsupported model guesses.
      await replace(next);
      return current();
    },
  };
}
function fixed(reply: string): PendingWorkflow {
  const current = async (): Promise<PendingView> => ({
    status: "cancelled",
    total: null,
    payer: null,
    participants: null,
    missing: [],
    reply,
  });
  return { current, update: current, evidence: [] };
}
