import { runTermsScenario } from "../../../../terms-scenario";
import { after } from "next/server";
import { z } from "zod";
import { actor, sessions } from "../../../../state";
import { labStatus } from "../../../../live-lab";
import { createScenario, runScenario } from "../../../../scenario";
import { runCoordinatorScenario } from "../../../../coordinator-scenario";
import {
  runOptoutScenario,
  runWithdrawalScenario,
  runRejoinScenario,
} from "../../../../optout-scenario";
import {
  createBundleRoom,
  runBundle,
  bundleReport,
} from "../../../../bundle-scenario";
export async function GET(request: Request) {
  if (
    !labStatus().enabled ||
    (await actor(request)).id !== sessions[0].actor.id
  )
    return Response.json({ error: "Host only" }, { status: 403 });
  return Response.json(bundleReport());
}
import { runTargetScenario } from "../../../../target-scenario";
export async function POST(request: Request) {
  if (!labStatus().enabled)
    return Response.json({ error: "Local live lab only" }, { status: 404 });
  if ((await actor(request)).id !== sessions[0].actor.id)
    return Response.json({ error: "Host only" }, { status: 403 });
  const { action } = z
    .object({
      action: z.enum([
        "change-terms",
        "create-targets",
        "start-targets",
        "create-bundle",
        "start-bundle",
        "rejoin-after-lock",
        "withdraw-after-lock",
        "create-optout",
        "start-optout",
        "create",
        "start",
        "create-coordinator",
        "start-coordinator",
      ]),
    })
    .strict()
    .parse(await request.json());
  if (action === "create-targets")
    return Response.json({
      roomId: await createBundleRoom("Plans · two active dinners"),
    });
  if (action === "create-bundle")
    return Response.json({ roomId: await createBundleRoom() });
  if (
    action === "create" ||
    action === "create-coordinator" ||
    action === "create-optout"
  )
    return Response.json({
      roomId: await createScenario(
        action === "create-optout" ? "optout" : action === "create-coordinator",
      ),
    });
  const roomId = labStatus().roomId;
  after(() =>
    action === "change-terms"
      ? runTermsScenario(roomId)
      : action === "start-targets"
      ? runTargetScenario(roomId)
      : action === "start-bundle"
        ? runBundle(roomId)
        : action === "rejoin-after-lock"
          ? runRejoinScenario(roomId)
          : action === "withdraw-after-lock"
            ? runWithdrawalScenario(roomId)
            : action === "start-optout"
              ? runOptoutScenario(roomId)
              : action === "start-coordinator"
                ? runCoordinatorScenario(roomId)
                : runScenario(roomId),
  );
  return Response.json({ roomId, started: true });
}
