import { z } from "zod";
import { entityId, Obligation, usd } from "../model";

/** Read-only projections the room agent can use. Nothing here writes, sends, or settles. */
type Facts = {
  members: { userId: string; name: string }[];
  obligations: Obligation[];
};
export type MemberSummary = {
  userId: string;
  name: string;
  oweCents: number;
  owedCents: number;
  pendingOutsideReports: number;
};
export function memberSummary(facts: Facts) {
  const members: MemberSummary[] = facts.members.map(({ userId, name }) => ({
    userId,
    name,
    oweCents: 0,
    owedCents: 0,
    pendingOutsideReports: 0,
  }));
  const find = (id: string) => members.find((m) => m.userId === id);
  for (const o of facts.obligations) {
    if (o.status !== "outstanding") continue;
    const debtor = find(o.debtorId);
    const creditor = find(o.creditorId);
    if (debtor) debtor.oweCents += o.cents;
    if (creditor) creditor.owedCents += o.cents;
    if (debtor && (o.outsideReports ?? []).some((r) => r.status === "pending"))
      debtor.pendingOutsideReports += 1;
  }
  return {
    members,
    notice:
      "Outstanding shared obligations, not cash. A pending outside report stays outstanding until the creditor confirms it in Money.",
  };
}
export const nudgeInput = z
  .object({
    roomId: entityId,
    debtorId: entityId,
    tone: z.enum(["friendly", "brief"]).default("friendly"),
  })
  .strict();
export type NudgeDraft = {
  kind: "nudge_draft";
  debtorId: string;
  debtorName: string;
  text: string;
  sent: false;
  notice: string;
};
/** Prepares reminder wording for a human to copy or send. It is never posted or delivered by Tab. */
export function draftNudge(
  facts: Facts & { name: string },
  requesterId: string,
  input: z.infer<typeof nudgeInput>,
): NudgeDraft {
  const debtor = facts.members.find((m) => m.userId === input.debtorId);
  if (!debtor) throw new Error("Nudges can only address room members");
  const lines = facts.obligations.filter(
    (o) =>
      o.status === "outstanding" &&
      o.debtorId === debtor.userId &&
      o.creditorId === requesterId,
  );
  const cents = lines.reduce((sum, o) => sum + o.cents, 0);
  const pending = lines.some((o) =>
    (o.outsideReports ?? []).some((r) => r.status === "pending"),
  );
  const base = !cents
    ? `${debtor.name} has no outstanding share owed to you in ${facts.name}.`
    : pending
      ? `Hi ${debtor.name}, I see you reported paying ${usd(cents)} for ${facts.name} outside Tab. I'll confirm in Money once I see it.`
      : input.tone === "brief"
        ? `Hi ${debtor.name}, ${usd(cents)} for ${facts.name} is still open in Tab.`
        : `Hey ${debtor.name}! Quick reminder: your ${usd(cents)} share for ${facts.name} is still open. Pay me however works, then tap Report paid outside Tab. Thanks!`;
  return {
    kind: "nudge_draft",
    debtorId: debtor.userId,
    debtorName: debtor.name,
    text: base,
    sent: false,
    notice:
      "Draft only. Tab did not send this. The requester can copy and send it themselves.",
  };
}
