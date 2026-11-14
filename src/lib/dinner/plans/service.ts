import {
  feedCursorSchema,
  planEventActions,
  planEventSchema,
  planSummarySchema,
  type PlanFeed,
} from "./conversation";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { Db, MongoServerError } from "mongodb";
import { Actor, fail } from "../model";
import { DinnerService } from "../service";
import {
  commandInput,
  createPlanInput,
  Plan,
  PlanView,
  planSchema,
} from "./model";
import { resolveSlot } from "./time";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function planView(plan: Plan, actor: Actor): PlanView {
  return planSchema.parse({
    ...plan,
    responses: plan.responses.map((r) => {
      const { privateNote, ...shared } = r;
      return actor.id === r.userId || actor.id === plan.creatorId
        ? { ...shared, privateNote }
        : shared;
    }),
  });
}
export class PlanService {
  private collection;
  private ready;
  constructor(
    db: Db,
    private dinner: DinnerService,
    private now = () => new Date().toISOString(),
  ) {
    this.collection = db.collection<Plan>("dinner-plans");
    this.ready = this.collection.createIndexes([
      { key: { id: 1 }, unique: true },
      { key: { creatorId: 1, creationId: 1 }, unique: true },
      { key: { roomId: 1, createdAt: -1 } },
    ]);
  }
  async list(actor: Actor, roomId: string, before?: string) {
    await this.ready;
    await this.dinner.memberRoom(roomId, actor);
    const cursor = before
      ? await this.collection.findOne({ id: before, roomId })
      : null;
    if (before && !cursor) fail(404, "Plan page not found");
    return (
      await this.collection
        .find({
          roomId,
          ...(cursor
            ? {
                $or: [
                  { createdAt: { $lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { $lt: cursor.id } },
                ],
              }
            : {}),
        })
        .sort({ createdAt: -1, id: -1 })
        .limit(100)
        .toArray()
    ).map((p) => planView(p, actor));
  }
  async conversation(
    actor: Actor,
    roomId: string,
    before?: string,
  ): Promise<PlanFeed> {
    await this.ready;
    await this.dinner.memberRoom(roomId, actor);
    let cursor: z.infer<typeof feedCursorSchema> | undefined;
    if (before) {
      try {
        cursor = feedCursorSchema.parse(
          JSON.parse(Buffer.from(before, "base64url").toString("utf8")),
        );
      } catch {
        fail(400, "Invalid plan update cursor");
      }
    }
    const cursorMatch = cursor
      ? [
          {
            $match: {
              $or: [
                { at: { $lt: cursor.at } },
                { at: cursor.at, planId: { $lt: cursor.planId } },
                {
                  at: cursor.at,
                  planId: cursor.planId,
                  index: { $lt: cursor.index },
                },
              ],
            },
          },
        ]
      : [];
    // Only explicitly published plans enter chat. Project fields in Mongo itself:
    // private notes, request hashes, draft changes and response payloads never leave storage here.
    const rows = await this.collection
      .aggregate([
        { $match: { roomId, "history.action": "publish" } },
        {
          $facet: {
            plans: [
              { $sort: { updatedAt: -1, id: -1 } },
              { $limit: 7 },
              {
                $project: {
                  _id: 0,
                  id: 1,
                  title: 1,
                  state: 1,
                  revision: 1,
                  creatorId: 1,
                  participantIds: 1,
                  timeZone: 1,
                  location: 1,
                  budgetCents: 1,
                  slots: 1,
                  deadline: 1,
                  terms: 1,
                  termsVersion: 1,
                  confirmedIds: 1,
                  updatedAt: 1,
                  "responses.userId": 1,
                  "decisions.userId": 1,
                  "decisions.termsVersion": 1,
                  "decisions.decision": 1,
                },
              },
            ],
            events: [
              {
                $unwind: { path: "$history", includeArrayIndex: "eventIndex" },
              },
              { $match: { "history.action": { $in: [...planEventActions] } } },
              {
                $project: {
                  _id: 0,
                  id: { $concat: ["$id", ":", "$history.id"] },
                  planId: "$id",
                  title: 1,
                  at: "$history.at",
                  actorId: "$history.actorId",
                  action: "$history.action",
                  termsVersion: "$history.termsVersion",
                  index: "$eventIndex",
                  terms: "$history.terms",
                },
              },
              ...cursorMatch,
              { $sort: { at: -1, planId: -1, index: -1 } },
              { $limit: 51 },
            ],
          },
        },
      ])
      .toArray();
    const result = z
      .object({
        plans: z.array(planSummarySchema),
        events: z.array(planEventSchema),
      })
      .parse(rows[0]);
    const events = result.events.slice(0, 50);
    const last = events.at(-1);
    return {
      plans: result.plans.slice(0, 6),
      morePlans: result.plans.length > 6,
      events,
      nextCursor:
        result.events.length > 50 && last
          ? Buffer.from(
              JSON.stringify({
                at: last.at,
                planId: last.planId,
                index: last.index,
              }),
            ).toString("base64url")
          : null,
    };
  }
  async attention(actor: Actor) {
    await this.ready;
    const { rooms } = await this.dinner.list(actor);
    return (
      await this.collection
        .find({
          roomId: { $in: rooms.map((r) => r.id) },
          state: { $in: ["collecting", "confirming", "confirmed"] },
          $or: [{ participantIds: actor.id }, { creatorId: actor.id }],
        })
        .sort({ updatedAt: -1 })
        .limit(100)
        .toArray()
    ).map((p) => ({
      ...planView(p, actor),
      roomName: rooms.find((r) => r.id === p.roomId)?.name ?? "Room",
    }));
  }
  async get(actor: Actor, roomId: string, id: string) {
    await this.ready;
    await this.dinner.memberRoom(roomId, actor);
    const plan = await this.collection.findOne({ id, roomId });
    return plan ? planView(plan, actor) : fail(404, "Plan not found");
  }
  async expenseDraft(actor: Actor, roomId: string, id: string, raw: unknown) {
    const plan = await this.get(actor, roomId, id);
    if (plan.state !== "completed")
      fail(409, "Complete the outing before preparing its expense");
    // A plan budget is never an actual charge. Complete expense fields must be
    // supplied by a human or a reviewed proposal, and remain an unconfirmed draft.
    return this.dinner.draft(roomId, actor, raw, undefined, undefined, plan.id);
  }
  async create(actor: Actor, roomId: string, raw: unknown): Promise<PlanView> {
    await this.ready;
    const input = createPlanInput.parse(raw);
    const room = await this.dinner.memberRoom(roomId, actor);
    const creationHash = hash({ roomId, input });
    const existing = await this.collection.findOne({
      creatorId: actor.id,
      creationId: input.clientId,
    });
    if (existing) {
      if (existing.creationHash !== creationHash)
        fail(409, "Retry ID already used for another plan");
      return planView(existing, actor);
    }
    if (
      new Set(input.participantIds).size !== input.participantIds.length ||
      input.participantIds.some(
        (id) => !room.members.some((m) => m.userId === id),
      )
    )
      fail(400, "Choose distinct accepted room members");
    this.deadline(input.deadline);
    const slots = input.slots.map((s) => ({
      ...resolveSlot(s, input.timeZone),
      id: randomUUID(),
    }));
    this.futureSlots(slots);
    const now = this.now();
    const plan: Plan = {
      id: randomUUID(),
      roomId,
      creatorId: actor.id,
      creationId: input.clientId,
      creationHash,
      title: input.title,
      participantIds: input.participantIds,
      timeZone: input.timeZone,
      location: input.location,
      budgetCents: input.budgetCents,
      currency: "USD",
      state: "draft",
      revision: 0,
      optionsVersion: 1,
      termsVersion: 0,
      slots,
      deadline: input.deadline,
      responses: [],
      decisions: [],
      confirmedIds: [],
      terms: null,
      history: [],
      requests: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.collection.insertOne(plan);
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000)
        return this.create(actor, roomId, raw);
      throw e;
    }
    return planView(plan, actor);
  }
  private deadline(value: string | null) {
    if (value && Date.parse(value) <= Date.parse(this.now()))
      fail(400, "Choose a future response deadline");
  }
  private futureSlots(slots: { startAt: string }[]) {
    if (slots.some((s) => Date.parse(s.startAt) <= Date.parse(this.now())))
      fail(400, "Choose future times");
    if (new Set(slots.map((s) => s.startAt)).size !== slots.length)
      fail(400, "Choose distinct times");
  }
  async command(actor: Actor, roomId: string, id: string, raw: unknown) {
    await this.ready;
    const input = commandInput.parse(raw);
    const fingerprint = hash(input);
    for (let attempt = 0; attempt < 15; attempt++) {
      const room = await this.dinner.memberRoom(roomId, actor);
      const plan = await this.collection.findOne({ id, roomId });
      if (!plan) return fail(404, "Plan not found");
      const previous = plan.requests.find(
        (r) => r.actorId === actor.id && r.id === input.clientId,
      );
      if (previous) {
        if (previous.hash !== fingerprint)
          fail(409, "Retry ID used with different content");
        return planView(plan, actor);
      }
      if (
        input.action !== "clear_note" &&
        ["completed", "cancelled"].includes(plan.state)
      )
        fail(409, "This plan is closed");
      if (
        !(
          ["clear_note", "withdraw", "cancel", "complete"] as string[]
        ).includes(input.action) &&
        (plan.requests.length >= 500 || plan.history.length >= 200)
      )
        fail(422, "Plan history limit reached; create a new plan");
      const revision = plan.revision;
      const at = this.now();
      if ("expectedRevision" in input) {
        if (plan.creatorId !== actor.id)
          fail(403, "Only the organizer can change this plan");
        if (revision !== input.expectedRevision)
          fail(409, "Plan changed. Refresh and review before trying again.");
      } else if (!plan.participantIds.includes(actor.id))
        fail(403, "Only invited participants can respond");
      let autoFinalized = false;
      switch (input.action) {
        case "edit_draft": {
          if (plan.state !== "draft")
            fail(409, "Only unpublished drafts can be edited here");
          const fields = input.fields;
          if (
            new Set(fields.participantIds).size !==
              fields.participantIds.length ||
            fields.participantIds.some(
              (id) => !room.members.some((m) => m.userId === id),
            )
          )
            fail(400, "Choose distinct accepted room members");
          this.deadline(fields.deadline);
          const slots = fields.slots.map((s) => ({
            ...resolveSlot(s, fields.timeZone),
            id: randomUUID(),
          }));
          this.futureSlots(slots);
          Object.assign(plan, fields, {
            slots,
            optionsVersion: plan.optionsVersion + 1,
          });
          break;
        }
        case "extend_deadline": {
          if (plan.state !== "collecting")
            fail(409, "Only collecting plans have a response deadline");
          this.deadline(input.deadline);
          if (plan.deadline === input.deadline) return planView(plan, actor);
          if (
            plan.deadline &&
            input.deadline &&
            Date.parse(input.deadline) <= Date.parse(plan.deadline)
          )
            fail(400, "Choose a later deadline, or remove it");
          plan.deadline = input.deadline;
          break;
        }
        case "add_participants": {
          if (plan.state === "draft")
            fail(409, "Edit draft participants before publishing");
          if (
            new Set(input.participantIds).size !==
              input.participantIds.length ||
            input.participantIds.some(
              (id) =>
                !room.members.some((m) => m.userId === id) ||
                plan.participantIds.includes(id),
            )
          )
            fail(400, "Choose new accepted room members");
          if (plan.participantIds.length + input.participantIds.length > 50)
            fail(422, "A plan supports up to 50 participants");
          if (plan.terms) this.futureSlots([plan.terms]);
          plan.participantIds.push(...input.participantIds);
          if (plan.terms) {
            plan.termsVersion++;
            plan.decisions = [];
            plan.confirmedIds = [];
            plan.state = "confirming";
          }
          break;
        }
        case "request_rejoin": {
          if (
            plan.state !== "confirmed" ||
            !plan.terms ||
            input.termsVersion !== plan.termsVersion
          )
            fail(409, "Review the current confirmed details before rejoining");
          this.futureSlots([plan.terms]);
          if (plan.confirmedIds.includes(actor.id))
            fail(409, "You are already attending");
          const old = plan.decisions.find((d) => d.userId === actor.id);
          if (!old || old.decision !== "declined")
            fail(409, "Only an opted-out participant can request to rejoin");
          if (old.version !== input.expectedDecisionVersion)
            fail(409, "Your decision changed. Refresh first.");
          old.decision = "accepted";
          old.termsVersion = plan.termsVersion;
          old.version++;
          old.at = at;
          break;
        }
        case "approve_rejoins": {
          if (plan.state !== "confirmed" || !plan.terms)
            fail(409, "The outing is not locked");
          this.futureSlots([plan.terms]);
          const pending = plan.decisions.filter(
            (d) =>
              d.termsVersion === plan.termsVersion &&
              d.decision === "accepted" &&
              !plan.confirmedIds.includes(d.userId),
          );
          if (!pending.length) fail(409, "No pending requests to rejoin");
          plan.confirmedIds.push(...pending.map((d) => d.userId));
          break;
        }
        case "withdraw": {
          if (
            plan.state !== "confirmed" ||
            input.termsVersion !== plan.termsVersion
          )
            fail(409, "Review the current confirmed outing before withdrawing");
          const decision = plan.decisions.find((d) => d.userId === actor.id);
          if (!decision || decision.version !== input.expectedDecisionVersion)
            fail(409, "Your attendance changed. Refresh before withdrawing.");
          if (
            !plan.confirmedIds.includes(actor.id) &&
            decision.decision !== "accepted"
          )
            fail(409, "You are not attending or awaiting rejoin approval");
          plan.confirmedIds = plan.confirmedIds.filter((id) => id !== actor.id);
          decision.decision = "declined";
          decision.version++;
          decision.at = at;
          if (!plan.confirmedIds.length) plan.state = "confirming";
          break;
        }
        case "clear_note": {
          const response = plan.responses.find((r) => r.userId === actor.id);
          if (!response?.privateNote) return planView(plan, actor);
          if (response.version !== input.expectedResponseVersion)
            fail(409, "Your note changed. Refresh before clearing.");
          response.privateNote = "";
          response.version++;
          response.updatedAt = at;
          break;
        }
        case "publish":
          if (plan.state !== "draft") fail(409, "Plan is already published");
          this.deadline(plan.deadline);
          this.futureSlots(plan.slots);
          plan.state = "collecting";
          break;
        case "respond": {
          if (plan.state !== "collecting")
            fail(409, "Availability collection is closed");
          if (plan.deadline && Date.parse(at) >= Date.parse(plan.deadline))
            fail(
              409,
              "Response deadline passed; ask the organizer to reopen options",
            );
          if (input.optionsVersion !== plan.optionsVersion)
            fail(409, "Options changed. Review the new options.");
          if (
            Object.keys(input.votes).length !== plan.slots.length ||
            plan.slots.some((s) => !input.votes[s.id])
          )
            fail(400, "Respond to every current option");
          const old = plan.responses.find((r) => r.userId === actor.id);
          if ((old?.version ?? 0) !== input.expectedResponseVersion)
            fail(
              409,
              "Your response changed on another device. Refresh first.",
            );
          plan.responses = plan.responses.filter((r) => r.userId !== actor.id);
          plan.responses.push({
            userId: actor.id,
            version: input.expectedResponseVersion + 1,
            votes: input.votes,
            budget: input.budget,
            privateNote: input.privateNote,
            updatedAt: at,
          });
          break;
        }
        case "propose": {
          if (!["collecting", "confirming", "confirmed"].includes(plan.state))
            fail(409, "Publish the plan first");
          const terms = {
            ...input.terms,
            ...resolveSlot(input.terms, input.terms.timeZone),
          };
          this.futureSlots([terms]);
          if (plan.terms && hash(plan.terms) === hash(terms))
            fail(409, "These details are already proposed");
          plan.terms = terms;
          plan.termsVersion++;
          plan.decisions = [];
          plan.confirmedIds = [];
          plan.state = "confirming";
          break;
        }
        case "decide": {
          if (
            plan.state !== "confirming" ||
            input.termsVersion !== plan.termsVersion
          )
            fail(409, "Review the current final details before responding");
          const old = plan.decisions.find((d) => d.userId === actor.id);
          if ((old?.version ?? 0) !== input.expectedDecisionVersion)
            fail(409, "Your decision changed. Refresh first.");
          plan.decisions = plan.decisions.filter((d) => d.userId !== actor.id);
          plan.decisions.push({
            userId: actor.id,
            decision: input.decision,
            termsVersion: input.termsVersion,
            version: input.expectedDecisionVersion + 1,
            at,
          });
          if (
            plan.participantIds.every((id) =>
              plan.decisions.some(
                (d) =>
                  d.userId === id &&
                  d.termsVersion === plan.termsVersion &&
                  d.decision === "accepted",
              ),
            )
          ) {
            this.futureSlots([plan.terms!]);
            plan.confirmedIds = [...plan.participantIds];
            plan.state = "confirmed";
            autoFinalized = true;
          }
          break;
        }
        case "finalize":
          if (plan.state === "confirmed") return planView(plan, actor);
          if (plan.state !== "confirming" || !plan.terms)
            fail(409, "Propose final details first");
          this.futureSlots([plan.terms]);
          plan.confirmedIds = plan.decisions
            .filter(
              (d) =>
                d.termsVersion === plan.termsVersion &&
                d.decision === "accepted",
            )
            .map((d) => d.userId);
          if (!plan.confirmedIds.length)
            fail(409, "At least one participant must explicitly accept");
          plan.state = "confirmed";
          break;
        case "rework":
          if (plan.state === "draft") fail(409, "Publish the draft first");
          this.deadline(input.deadline);
          plan.slots = input.slots.map((s) => ({
            ...resolveSlot(s, plan.timeZone),
            id: randomUUID(),
          }));
          this.futureSlots(plan.slots);
          plan.optionsVersion++;
          plan.termsVersion++;
          plan.responses = [];
          plan.decisions = [];
          plan.confirmedIds = [];
          plan.terms = null;
          plan.deadline = input.deadline;
          plan.state = "collecting";
          break;
        case "cancel":
          plan.state = "cancelled";
          break;
        case "complete":
          if (
            plan.state !== "confirmed" ||
            !plan.terms ||
            Date.parse(at) < Date.parse(plan.terms.endAt)
          )
            fail(409, "Complete the outing after its end time");
          plan.state = "completed";
          break;
      }
      plan.revision++;
      plan.updatedAt = at;
      plan.requests.push({
        id: input.clientId,
        actorId: actor.id,
        hash: fingerprint,
      });
      plan.history.push({
        id: randomUUID(),
        actorId: actor.id,
        action: autoFinalized ? "auto_finalize" : input.action,
        at,
        termsVersion: plan.termsVersion,
        ...(autoFinalized ||
        ["propose", "finalize", "approve_rejoins"].includes(input.action)
          ? { terms: plan.terms }
          : {}),
        ...(input.action === "decide" ? { decision: input.decision } : {}),
        ...(input.action === "add_participants"
          ? { participantIds: input.participantIds }
          : {}),
        ...(input.action === "extend_deadline"
          ? { deadline: plan.deadline }
          : {}),
        ...(input.action === "withdraw"
          ? { decision: "declined" as const, confirmedIds: plan.confirmedIds }
          : {}),
        ...(input.action === "finalize" ||
        input.action === "approve_rejoins" ||
        autoFinalized
          ? { confirmedIds: plan.confirmedIds }
          : {}),
      });
      if (
        (await this.collection.replaceOne({ id, roomId, revision }, plan))
          .matchedCount
      )
        return planView(plan, actor);
    }
    return fail(409, "Plan is busy. Retry with the same request ID.");
  }
}
