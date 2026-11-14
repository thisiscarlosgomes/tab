"use client";
import { canDeleteSplit } from "@/lib/dinner/model";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import Link from "next/link";
import { planSchema, type PlanView } from "@/lib/dinner/plans/model";
import {
  Expense,
  Correction,
  correctionSchema,
  memberName,
  RoomView,
  obligations,
  parseUsd,
  splitEvenly,
  totals,
  usd,
} from "@/lib/dinner/model";
import { expenseSchema } from "@/lib/dinner/client-schema";
import { useDinner } from "./DinnerShell";
import { OutsidePayments } from "./OutsidePayments";
import { Corrections } from "./Corrections";
import { PrivateImage } from "./PrivateImage";

export function OutingMoney({
  room,
  refresh,
  planId,
}: {
  room: RoomView;
  refresh: () => Promise<void>;
  planId: string;
}) {
  const { api } = useDinner();
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setPlan(null);
    setError("");
    void api(`/rooms/${room.id}/plans/${planId}`, {}, planSchema)
      .then((p) => {
        if (!active) return;
        if (p.state !== "completed")
          setError("Complete this outing before preparing its expense.");
        else setPlan(p);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not load outing");
      });
    return () => {
      active = false;
    };
  }, [api, room.id, planId, attempt]);
  const linked = room.expenses.find((e) => e.sourcePlanId === planId);
  return (
    <>
      <Link href={`/app/rooms/${room.id}?view=plan&plan=${planId}`}>
        ← Back to outing
      </Link>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      ) : !plan ? (
        <p role="status">Opening outing expense…</p>
      ) : (
        <>
          {linked && (
            <p role="status">
              This outing already has an expense below. Review it in Money.
            </p>
          )}
          <Money
            key={`${plan.id}-${linked?.id ?? "new"}`}
            room={room}
            refresh={refresh}
            source={linked ? undefined : plan}
          />
        </>
      )}
    </>
  );
}

export function Money({
  room,
  refresh,
  source,
}: {
  room: RoomView;
  refresh: () => Promise<void>;
  source?: PlanView;
}) {
  const { api, me } = useDinner();
  const [showForm, setShowForm] = useState(!!source);
  const [fromOuting, setFromOuting] = useState(!!source);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [description, setDescription] = useState(source?.title ?? "");
  const [total, setTotal] = useState("");
  const [payer, setPayer] = useState(source ? "" : (me?.id ?? ""));
  const [selected, setSelected] = useState<string[]>(
    source?.confirmedIds ?? [],
  );
  const [shares, setShares] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState("");
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [flagging, setFlagging] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [busy, setBusy] = useState(false);
  const name = (id: string) => memberName(room, id);
  function even(amount: string, ids: string[]) {
    const cents = parseUsd(amount);
    if (cents !== null)
      setShares(
        Object.fromEntries(
          splitEvenly(cents, ids).map((s) => [
            s.userId,
            (s.cents / 100).toFixed(2),
          ]),
        ),
      );
  }
  function start(expense?: Expense, correction?: Correction) {
    const fields = correction?.fields ?? expense;
    setFromOuting(false);
    setEditing(expense ?? null);
    setDescription(fields?.description ?? "");
    setTotal(fields ? (fields.totalCents / 100).toFixed(2) : "");
    setPayer(fields?.payerId ?? me?.id ?? "");
    const ids = fields?.shares.map((s) => s.userId) ?? [];
    setSelected(ids);
    setShares(
      Object.fromEntries(
        fields?.shares.map((s) => [s.userId, (s.cents / 100).toFixed(2)]) ?? [],
      ),
    );
    setReceipt(fields?.attachmentId ?? "");
    setClientId(
      expense?.status === "draft" ? expense.clientId : crypto.randomUUID(),
    );
    setError("");
    setShowForm(true);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const totalCents = parseUsd(total);
    if (!totalCents || !selected.length || !payer) {
      setError(
        "Enter the actual USD amount, choose who paid and select at least one accepted participant.",
      );
      return;
    }
    const parsed = selected.map((userId) => ({
      userId,
      cents: parseUsd(shares[userId] ?? ""),
    }));
    if (
      parsed.some((s) => s.cents === null) ||
      parsed.reduce((sum, s) => sum + (s.cents ?? 0), 0) !== totalCents
    ) {
      setError(
        "Shares must be valid USD amounts and add up exactly to the total.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(
        fromOuting && source
          ? `/rooms/${room.id}/plans/${source.id}/expense`
          : `/rooms/${room.id}/expenses${editing ? `/${editing.id}${editing.status === "confirmed" ? "/corrections" : ""}` : ""}`,
        {
          method: editing?.status === "draft" ? "PATCH" : "POST",
          body: JSON.stringify({
            clientId,
            ...(editing
              ? { expectedVersion: editing.version }
              : {}),
            description,
            totalCents,
            payerId: payer,
            shares: parsed,
            ...(receipt ? { attachmentId: receipt } : {}),
          }),
        },
        z.union([expenseSchema, correctionSchema]),
      );
      setShowForm(false);
      setFromOuting(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save draft");
    } finally {
      setBusy(false);
    }
  }
  async function deleteSplit(expense: Expense) {
    if (!window.confirm(`Delete “${expense.description}”? This removes its outstanding balances for everyone. No money moves.`)) return;
    setBusy(true); setError("");
    try {
      await api(`/rooms/${room.id}/expenses/${expense.id}/delete`, { method: "POST", body: JSON.stringify({ clientId: expense.id, expectedVersion: expense.version }) }, expenseSchema);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete split"); }
    finally { setBusy(false); }
  }
  async function cancelDraft(expense: Expense) {
    if (!window.confirm("Cancel this draft bill? Its history stays visible. No money will move.")) return;
    setBusy(true); setError("");
    try {
      await api(`/rooms/${room.id}/expenses/${expense.id}/cancel`, { method: "POST", body: JSON.stringify({ clientId: expense.id, expectedVersion: expense.version }) }, expenseSchema);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not cancel bill"); }
    finally { setBusy(false); }
  }
  async function confirm(expense: Expense) {
    setBusy(true);
    setError("");
    try {
      await api(
        `/rooms/${room.id}/expenses/${expense.id}/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            clientId: expense.id,
            expectedVersion: expense.version,
          }),
        },
        expenseSchema,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not confirm expense");
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function flag(expense: Expense) {
    const reason = flagReason;
    if (!reason?.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/rooms/${room.id}/expenses/${expense.id}/flag`,
        { method: "POST", body: JSON.stringify({ reason }) },
        z.unknown(),
      );
      setFlagging(null);
      setFlagReason("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not flag share");
    } finally {
      setBusy(false);
    }
  }
  const sum = totals(room, me?.id ?? "");
  const pairs = new Map<string, { from: string; to: string; cents: number }>();
  for (const o of obligations(room).filter((o) => o.status === "outstanding")) {
    const key = `${o.debtorId}:${o.creditorId}`;
    const previous = pairs.get(key);
    pairs.set(key, {
      from: o.debtorId,
      to: o.creditorId,
      cents: (previous?.cents ?? 0) + o.cents,
    });
  }
  const formMembers = [
    ...room.members,
    ...(editing?.status === "confirmed"
      ? (room.removals ?? []).filter(
          (m, i, all) =>
            !room.members.some((a) => a.userId === m.userId) &&
            all.findIndex((a) => a.userId === m.userId) === i &&
            (editing.payerId === m.userId ||
              editing.shares.some((s) => s.userId === m.userId)),
        )
      : []),
  ];
  const imageIds = [...new Set(room.messages.flatMap((m) => m.attachmentIds))];
  return (
    <div className="dinner-stack">
      <section className="dinner-card soft">
        <div className="dinner-heading">
          <h2>The shared tab</h2>
          <button onClick={() => start()}>+ Add expense</button>
        </div>
        <div className="dinner-money-row">
          <div>
            <p>You owe</p>
            <p className="dinner-amount">{usd(sum.owe)}</p>
          </div>
          <div>
            <p>Owed to you</p>
            <p className="dinner-amount">{usd(sum.owed)}</p>
          </div>
        </div>
        <p className="dinner-note">
          These are recorded obligations, not available cash. Nothing is paid,
          collected or debited here.
        </p>
      </section>
      {error && (
        <div role="alert" className="dinner-error">
          {error}
        </div>
      )}
      {showForm && (
        <section className="dinner-card">
          <h2>
            {editing?.status === "confirmed"
              ? "Correct this expense"
              : editing
              ? "Edit expense draft"
              : fromOuting
                ? "Expense from completed outing"
                : "Add an expense"}
          </h2>
          {fromOuting && (
            <p className="dinner-note">
              Confirmed attendees are selected as a starting point. Check who
              actually shared the cost, enter the actual bill and choose who
              paid. The plan budget is only an estimate.
            </p>
          )}
          <form className="dinner-form" onSubmit={save}>
            <label>
              What was it for?
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                maxLength={120}
                placeholder="Dinner at the neighborhood spot"
              />
            </label>
            <div className="dinner-grid equal">
              <label>
                Total (USD)
                <input
                  value={total}
                  onChange={(e) => {
                    setTotal(e.target.value);
                    even(e.target.value, selected);
                  }}
                  inputMode="decimal"
                  placeholder="120.00"
                  required
                />
              </label>
              <label>
                Who paid?
                <select
                  aria-label="Who paid?"
                  required
                  value={payer}
                  onChange={(e) => setPayer(e.target.value)}
                >
                  <option value="" disabled>Choose who paid</option>
                  {formMembers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <div className="dinner-heading" style={{ marginBottom: 8 }}>
                <h3>Who is included?</h3>
                <button
                  type="button"
                  className="dinner-small dinner-quiet"
                  onClick={() => even(total, selected)}
                >
                  Split evenly
                </button>
              </div>
              <p className="dinner-note">
                Select accepted members only. Pending invitees are never added
                automatically. Corrections may retain or reduce a removed
                member’s existing share; they cannot add debt to that person.
              </p>
              {formMembers.map((m) => (
                <div className="dinner-share" key={m.userId}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(m.userId)}
                      onChange={(e) => {
                        const ids = e.target.checked
                          ? [...selected, m.userId]
                          : selected.filter((id) => id !== m.userId);
                        setSelected(ids);
                        even(total, ids);
                      }}
                    />
                    {m.name}
                  </label>
                  <label>
                    <span className="sr-only">{m.name}’s share in USD</span>
                    <input
                      disabled={!selected.includes(m.userId)}
                      inputMode="decimal"
                      value={
                        selected.includes(m.userId)
                          ? (shares[m.userId] ?? "")
                          : ""
                      }
                      onChange={(e) =>
                        setShares((values) => ({
                          ...values,
                          [m.userId]: e.target.value,
                        }))
                      }
                      placeholder="0.00"
                    />
                  </label>
                </div>
              ))}
            </div>
            {imageIds.length > 0 && (
              <label>
                Receipt from this room (optional)
                <select
                  value={receipt}
                  onChange={(e) => setReceipt(e.target.value)}
                >
                  <option value="">No receipt</option>
                  {imageIds.map((id, index) => (
                    <option key={id} value={id}>
                      Shared image {index + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="dinner-note">
              {editing?.status === "confirmed"
                ? "Save the proposal, then review before accepting. Unconfirmed corrections do not change balances. No payment is authorized."
                : "Save first, then review before confirming. Drafts do not create obligations. Recording a share never authorizes payment."}
            </p>
            <div className="dinner-actions">
              <button disabled={busy} type="submit">
                {busy
                  ? "Saving…"
                  : editing?.status === "confirmed"
                    ? "Save correction proposal"
                    : "Save draft"}
              </button>
              <button
                type="button"
                className="dinner-quiet"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="dinner-card">
        <h2>Who owes whom</h2>
        {pairs.size ? (
          [...pairs.entries()].map(([key, p]) => (
            <div key={key} className="dinner-pair">
              <span>
                {name(p.from)} owes {name(p.to)}
              </span>
              <strong>{usd(p.cents)}</strong>
            </div>
          ))
        ) : (
          <p className="dinner-note">
            No outstanding shares. “Report paid outside Tab” appears after you
            confirm a shared expense with someone else. A one-person expense
            creates no debt to yourself. Add accepted members, create a split in
            Money, then confirm it; reports still need the creditor’s explicit
            receipt confirmation.
          </p>
        )}
      </section>
      {room.expenses
        .filter(expense => !(expense.status === "cancelled" && expense.deletedAt))
        .slice()
        .reverse()
        .map((expense) => (
          <section key={expense.id} className="dinner-card">
            <div className="dinner-heading">
              <div>
                <span className="dinner-chip">
                  {expense.status === "cancelled" ? "Cancelled bill" : expense.status === "draft"
                    ? "Unconfirmed draft"
                    : "Confirmed expense · obligation record"}
                </span>
                <h2 style={{ marginTop: 12, marginBottom: 6 }}>
                  {expense.description}
                </h2>
                <p className="dinner-note">
                  Recorded by {name(expense.creatorId)} · Paid originally by{" "}
                  {name(expense.payerId)}
                </p>
              </div>
              <div style={{ fontSize: 28, fontVariantNumeric: "tabular-nums" }}>
                {usd(expense.totalCents)}
              </div>
            </div>
            {expense.sourcePlanId && (
              <Link
                href={`/app/rooms/${room.id}?view=plan&plan=${expense.sourcePlanId}`}
              >
                From completed outing ↗
              </Link>
            )}
            {expense.attachmentId && (
              <PrivateImage roomId={room.id} id={expense.attachmentId} />
            )}
            {expense.shares.map((s) => (
              <div className="dinner-pair" key={s.userId}>
                <span>
                  {name(s.userId)}
                  {s.userId === expense.payerId ? " · payer’s share" : ""}
                </span>
                <span>{usd(s.cents)}</span>
              </div>
            ))}
            {expense.flags.map((f) => (
              <p key={f.userId} className="dinner-error">
                {name(f.userId)} flagged their share: {f.reason}
                <br />
                <span className="dinner-note">
                  Needs clarification. The flag and recorded share stay in
                  history.
                </span>
              </p>
            ))}
            {expense.status === "cancelled" ? <p className="dinner-note">Cancelled. Kept in history; no debt or payment was created.</p> : expense.status === "draft" ? (
              expense.creatorId === me?.id ? (
                <>
                  <p className="dinner-note" style={{ marginTop: 14 }}>
                    Review the payer and every share. Confirming records
                    obligations only. It will not move money.
                  </p>
                  <div className="dinner-actions">
                    <button
                      disabled={busy}
                      onClick={() => void confirm(expense)}
                    >
                      Confirm expense
                    </button>
                    <button className="dinner-quiet" disabled={busy} onClick={() => void cancelDraft(expense)}>Cancel bill</button>
                    <button
                      className="dinner-quiet"
                      disabled={busy}
                      onClick={() => start(expense)}
                    >
                      Edit draft
                    </button>
                  </div>
                </>
              ) : (
                <p className="dinner-note">
                  Waiting for {name(expense.creatorId)} to review and confirm.
                </p>
              )
            ) : (
              <div className="dinner-actions" style={{ marginTop: 16 }}>
                <span className="dinner-note">
                  No in-app settlement in this beta. Outside receipt records
                  appear below.
                </span>
                {expense.creatorId === me?.id && canDeleteSplit(expense) && (
                  <button className="dinner-quiet" disabled={busy} onClick={() => void deleteSplit(expense)}>Delete split</button>
                )}
                {expense.shares.some((s) => s.userId === me?.id) && (
                  <button
                    className="dinner-small dinner-quiet"
                    disabled={busy}
                    onClick={() => {
                      setFlagging(expense.id);
                      setFlagReason("");
                    }}
                  >
                    Flag my share
                  </button>
                )}
              </div>
            )}
            {flagging === expense.id && (
              <form
                className="dinner-form dinner-outside-review"
                onSubmit={(event) => {
                  event.preventDefault();
                  void flag(expense);
                }}
              >
                <label>
                  What looks wrong with your share?
                  <textarea
                    value={flagReason}
                    onChange={(event) => setFlagReason(event.target.value)}
                    maxLength={400}
                    required
                  />
                </label>
                <p className="dinner-note">
                  This records a flag without changing the share or making a
                  payment.
                </p>
                <div className="dinner-actions">
                  <button disabled={busy || !flagReason.trim()}>
                    Save share flag
                  </button>
                  <button
                    type="button"
                    className="dinner-quiet"
                    onClick={() => setFlagging(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {expense.status === "confirmed" && (
              <>
                <button
                  className="dinner-quiet"
                  disabled={busy}
                  onClick={() => start(expense)}
                >
                  Correct this expense
                </button>
                <Corrections
                  expense={expense}
                  room={room}
                  refresh={refresh}
                  edit={(c) => start(expense, c)}
                />
              </>
            )}
            {expense.status === "confirmed" && (
              <OutsidePayments
                expense={expense}
                room={room}
                refresh={refresh}
              />
            )}
          </section>
        ))}
    </div>
  );
}
