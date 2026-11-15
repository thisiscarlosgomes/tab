import { addressed, burstCandidates, registerBurst } from "./bursts";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { DinnerError, type Actor, type Message } from "../model";
import type { DinnerService } from "../service";
import type { DinnerAgentService } from "./service";

type Job = {
  _id: string;
  token: string;
  roomId: string;
  sourceId: string;
  userId: string;
  status: "queued" | "processing" | "complete" | "failed" | "cancelled";
  attempts: number;
  lease?: string;
  leaseUntil?: string;
  createdAt: string;
  lastError?: string;
};
export type JobDelivery = { jobId: string; token: string };
export class AgentJobs {
  constructor(
    private db: Db,
    private dinner: DinnerService,
    private agent: DinnerAgentService,
  ) {}
  async enqueue(
    actor: Actor,
    roomId: string,
    source: Message,
    publish: (delivery: JobDelivery) => Promise<void>,
  ) {
    const room = await this.dinner.memberRoom(roomId, actor);
    if (source.authorId !== actor.id || source.kind === "tab")
      throw new DinnerError(403, "Only your saved message can start a reply");
    if (room.assistance?.mode !== "smart" && !addressed(room, source) && !room.messages.some(root => root.authorId === actor.id && addressed(room, root) && burstCandidates(room, root).some(m => m.id === source.id))) return;
    if (addressed(room, source)) await registerBurst(this.db, roomId, actor.id, source.id);
    const jobs = this.db.collection<Job>("dinner-agent-jobs");
    const id = `${roomId}:${source.id}`;
    await jobs.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          _id: id,
          token: randomUUID(),
          roomId,
          sourceId: source.id,
          userId: actor.id,
          status: "queued",
          attempts: 0,
          createdAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    );
    const job = (await jobs.findOne({ _id: id }))!;
    if (["complete", "cancelled"].includes(job.status)) return;
    // Do not acknowledge delivery to the member until the durable queue accepts it.
    await publish({ jobId: id, token: job.token });
  }
  async process(delivery: JobDelivery) {
    const jobs = this.db.collection<Job>("dinner-agent-jobs");
    const existing = await jobs.findOne({
      _id: delivery.jobId,
      token: delivery.token,
    });
    if (!existing) throw new DinnerError(403, "Unknown agent work item");
    if (["complete", "cancelled"].includes(existing.status)) return;
    const lease = randomUUID();
    const job = await jobs.findOneAndUpdate(
      {
        _id: existing._id,
        $or: [
          { status: { $in: ["queued", "failed"] } },
          {
            status: "processing",
            leaseUntil: { $lt: new Date().toISOString() },
          },
        ],
      },
      {
        $set: {
          status: "processing",
          lease,
          leaseUntil: new Date(Date.now() + 180_000).toISOString(),
        },
        $inc: { attempts: 1 },
      },
      { returnDocument: "after" },
    );
    if (!job) throw new Error("Agent work is already in progress");
    const actor: Actor = {
      id: job.userId,
      name: "Member",
      twitterSubject: null,
    };
    try {
      const room = await this.dinner.memberRoom(job.roomId, actor);
      actor.name = room.members.find((m) => m.userId === actor.id)!.name;
      const source = room.messages.find(
        (m) =>
          m.id === job.sourceId && m.authorId === actor.id && m.kind !== "tab",
      );
      if (!source)
        throw new DinnerError(404, "Source message is no longer available");
      if (
        !room.messages.some((m) => m.kind === "tab" && m.runId === source.id)
      ) {
        const decision = await this.agent.assessRoomMessage(
          actor,
          room.id,
          source.id,
        );
        if (decision.action === "respond") {
          const result = await this.agent.respond(
            actor,
            { kind: "room", roomId: room.id },
            source.id,
          );
          if (!["complete", "coalesced"].includes(result.status))
            throw new Error("Agent reply is still running");
        }
      }
      await jobs.updateOne(
        { _id: job._id, lease },
        {
          $set: { status: "complete" },
          $unset: { lastError: "", lease: "", leaseUntil: "" },
        },
      );
    } catch (error) {
      const cancelled =
        error instanceof DinnerError && [403, 404].includes(error.status);
      await jobs.updateOne(
        { _id: job._id, lease },
        {
          $set: {
            status: cancelled ? "cancelled" : "failed",
            lastError: cancelled
              ? "Room access or message is no longer available"
              : "Reply interrupted; retry pending",
          },
          $unset: { lease: "", leaseUntil: "" },
        },
      );
      if (!cancelled) throw error;
    }
  }
}
