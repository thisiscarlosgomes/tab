import { z } from "zod";
import { agentQueue } from "@/lib/dinner/agent/queue";
import { AgentJobs } from "@/lib/dinner/agent/jobs";
import { getDinnerServices } from "@/lib/dinner/services";
export const maxDuration = 180;
export const runtime = "nodejs";
const delivery = z
  .object({ jobId: z.string().max(100), token: z.string().uuid() })
  .strict();
export const POST = agentQueue.handleCallback(
  async (payload) => {
    if (process.env.DINNER_ROOMS_ENABLED !== "true") return;
    const { db, service, agent } = await getDinnerServices();
    await new AgentJobs(db, service, agent).process(delivery.parse(payload));
  },
  {
    retry: (_error, metadata) =>
      metadata.deliveryCount >= 5
        ? { acknowledge: true }
        : { afterSeconds: Math.min(300, 30 * metadata.deliveryCount) },
  },
);
