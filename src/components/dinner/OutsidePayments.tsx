"use client";
import { useRef, useState } from "react";
import {
  Expense,
  Obligation,
  RoomView,
  outsideReportSchema,
  usd,
} from "@/lib/dinner/model";
import { useDinner } from "./DinnerShell";

type ConfirmedExpense = Extract<Expense, { status: "confirmed" }>;
type Action = "report" | "confirmed" | "rejected" | "cancelled";
export function OutsidePayments({
  expense,
  room,
  refresh,
}: {
  expense: ConfirmedExpense;
  room: RoomView;
  refresh: () => Promise<void>;
}) {
  return (
    <div className="dinner-stack">
      {expense.obligations.map((obligation) => (
        <OutsideObligation
          key={obligation.id}
          obligation={obligation}
          expense={expense}
          room={room}
          refresh={refresh}
        />
      ))}
    </div>
  );
}
function OutsideObligation({
  obligation,
  expense,
  room,
  refresh,
}: {
  obligation: Obligation;
  expense: ConfirmedExpense;
  room: RoomView;
  refresh: () => Promise<void>;
}) {
  const { api, me } = useDinner();
  const [review, setReview] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const retries = useRef(new Map<string, string>());
  const reports = obligation.outsideReports ?? [];
  const pending = reports.find((r) => r.status === "pending");
  const name = (id: string) =>
    room.members.find((m) => m.userId === id)?.name ?? "Member";
  const creditor = me?.id === obligation.creditorId;
  const canReport =
    me?.id === obligation.debtorId || me?.id === expense.creatorId;
  async function submit(action: Action) {
    if (action !== "report" && !pending) {
      setReview(null);
      return;
    }
    const key =
      action === "report"
        ? `report:${reports.length}`
        : `${pending?.id}:${action}`;
    const clientId = retries.current.get(key) ?? crypto.randomUUID();
    retries.current.set(key, clientId);
    setBusy(true);
    setError("");
    try {
      await api(
        `/rooms/${room.id}/obligations/${obligation.id}/reports${action === "report" ? "" : `/${pending?.id}/${action}`}`,
        { method: "POST", body: JSON.stringify({ clientId }) },
        outsideReportSchema,
      );
      setReview(null);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not record your response. Retry safely.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="dinner-outside"
      aria-label={`Outside payment record for ${name(obligation.debtorId)}`}
    >
      <h3>
        {name(obligation.debtorId)} → {name(obligation.creditorId)} ·{" "}
        {usd(obligation.cents)}
      </h3>
      <p className="dinner-note">
        {obligation.status === "outstanding"
          ? "Still outstanding"
          : "Recipient confirmed receipt outside Tab · obligation closed"}
        . No money moved through Tab. This is not a Tab payment receipt.
      </p>
      {reports.map((report) => (
        <div className="dinner-outside-history" key={report.id}>
          <strong>Reported paid outside Tab</strong>
          <p className="dinner-note">
            {usd(report.cents)} · reported by {name(report.reportedBy)} ·{" "}
            {report.status === "pending"
              ? `Awaiting ${name(obligation.creditorId)}’s confirmation; still outstanding`
              : report.status === "confirmed"
                ? "Recipient confirmed receipt outside Tab"
                : report.status === "rejected"
                  ? "Recipient rejected this report; obligation remains outstanding"
                  : "Reporter cancelled this report; obligation remains outstanding"}
          </p>
        </div>
      ))}
      {expense.flags.some((f) => f.userId === obligation.debtorId) && (
        <p className="dinner-error">
          This share is flagged. The flag stays visible even if the recipient
          confirms receipt; this flow does not resolve the dispute or change the
          share.
        </p>
      )}
      {error && (
        <p role="alert" className="dinner-error">
          {error}
        </p>
      )}
      {review ? (
        <div
          className="dinner-outside-review"
          role="group"
          aria-label="Review outside payment record"
        >
          <h3>
            {review === "report"
              ? "Record an outside payment?"
              : review === "confirmed"
                ? "Did you receive this money outside Tab?"
                : review === "rejected"
                  ? "Reject this outside report?"
                  : "Cancel your unconfirmed report?"}
          </h3>
          <p>
            {usd(obligation.cents)} from {name(obligation.debtorId)} to{" "}
            {name(obligation.creditorId)}.
          </p>
          <p className="dinner-note">
            {review === "confirmed"
              ? "Confirm only if you actually received this full amount outside Tab. Your confirmation removes this obligation from outstanding, without creating a Tab transfer or payment receipt."
              : "Tab does not send, verify or hold these funds. The obligation stays outstanding until the recipient explicitly confirms receipt."}
          </p>
          <div className="dinner-actions">
            <button disabled={busy} onClick={() => void submit(review)}>
              {review === "report"
                ? "Submit outside report"
                : review === "confirmed"
                  ? "Confirm I received this outside Tab"
                  : review === "rejected"
                    ? "Reject outside report"
                    : "Cancel outside report"}
            </button>
            <button
              className="dinner-quiet"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="dinner-actions">
          {obligation.status === "outstanding" && !pending && canReport && (
            <button
              className="dinner-quiet"
              onClick={() => setReview("report")}
            >
              Report paid outside Tab
            </button>
          )}
          {pending && creditor && (
            <>
              <button onClick={() => setReview("confirmed")}>
                Review outside report
              </button>
              <button
                className="dinner-quiet"
                onClick={() => setReview("rejected")}
              >
                I haven’t received this
              </button>
            </>
          )}
          {pending && pending.reportedBy === me?.id && (
            <button
              className="dinner-quiet"
              onClick={() => setReview("cancelled")}
            >
              Cancel unconfirmed report
            </button>
          )}
        </div>
      )}
    </section>
  );
}
