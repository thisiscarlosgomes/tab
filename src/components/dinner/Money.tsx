"use client";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import {
  Expense,
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
import { PrivateImage } from "./PrivateImage";

export function Money({
  room,
  refresh,
}: {
  room: RoomView;
  refresh: () => Promise<void>;
}) {
  const { api, me } = useDinner();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [description, setDescription] = useState("");
  const [total, setTotal] = useState("");
  const [payer, setPayer] = useState(me?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [shares, setShares] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState("");
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [flagging, setFlagging] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [busy, setBusy] = useState(false);
  const name = (id: string) =>
    room.members.find((m) => m.userId === id)?.name ?? "Member";
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
  function start(expense?: Expense) {
    setEditing(expense ?? null);
    setDescription(expense?.description ?? "");
    setTotal(expense ? (expense.totalCents / 100).toFixed(2) : "");
    setPayer(expense?.payerId ?? me?.id ?? "");
    const ids = expense?.shares.map((s) => s.userId) ?? [];
    setSelected(ids);
    setShares(
      Object.fromEntries(
        expense?.shares.map((s) => [s.userId, (s.cents / 100).toFixed(2)]) ??
          [],
      ),
    );
    setReceipt(expense?.attachmentId ?? "");
    setClientId(expense?.clientId ?? crypto.randomUUID());
    setError("");
    setShowForm(true);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const totalCents = parseUsd(total);
    if (!totalCents || !selected.length) {
      setError(
        "Enter a USD amount and select at least one accepted participant.",
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
        `/rooms/${room.id}/expenses${editing ? `/${editing.id}` : ""}`,
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify({
            clientId,
            description,
            totalCents,
            payerId: payer,
            shares: parsed,
            ...(receipt ? { attachmentId: receipt } : {}),
          }),
        },
        expenseSchema,
      );
      setShowForm(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save draft");
    } finally {
      setBusy(false);
    }
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
          <h2>{editing ? "Edit expense draft" : "Add an expense"}</h2>
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
                  value={payer}
                  onChange={(e) => setPayer(e.target.value)}
                >
                  {room.members.map((m) => (
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
                automatically.
              </p>
              {room.members.map((m) => (
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
              Save first, then review before confirming. Drafts do not create
              obligations. Recording a share never authorizes payment.
            </p>
            <div className="dinner-actions">
              <button disabled={busy} type="submit">
                {busy ? "Saving…" : "Save draft"}
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
        .slice()
        .reverse()
        .map((expense) => (
          <section key={expense.id} className="dinner-card">
            <div className="dinner-heading">
              <div>
                <span className="dinner-chip">
                  {expense.status === "draft"
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
            {expense.status === "draft" ? (
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
