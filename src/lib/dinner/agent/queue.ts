import { QueueClient } from "@vercel/queue";
import type { JobDelivery } from "./jobs";
export const agentQueue = new QueueClient({ region: "iad1" });
export async function publishAgentJob(delivery: JobDelivery) {
  await agentQueue.send("tab-room-agent", delivery, {
    idempotencyKey: delivery.jobId,
    delaySeconds: 8,
    retentionSeconds: 86400,
  });
}
