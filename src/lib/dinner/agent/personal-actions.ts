import type { Actor } from "../model";
import type { Proposal } from "./model";
import { canDeleteSplit, usd } from "../model";
import type { DinnerService } from "../service";

/** Common read intents and explicit uniquely named bill cancellation need no model. */
export async function personalActionReply(dinner: DinnerService, actor: Actor, text: string, requestId: string, active: () => Promise<void>, reviews: () => Promise<Proposal[]> = async () => []) {
  const query = text.trim().replace(/[?.!]+$/, "").replace(/^(?:can|could|would) you (?:please )?/i, "");
  const roomsIntent = /^(?:(?:please )?(?:list|show)(?: me)? (?:all )?(?:my |the )?rooms|what rooms (?:am i in|do i have))$/i.test(query);
  const billsIntent = /^(?:(?:please )?(?:list|show)(?: me)? (?:all )?(?:my |the )?(?:pending )?bills|what(?:'s| is) (?:still )?pending|which bills are pending)$/i.test(query);
  const cancel = query.match(/^(?:please )?cancel (?:the |my )?(?:draft |bill )?(.+?)(?: bill| draft)?$/i);
  if (!roomsIntent && !billsIntent && !cancel) return null;
  await active();
  const rooms = (await dinner.financialRooms(actor)).filter(r => r.members.some(m => m.userId === actor.id));
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
  const name = cancel![1].replace(/^["“']|["”']$/g, "").trim().toLocaleLowerCase();
  const matches = bills.filter(({expense}) => expense.description.toLocaleLowerCase() === name || expense.id === name);
  if (matches.length !== 1) return matches.length ? "More than one bill has that name. Use the bill's ID so I cancel the right one." : "Which saved bill should I cancel? Send its exact name or bill ID.";
  const {room,expense} = matches[0];
  if (expense.creatorId !== actor.id) return "Only the bill's creator can cancel it.";
  if (expense.status === "cancelled") return `${expense.description} is already cancelled.`;
  if (expense.status === "confirmed" && !canDeleteSplit(expense)) return "That bill has a pending payment report or recorded repayment, so I can't cancel it. Review it in Money; I haven't changed it.";
  await active();
  if (expense.status === "draft") await dinner.cancelDraft(room.id, actor, expense.id, requestId, expense.version);
  else await dinner.deleteSplit(room.id, actor, expense.id, requestId, expense.version);
  return `Cancelled ${expense.description} in ${room.name}. No payment was made.`;
}
