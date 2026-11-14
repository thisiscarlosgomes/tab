import { randomUUID } from "node:crypto";
import { dependencies, sessions } from "./state";
import { labStatus, runRound, scenarioProgress } from "./live-lab";
const shared = globalThis as typeof globalThis & { tabTermsRunning?: boolean };
const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
export async function runTermsScenario(roomId: string) {
  if (shared.tabTermsRunning || labStatus().roomId !== roomId) return;
  shared.tabTermsRunning = true;
  const [maya, leo, nina] = sessions.slice(1).map(s => s.actor);
  let checks = 0;
  try {
    const original = await dependencies.plans.list(maya, roomId);
    let plan = original.find(p => p.title === "Saturday dinner" && p.state === "confirmed");
    if (!plan?.terms) throw new Error("Expected confirmed Saturday dinner");
    const other = original.find(p => p.id !== plan!.id);
    for (const field of ["time", "location", "budget"] as const) {
      const before = plan;
      const terms = { localStart: plan.terms!.localStart, localEnd: plan.terms!.localEnd,
        timeZone: plan.terms!.timeZone, location: plan.terms!.location, budgetCents: plan.terms!.budgetCents };
      if (field === "time") terms.localStart = terms.localStart.slice(0, 11) + "19:30";
      if (field === "location") terms.location = "Uptown vegetarian test cafe (simulated)";
      if (field === "budget") terms.budgetCents = 2400;
      const delayed = await dependencies.service.send(roomId, maya, {clientId: randomUUID(), text: "@Tab go ahead for Saturday dinner"});
      plan = await dependencies.plans.command(maya, roomId, plan.id, { action: "propose", clientId: randomUUID(), expectedRevision: plan.revision, terms });
      check(plan.state === "confirming" && !plan.decisions.length && !plan.confirmedIds.length, `${field}: old approval survived`);
      check(plan.termsVersion === before.termsVersion + 1, `${field}: version did not advance`);
      const stale = await dependencies.agent.respond(maya, {kind: "room", roomId}, delayed.id);
      check(stale.text.includes("details changed"), `${field}: delayed approval not rejected`);
      let rejected = false;
      try { await dependencies.plans.command(nina, roomId, plan.id, {action: "decide", clientId: randomUUID(), termsVersion: before.termsVersion, expectedDecisionVersion: 0, decision: "accepted"}); }
      catch (e) { if ((e as {status?: number}).status !== 409) throw e; rejected = true; }
      check(rejected, `${field}: stale decision accepted`);
      check((await dependencies.plans.get(maya, roomId, plan.id)).revision === plan.revision, `${field}: stale request mutated plan`);
      checks += 3;
      await dependencies.service.send(roomId, maya, {clientId: randomUUID(), text: `Rehearsal: the ${field} changed. Please check the new saved details and agree again; previous approvals no longer count.`});
      scenarioProgress(`Changed-terms test · ${checks} checks passed · fresh ${field} consent`);
      await runRound(undefined, "decide", [maya.id, leo.id, nina.id], plan.id);
      check(!labStatus().error, labStatus().error);
      plan = await dependencies.plans.get(maya, roomId, plan.id);
      check(plan.decisions.filter(d => d.decision === "accepted" && d.termsVersion === plan!.termsVersion).length === 3, `${field}: fresh consent missing`);
      const source = await dependencies.service.send(roomId, maya, {clientId: randomUUID(), text: "@Tab go ahead for Saturday dinner"});
      await dependencies.agent.respond(maya, {kind: "room", roomId}, source.id);
      plan = await dependencies.plans.get(maya, roomId, plan.id);
      const revision = plan.revision;
      await dependencies.agent.respond(maya, {kind: "room", roomId}, source.id);
      check(plan.state === "confirmed" && plan.confirmedIds.length === 3, `${field}: new terms did not lock`);
      check((await dependencies.plans.get(maya, roomId, plan.id)).revision === revision, `${field}: duplicate approval mutated state`);
      if (other) check((await dependencies.plans.get(maya, roomId, other.id)).revision === other.revision, `${field}: other plan changed`);
      checks += 3;
    }
    const room = await dependencies.service.memberRoom(roomId, maya);
    check(room.members.length === 5 && !room.expenses.length, "Unexpected membership or expense effects");
    scenarioProgress(`Changed-terms test passed · ${checks} checks · time, location and budget reapproved`);
  } catch (e) {
    scenarioProgress(`Changed-terms test needs attention: ${e instanceof Error ? e.message : "Unexpected error"}`);
  } finally { shared.tabTermsRunning = false; }
}
