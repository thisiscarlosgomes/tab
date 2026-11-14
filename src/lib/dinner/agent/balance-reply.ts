import { z } from "zod";
import { obligationSchema, usd } from "../model";

export function isRoomBalanceQuestion(text: string) {
  const question = text
    .replace(/^\s*@tab\b\s*/i, "")
    .trim()
    .replace(/[?.!]+$/, "")
    .toLowerCase();
  return /^(who owes (whom|who|what)|what (do i owe|am i owed)|what(?:'s| is) (still )?pending|(?:show |what are )?(?:the |our |room )?(?:balances|outstanding debts))$/.test(
    question,
  );
}

/** Format authoritative ledger data without model arithmetic or narration. */
export function roomBalanceReply(raw: unknown) {
  const facts = z
    .object({
      members: z.array(z.object({ userId: z.string(), name: z.string() })),
      formerMembers: z
        .array(z.object({ userId: z.string(), name: z.string() }))
        .optional(),
      obligations: z.array(obligationSchema),
    })
    .parse(raw);
  const name = (id: string) => {
    const value =
      [...facts.members, ...(facts.formerMembers ?? [])].find(
        (m) => m.userId === id,
      )?.name ?? "Former member";
    return /^tab$/i.test(value) ? `The member “${value}”` : value;
  };
  const outstanding = facts.obligations.filter(
    (o) => o.status === "outstanding",
  );
  const lines = outstanding.map(
    (o) => `${name(o.debtorId)} owes ${name(o.creditorId)} ${usd(o.cents)}.`,
  );
  const pending = outstanding
    .flatMap((o) => o.outsideReports ?? [])
    .filter((r) => r.status === "pending").length;
  return (
    (lines.join("\n") || "No outstanding obligations are recorded.") +
    (pending
      ? `\n${pending} outside payment report(s) await confirmation in Money; these amounts remain outstanding.`
      : "") +
    "\nBased on confirmed expenses in Money; unconfirmed drafts are not included."
  );
}

/** Exact read-only greetings and ledger questions never need model routing. */
export function isTabGreeting(text: string) {
  return /^(?:hey|hi|hello|hiya|yo|good (?:morning|afternoon|evening))[,! ]+@?tab[.!? ]*$/i.test(text.trim());
}
export function isLocalRoomReply(text: string) {
  return isTabGreeting(text) || isRoomBalanceQuestion(text);
}
