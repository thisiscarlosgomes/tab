"use client";
import { useState } from "react";
import { expenseSchema, roomSchema } from "@/lib/dinner/client-schema";
import {
  parseUsd,
  splitEvenly,
  usd,
  type Expense,
  type RoomView,
} from "@/lib/dinner/model";
import { useDinner } from "./DinnerShell";

export function ChatBillReview({
  initial,
  room,
  onChange,
  onClose,
}: {
  initial: Expense;
  room: RoomView;
  onChange: (expense: Expense) => Promise<void>;
  onClose: () => void;
}) {
  const { api } = useDinner();
  const [base, setBase] = useState(initial);
  const [description, setDescription] = useState(initial.description);
  const [total, setTotal] = useState((initial.totalCents / 100).toFixed(2));
  const [payer, setPayer] = useState(initial.payerId);
  const [shares, setShares] = useState<Record<string, string>>(
    Object.fromEntries(
      initial.shares.map((s) => [s.userId, (s.cents / 100).toFixed(2)]),
    ),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = room.expenses.find((e) => e.id === base.id);
  const stale =
    !!latest &&
    (latest.version > base.version ||
      (latest.status !== "draft" && base.status === "draft"));
  const locked = busy || stale || base.status !== "draft";
  const selected = Object.keys(shares);
  const activeIds = new Set(room.members.map((member) => member.userId));
  const reviewMembers = [
    ...room.members,
    ...selected
      .filter((id) => !activeIds.has(id))
      .map((userId) => ({
        userId,
        name: `${room.removals?.find((member) => member.userId === userId)?.name ?? "Former member"} (removed)`,
      })),
  ];
  const cents = parseUsd(total);
  const parsed = selected.map((userId) => ({
    userId,
    cents: parseUsd(shares[userId]),
  }));
  const valid =
    activeIds.has(payer) &&
    selected.every((id) => activeIds.has(id)) &&
    !!description.trim() &&
    !!cents &&
    selected.length > 0 &&
    parsed.every((s) => s.cents !== null) &&
    parsed.reduce((sum, s) => sum + (s.cents ?? 0), 0) === cents;
  function reset(expense: Expense) {
    setBase(expense);
    setDescription(expense.description);
    setTotal((expense.totalCents / 100).toFixed(2));
    setPayer(expense.payerId);
    setShares(
      Object.fromEntries(
        expense.shares.map((s) => [s.userId, (s.cents / 100).toFixed(2)]),
      ),
    );
    setDirty(false);
  }
  async function reload() {
    setBusy(true);
    try {
      const fresh = await api(`/rooms/${room.id}`, {}, roomSchema);
      const expense = fresh.expenses.find((e) => e.id === base.id);
      if (!expense) throw new Error("Bill not found");
      reset(expense);
      setError("");
      await onChange(expense);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reload bill");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (
      locked ||
      !window.confirm(
        "Cancel this draft bill? Its history stays visible. No money will move.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const expense = await api(
        `/rooms/${room.id}/expenses/${base.id}/cancel`,
        {
          method: "POST",
          body: JSON.stringify({
            clientId: base.id,
            expectedVersion: base.version,
          }),
        },
        expenseSchema,
      );
      reset(expense);
      await onChange(expense);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel bill");
    } finally {
      setBusy(false);
    }
  }
  async function act() {
    if (locked || !valid || !dirty) return;
    setBusy(true);
    setError("");
    try {
      const expense = await api(
        `/rooms/${room.id}/expenses/${base.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            clientId: base.clientId, expectedVersion: base.version, description,
            payerId: payer, totalCents: cents, shares: parsed,
            ...(base.attachmentId ? { attachmentId: base.attachmentId } : {}),
          }),
        },
        expenseSchema,
      );
      reset(expense);
      await onChange(expense);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update bill");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="chat-bill-review" aria-label="Edit bill">
      <div className="dinner-actions">
        <h3>Edit bill</h3>
        <button
          type="button"
          className="dinner-quiet"
          disabled={busy}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      {base.status === "cancelled" ? (
        <p role="status">Bill cancelled. No debt or payment was created.</p>
      ) : base.status === "confirmed" ? (
        <p role="status">
          Bill confirmed · {usd(base.totalCents)}. Recorded in Money. No payment
          was sent.
        </p>
      ) : (
        <>
          {stale && (
            <p role="alert" className="dinner-error">
              This bill changed. Reload it before continuing.
            </p>
          )}
          <fieldset className="dinner-form" disabled={locked}>
            <label>
              Bill description
              <input
                value={description}
                maxLength={120}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
            <div className="dinner-grid equal">
              <label>
                Total (USD)
                <input
                  inputMode="decimal"
                  value={total}
                  onChange={(e) => {
                    const nextTotal = parseUsd(e.target.value);
                    const values = parsed.map(share => share.cents);
                    if (nextTotal && selected.length && values.every((value): value is number => value !== null) && Math.max(...values) - Math.min(...values) <= 1) {
                      setShares(Object.fromEntries(splitEvenly(nextTotal, selected).map(share => [share.userId, (share.cents / 100).toFixed(2)])));
                    }
                    setTotal(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label>
                Paid by
                <select
                  value={activeIds.has(payer) ? payer : ""}
                  onChange={(e) => {
                    setPayer(e.target.value);
                    setDirty(true);
                  }}
                >
                  <option value="" disabled>
                    Select payer
                  </option>
                  {room.members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="dinner-actions">
              <strong>Participants and shares</strong>
              <button
                type="button"
                className="dinner-quiet"
                disabled={!cents || !selected.length}
                onClick={() => {
                  if (!cents) return;
                  setShares(
                    Object.fromEntries(
                      splitEvenly(cents, selected).map((s) => [
                        s.userId,
                        (s.cents / 100).toFixed(2),
                      ]),
                    ),
                  );
                  setDirty(true);
                }}
              >
                Split equally
              </button>
            </div>
            {reviewMembers.map((m) => (
              <div className="dinner-pair" key={m.userId}>
                <label className="chat-bill-person">
                  <input
                    type="checkbox"
                    checked={m.userId in shares}
                    onChange={(e) => {
                      setShares((previous) => {
                        const next = { ...previous };
                        if (e.target.checked) next[m.userId] = "0.00";
                        else delete next[m.userId];
                        return next;
                      });
                      setDirty(true);
                    }}
                  />
                  {m.name}
                </label>
                {m.userId in shares && (
                  <input
                    className="chat-bill-share"
                    aria-label={`${m.name} share in USD`}
                    inputMode="decimal"
                    value={shares[m.userId]}
                    onChange={(e) => {
                      setShares({ ...shares, [m.userId]: e.target.value });
                      setDirty(true);
                    }}
                  />
                )}
              </div>
            ))}
          </fieldset>
          {!valid && (
            <p className="dinner-error">
              Select participants and make their shares add up exactly to the
              total.
            </p>
          )}
          <div className="dinner-actions">
            <button
              type="button"
              className="dinner-quiet"
              disabled={locked}
              onClick={() => void cancel()}
            >
              Cancel bill
            </button>
            {dirty && (
              <button
                type="button"
                disabled={locked || !valid}
                onClick={() => void act()}
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            )}

          </div>
        </>
      )}
      {error && (
        <p role="alert" className="dinner-error">
          {error}
        </p>
      )}
      {(stale || error) && (
        <button
          type="button"
          className="dinner-quiet"
          disabled={busy}
          onClick={() => void reload()}
        >
          Reload bill
        </button>
      )}
    </section>
  );
}
