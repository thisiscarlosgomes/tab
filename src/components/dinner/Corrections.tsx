"use client";
import { useState } from "react";
import { z } from "zod";
import {
  Expense,
  Correction,
  RoomView,
  memberName,
  usd,
} from "@/lib/dinner/model";
import { PrivateImage } from "./PrivateImage";
import { useDinner } from "./DinnerShell";

export function Corrections({
  expense,
  room,
  refresh,
  edit,
}: {
  expense: Extract<Expense, { status: "confirmed" }>;
  room: RoomView;
  refresh: () => Promise<void>;
  edit: (correction: Correction) => void;
}) {
  const { api, me } = useDinner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flagging, setFlagging] = useState("");
  const [reason, setReason] = useState("");
  const name = (id: string) => memberName(room, id);
  async function act(c: Correction, action: "confirm" | "flag") {
    setBusy(true);
    setError("");
    try {
      await api(
        `/rooms/${room.id}/expenses/${expense.id}/corrections/${c.id}/${action}`,
        {
          method: "POST",
          body: JSON.stringify(
            action === "confirm" ? { clientId: c.id } : { reason },
          ),
        },
        z.unknown(),
      );
      setFlagging("");
      setReason("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save correction");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dinner-stack">
      <p className="dinner-note">
        Current version {expense.version}. Corrections require review by the
        expense author or room owner. No money moves.
      </p>
      {error && (
        <p role="alert" className="dinner-error">
          {error}
        </p>
      )}
      {expense.corrections?.map((c) => (
        <section
          className="dinner-outside"
          key={c.id}
          aria-label={`Correction: ${c.fields.description}`}
        >
          <h3>
            {c.fields.description} · {usd(c.fields.totalCents)}
          </h3>
          <p className="dinner-note">
            Correction to version {c.expectedVersion} ·{" "}
            {c.status === "proposed"
              ? "Awaiting human review"
              : c.status === "disputed"
                ? "Disputed · not applied"
                : "Accepted and recorded"}{" "}
            · proposed by {name(c.proposedBy)}
          </p>
          <p>Payer: {name(c.fields.payerId)}</p>
          {c.fields.shares.map((s) => (
            <div className="dinner-pair" key={s.userId}>
              <span>{name(s.userId)}</span>
              <span>{usd(s.cents)}</span>
            </div>
          ))}
          {c.flags.map((f) => (
            <p key={f.userId} className="dinner-error">
              {name(f.userId)}: {f.reason}
            </p>
          ))}
          {c.status !== "applied" && (
            <>
              <p className="dinner-note">
                Review every share. Accepting reverses the previous obligations
                and records the corrected version. Confirmed outside receipts
                remain credited; any overpayment stays owed back. Pending
                outside reports must be resolved first.
              </p>
              {c.expectedVersion !== expense.version && (
                <p className="dinner-note">
                  The expense changed. Prepare a new correction from the current
                  version.
                </p>
              )}
              <div className="dinner-actions">
                {[expense.creatorId, room.ownerId].includes(me?.id ?? "") &&
                  c.status === "proposed" &&
                  c.expectedVersion === expense.version && (
                    <button
                      disabled={busy}
                      onClick={() => void act(c, "confirm")}
                    >
                      Accept correction
                    </button>
                  )}
                <button
                  className="dinner-quiet"
                  disabled={busy}
                  onClick={() => edit(c)}
                >
                  Edit as new proposal
                </button>
                {[
                  expense.payerId,
                  c.fields.payerId,
                  ...expense.shares.map((s) => s.userId),
                  ...c.fields.shares.map((s) => s.userId),
                ].includes(me?.id ?? "") && (
                  <button
                    className="dinner-quiet"
                    disabled={busy}
                    onClick={() => {
                      setFlagging(c.id);
                      setReason("");
                    }}
                  >
                    Dispute correction
                  </button>
                )}
              </div>
              {flagging === c.id && (
                <form
                  className="dinner-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(c, "flag");
                  }}
                >
                  <label>
                    What looks wrong with this correction?
                    <textarea
                      required
                      maxLength={400}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button disabled={busy || !reason.trim()}>
                    Save correction dispute
                  </button>
                  <button
                    type="button"
                    className="dinner-quiet"
                    onClick={() => setFlagging("")}
                  >
                    Cancel
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      ))}
      {!!expense.history?.length && (
        <details className="dinner-outside">
          <summary>Version history and recorded reversals</summary>
          {expense.history.map((h) => (
            <section key={h.version}>
              <h3>
                Version {h.version} · {h.description} · {usd(h.totalCents)}
              </h3>
              <p className="dinner-note">
                Reversed by {name(h.reversedBy)} on{" "}
                {new Date(h.reversedAt).toLocaleString()}. Original shares and
                reports preserved.
              </p>
              {h.attachmentId && (
                <PrivateImage roomId={room.id} id={h.attachmentId} />
              )}
              {h.shares.map((s) => (
                <p key={s.userId}>
                  {name(s.userId)}: {usd(s.cents)}
                </p>
              ))}
              {h.obligations.map((o) => (
                <div key={o.id}>
                  <p>
                    {name(o.debtorId)} → {name(o.creditorId)} · {usd(o.cents)} ·{" "}
                    {o.status === "outstanding"
                      ? "Reversed outstanding obligation"
                      : "Receipt outside Tab credited"}
                  </p>
                  {o.outsideReports?.map((r) => (
                    <p className="dinner-note" key={r.id}>
                      Reported paid outside Tab · {usd(r.cents)} · {r.status}
                    </p>
                  ))}
                </div>
              ))}
              {h.flags.map((f) => (
                <p className="dinner-note" key={f.userId}>
                  {name(f.userId)} flagged: {f.reason}
                </p>
              ))}
            </section>
          ))}
        </details>
      )}
    </div>
  );
}
