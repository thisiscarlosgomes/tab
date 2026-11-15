import type { Actor } from "../model";
import type { Proposal } from "./model";
import { canDeleteSplit, usd } from "../model";
import type { DinnerService } from "../service";

/** Common read intents and explicit uniquely named bill cancellation need no model. */
export async function personalActionReply(dinner: DinnerService, actor: Actor, text: string, requestId: string, active: () => Promise<void>, reviews: () => Promise<Proposal[]> = async () => [], roomId?: string) {
  const query = (roomId ? text.replace(/^\s*@?tab[,:]?\s+/i, "") : text).trim().replace(/[?.!]+$/, "").replace(/^(?:can|could|would) you (?:please )?/i, "");
  const roomsIntent = /^(?:(?:please )?(?:list|show)(?: me)? (?:all )?(?:my |the )?rooms|what rooms (?:am i in|do i have))$/i.test(query);
  const billsIntent = /^(?:(?:please )?(?:list|show)(?: me)? (?:all )?(?:my |the )?(?:pending )?bills|what(?:'s| is) (?:still )?pending|which bills are pending)$/i.test(query);
  const rename = query.match(/^(?:please )?rename (?:the |my )?(?:bill |draft )?(.+?) to ["“](.+)["”]$/i);
  const total = query.match(/^(?:please )?(?:change|set) (?:the |my )?(?:bill |draft )?(.+?) total to \$(\d+(?:\.\d{1,2})?)(?:[, ]+split equally)?$/i);
  const payer = query.match(/^(?:please )?change (?:the )?payer for (?:the |my )?(?:bill |draft )?(.+?) to (.+)$/i);
  const edit = rename ?? total ?? payer;
  const confirm = query.match(/^(?:please )?confirm (?:the |my )?(?:draft |bill )?(.+?)(?: bill| draft)?$/i);
  const cancel = query.match(/^(?:please )?cancel (?:the |my )?(?:draft |bill )?(.+?)(?: bill| draft)?$/i);
  if (((roomsIntent || billsIntent) && roomId) || (!roomsIntent && !billsIntent && !cancel && !confirm && !edit)) return null;
  await active();
  const rooms = (roomId ? [await dinner.memberRoom(roomId, actor)] : await dinner.financialRooms(actor)).filter(r => r.members.some(m => m.userId === actor.id));
  if (roomsIntent) return rooms.length ? `Your rooms: ${rooms.map(r => r.name).join(", ")}.` : "You haven't joined any rooms yet.";
  const bills = rooms.flatMap(room => room.expenses.map(expense => ({room, expense})));
  if (billsIntent) {
    const pending = /pending/i.test(query);
    const found = bills.filter(({expense:e}) => e.status !== "cancelled" && (!pending || e.status === "draft" || e.obligations?.some(o => o.status === "outstanding")));
    const pendingReviews = (await reviews()).filter(p => !p.appliedExpenseId && rooms.some(r => r.id === p.roomId));
    const lines = found.map(({room,expense:e}) => `${e.description} — ${usd(e.totalCents)} in ${room.name}, ${e.status === "draft" ? "awaiting confirmation" : (e.status === "confirmed" && e.obligations.some(o => o.status === "outstanding")) ? "awaiting payment" : "settled"}.`);
    lines.push(...pendingReviews.map(p => `${p.fields.description} — ${usd(p.fields.totalCents)}, awaiting your review; not saved as a bill yet.`));
    return lines.length ? lines.join(" ") : pending ? "No pending bills or reviews in your rooms." : "No bills or pending reviews in your rooms.";
  }
  const name = (edit ?? cancel ?? confirm)![1].replace(/^["“']|["”']$/g, "").trim().toLocaleLowerCase();
  const matches = bills.filter(({expense}) => expense.description.toLocaleLowerCase() === name || expense.id === name);
  // Leave planning consent and unfinished bill-task commands to their own handlers.
  if (roomId && matches.length === 0) return null;
  if (matches.length !== 1) return matches.length ? "More than one bill has that name. Send its bill ID so I change the right one." : "Which saved bill do you mean? Send its exact name or bill ID.";
  const {room,expense} = matches[0];
  if (expense.creatorId !== actor.id) return "Only the bill's creator can change it.";
  if (edit) {
    if (expense.status !== "draft") return expense.status === "cancelled"
      ? `${expense.description} was cancelled. Create a new bill to change it.`
      : "That bill is already confirmed. Ask me to prepare a correction, then review and accept it in Money; I haven't changed the recorded shares.";
    let description = expense.description;
    let totalCents = expense.totalCents;
    let payerId = expense.payerId;
    let shares = expense.shares;
    if (rename) description = rename[2].trim();
    if (total) {
      if (!/split equally$/i.test(query)) return "Should I split the new total equally among the existing participants? Send the bill name, total, and ‘split equally’, or give the exact shares.";
      totalCents = Math.round(Number(total[2]) * 100);
      if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents > 100_000_000) return "Send a USD total between $0.01 and $1,000,000, with at most two decimal places.";
      const base = Math.floor(totalCents / shares.length);
      shares = shares.map((share, i) => ({ userId: share.userId, cents: base + (i < totalCents % shares.length ? 1 : 0) }));
    }
    if (payer) {
      const name = payer[2].trim().toLowerCase();
      const candidates = room.members.filter(m => m.name.toLowerCase() === name || m.userId === name);
      if (candidates.length !== 1) return "Which current member paid? Send their exact name or member ID.";
      payerId = candidates[0].userId;
    }
    const reply = `Updated ${description} to ${usd(totalCents)}${total ? ", split equally among the existing participants" : payer ? `, paid by ${payer[2].trim()}` : ""}. It's still a draft.`;
    await active();
    await dinner.draft(room.id, actor, { clientId: requestId, description, totalCents, payerId, shares,
      ...(expense.attachmentId ? { attachmentId: expense.attachmentId } : {}) }, expense.id, expense.version, undefined,
      roomId ? { sourceId: requestId, text: reply } : undefined);
    return reply;
  }
  if (confirm) {
    if (expense.status === "confirmed") return `${expense.description} is already confirmed.`;
    if (expense.status === "cancelled") return `${expense.description} was cancelled. Create a new bill if you want to use it again.`;
    await active();
    const reply = `Confirmed ${expense.description} for ${usd(expense.totalCents)}. The split is recorded; no payment was made.`;
    await dinner.confirm(room.id, actor, expense.id, requestId, expense.version, roomId ? { sourceId: requestId, text: reply } : undefined);
    return reply;
  }
  if (expense.status === "cancelled") return `${expense.description} is already cancelled.`;
  if (expense.status === "confirmed" && !canDeleteSplit(expense)) return "That bill has a pending payment report or recorded repayment, so I can't cancel it. Review it in Money; I haven't changed it.";
  await active();
  const reply = `Cancelled ${expense.description}. No payment was made.`;
  const chat = roomId ? { sourceId: requestId, text: reply } : undefined;
  if (expense.status === "draft") await dinner.cancelDraft(room.id, actor, expense.id, requestId, expense.version, chat);
  else await dinner.deleteSplit(room.id, actor, expense.id, requestId, expense.version, chat);
  return reply;
}
