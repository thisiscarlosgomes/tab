"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Proposal } from "@/lib/dinner/agent/model";
import { ChatBillReview } from "./ChatBillReview";
import { expenseSchema, roomSchema } from "@/lib/dinner/client-schema";
import { usd, type RoomView, type Expense } from "@/lib/dinner/model";
import { useDinner } from "./DinnerShell";
export function AgentCards({
  proposals,
  refresh,
  room,
}: {
  proposals: Proposal[];
  room?: RoomView;
  refresh: () => Promise<void>;
}) {
  const { api, me } = useDinner();
  const [review, setReview] = useState<{
    proposalId: string;
    expense: Expense;
    room: RoomView;
  } | null>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function save(proposal: Proposal, openReview = false, confirm = false) {
    setBusy(proposal.id);
    setError("");
    try {
      const expense = await api(
        `/agent/proposals/${proposal.id}/apply`,
        { method: "POST", body: JSON.stringify({ clientId: proposal.id }) },
        expenseSchema,
      );
      if (confirm) {
        const displayed = room?.expenses.find(e => e.id === proposal.appliedExpenseId);
        if (!displayed && (expense.description !== proposal.fields.description || expense.totalCents !== proposal.fields.totalCents || expense.payerId !== proposal.fields.payerId || JSON.stringify(expense.shares) !== JSON.stringify(proposal.fields.shares)))
          throw new Error("This bill changed. Refresh and check it before confirming.");
        await api(`/rooms/${proposal.roomId}/expenses/${expense.id}/confirm`, {
          method: "POST", body: JSON.stringify({ clientId: expense.id, expectedVersion: displayed?.version ?? expense.version }),
        }, expenseSchema);
      }
      if (openReview) {
        const current = await api(`/rooms/${proposal.roomId}`, {}, roomSchema);
        setReview({
          proposalId: proposal.id,
          expense: current.expenses.find((e) => e.id === expense.id) ?? expense,
          room: current,
        });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save draft");
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      {error && (
        <p role="alert" className="dinner-error">
          {error}
        </p>
      )}
      {proposals.map((p) => {
        const saved = !p.correctionOf
          ? room?.expenses.find((e) => e.id === p.appliedExpenseId)
          : undefined;
        if (saved?.status === "cancelled" && saved.deletedAt) return null;
        const fields = saved ?? p.fields;
        const members = room?.members ?? p.members;
        const confirmed = saved?.status === "confirmed";
        const cancelled = saved?.status === "cancelled";
        return (
          <article className="dinner-card dinner-agent-proposal" key={p.id}>
            <span className="dinner-chip">
              {cancelled
                ? "Cancelled"
                : confirmed
                  ? "Confirmed"
                  : "Draft"}
              {p.correctionOf ? " · expense correction" : ""}
            </span>
            <h3>
              {fields.description} · {usd(fields.totalCents)}
            </h3>
            <p className="dinner-note">
              Payer:{" "}
              {members.find((member) => member.userId === fields.payerId)
                ?.name ?? "Member"}
            </p>
            {fields.shares.map((share) => (
              <div className="dinner-pair" key={share.userId}>
                <span>
                  {members.find((member) => member.userId === share.userId)
                    ?.name ?? "Member"}
                </span>
                <strong>{usd(share.cents)}</strong>
              </div>
            ))}
            {p.sourcePlanId && <Link href={`/app/rooms/${p.roomId}?view=plan&plan=${p.sourcePlanId}`}>From completed outing ↗</Link>}
            <div className="dinner-actions">
              {room &&
              !p.correctionOf &&
              p.userId === me?.id &&
              !confirmed &&
              !cancelled ? (
                <>
                  <button disabled={!!busy} onClick={() => void save(p, false, true)}>
                    {busy === p.id ? "Updating…" : "Confirm"}
                  </button>
                  <button className="dinner-quiet" disabled={!!busy} onClick={(event) => { editTrigger.current = event.currentTarget; void save(p, true); }}>Edit</button>
                </>
              ) : p.appliedExpenseId ? null : p.userId === me?.id ? (
                <button disabled={!!busy} onClick={() => void save(p)}>
                  {busy === p.id ? "Saving…" : "Save editable draft"}
                </button>
              ) : (
                <span className="dinner-note">
                  Awaiting requester review
                </span>
              )}
              <Link href={`/app/rooms/${p.roomId}?view=money`}>
                View in Money ↗
              </Link>
            </div>
            {review?.proposalId === p.id && (
              <Dialog.Root open onOpenChange={(open) => { if (!open) setReview(null); }}>
                <Dialog.Portal>
                  <Dialog.Overlay className="chat-bill-modal-overlay" />
                  <Dialog.Content className="dinner-app chat-bill-modal" aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); editTrigger.current?.focus(); }}>
                    <Dialog.Title className="sr-only">Edit bill</Dialog.Title>
              <ChatBillReview
                key={review.expense.id}
                initial={review.expense}
                room={room ?? review.room}
                onClose={() => setReview(null)}
                onChange={async (expense) => {
                  await refresh();
                  if (expense.status !== "draft") setReview(null);
                }}
              />
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            )}
          </article>
        );
      })}
    </>
  );
}
