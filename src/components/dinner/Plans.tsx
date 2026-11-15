"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { z } from "zod";
import type { PlanProposal } from "@/lib/dinner/agent/plan-proposals";
import { Temporal } from "@js-temporal/polyfill";
import { useDinner } from "./DinnerShell";
import { RoomView, parseUsd, usd } from "@/lib/dinner/model";
import {
  PlanView,
  planSchema,
  compareOptions,
  planAttentionLabel,
} from "@/lib/dinner/plans/model";

const emptySlot = () => ({ localStart: "", localEnd: "" });
type Slot = ReturnType<typeof emptySlot>;
type Send = (body: Record<string, unknown>) => Promise<PlanView | undefined>;
function useMutation(path: string, saved: (plan: PlanView) => void) {
  const { api } = useDinner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ key: string; id: string }>();
  const running = useRef(false);
  const send: Send = async (body) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const key = JSON.stringify(body);
    if (pending.current?.key !== key)
      pending.current = { key, id: crypto.randomUUID() };
    try {
      const result = await api(
        path,
        {
          method: "POST",
          body: JSON.stringify({ ...body, clientId: pending.current.id }),
        },
        planSchema,
      );
      pending.current = undefined;
      saved(result);
      return result;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Retry safely.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { send, busy, error };
}
function Slots({
  slots,
  setSlots,
}: {
  slots: Slot[];
  setSlots: (slots: Slot[]) => void;
}) {
  return (
    <div className="dinner-stack">
      {slots.map((slot, index) => (
        <fieldset key={index} className="dinner-card soft">
          <legend>Option {index + 1}</legend>
          <label>
            Starts
            <input
              type="datetime-local"
              required
              value={slot.localStart}
              onChange={(e) =>
                setSlots(
                  slots.map((s, i) =>
                    i === index ? { ...s, localStart: e.target.value } : s,
                  ),
                )
              }
            />
          </label>
          <label>
            Ends
            <input
              type="datetime-local"
              required
              value={slot.localEnd}
              onChange={(e) =>
                setSlots(
                  slots.map((s, i) =>
                    i === index ? { ...s, localEnd: e.target.value } : s,
                  ),
                )
              }
            />
          </label>
          {slots.length > 1 && (
            <button
              type="button"
              className="dinner-small dinner-quiet"
              onClick={() => setSlots(slots.filter((_, i) => i !== index))}
            >
              Remove option {index + 1}
            </button>
          )}
        </fieldset>
      ))}
      {slots.length < 5 && (
        <button
          type="button"
          className="dinner-quiet"
          onClick={() => setSlots([...slots, emptySlot()])}
        >
          Add another time
        </button>
      )}
    </div>
  );
}
function deadlineValue(value: string, zone: string) {
  return value
    ? Temporal.PlainDateTime.from(value)
        .toZonedDateTime(zone, { disambiguation: "reject" })
        .toInstant()
        .toString()
    : null;
}
export function CreatePlan({
  room,
  saved,
  initial,
  proposal,
}: {
  room: RoomView;
  saved: (plan: PlanView) => void;
  initial?: PlanView;
  proposal?: PlanProposal;
}) {
  const [title, setTitle] = useState(
    initial?.title ?? proposal?.fields.title ?? "",
  );
  const [zone, setZone] = useState(
    () =>
      initial?.timeZone ??
      (proposal
        ? (proposal.fields.timeZone ?? "")
        : Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  const [location, setLocation] = useState(
    initial?.location ?? proposal?.fields.location ?? "",
  );
  const [budget, setBudget] = useState(
    initial
      ? (initial.budgetCents / 100).toFixed(2)
      : proposal && proposal.fields.budgetCents !== null
        ? (proposal.fields.budgetCents / 100).toFixed(2)
        : "",
  );
  const [slots, setSlots] = useState(
    (initial?.slots ?? proposal?.fields.slots)?.map(
      ({ localStart, localEnd }) => ({
        localStart,
        localEnd,
      }),
    ) ?? [emptySlot()],
  );
  const [participants, setParticipants] = useState(
    initial?.participantIds ??
      (proposal
        ? (proposal.fields.participantIds ?? [])
        : room.members.map((m) => m.userId)),
  );
  const [deadline, setDeadline] = useState(
    initial?.deadline
      ? Temporal.Instant.from(initial.deadline)
          .toZonedDateTimeISO(initial.timeZone)
          .toPlainDateTime()
          .toString()
          .slice(0, 16)
      : "",
  );
  const [revision, setRevision] = useState(initial?.revision ?? 0);
  const [localError, setLocalError] = useState("");
  const { send, busy, error } = useMutation(
    initial
      ? `/rooms/${room.id}/plans/${initial.id}/commands`
      : proposal
        ? `/agent/plan-proposals/${proposal.id}/apply`
        : `/rooms/${room.id}/plans`,
    saved,
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLocalError("");
    const cents = parseUsd(budget);
    if (cents === null) {
      setLocalError("Enter a USD budget with at most two decimals.");
      return;
    }
    try {
      const fields = {
        title,
        timeZone: zone,
        location,
        budgetCents: cents,
        slots,
        participantIds: participants,
        deadline: deadlineValue(deadline, zone),
      };
      await send(
        initial
          ? { action: "edit_draft", expectedRevision: revision, fields }
          : fields,
      );
    } catch {
      setLocalError(
        "Check the deadline and time zone; skipped or repeated clock times need another time.",
      );
    }
  }
  return (
    <form className="dinner-card dinner-stack" onSubmit={submit}>
      <h3>
        {initial
          ? "Edit plan draft"
          : proposal
            ? "Review your plan idea"
            : "A new plan"}
      </h3>
      {proposal && (
        <p className="dinner-note">
          Complete the missing details and check every suggestion. Saving
          creates a draft; publish separately in Plans to ask for responses.
        </p>
      )}
      <label>
        What are we planning?
        <input
          required
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Dinner this Friday"
        />
      </label>
      <fieldset>
        <legend>Invite room members to this plan</legend>
        {room.members.map((m) => (
          <label key={m.userId} className="plan-choice">
            <input
              type="checkbox"
              checked={participants.includes(m.userId)}
              onChange={(e) =>
                setParticipants(
                  e.target.checked
                    ? [...participants, m.userId]
                    : participants.filter((id) => id !== m.userId),
                )
              }
            />
            {m.name}
          </label>
        ))}
      </fieldset>
      <label>
        Area or venue
        <input
          required
          maxLength={240}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Downtown · venue to decide"
        />
      </label>
      <label>
        Estimated maximum per person · USD
        <input
          required
          inputMode="decimal"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="50.00"
        />
      </label>
      <label>
        Event time zone
        <input
          required
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          placeholder="Asia/Shanghai"
        />
      </label>
      <p className="dinner-note">
        All times below use {zone}. This budget is an estimate, not a charge.
      </p>
      <Slots slots={slots} setSlots={setSlots} />
      <label>
        Respond by · optional, in {zone}
        <input
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
      </label>
      {(error || localError) && (
        <p role="alert" className="dinner-error">
          {error || localError}
        </p>
      )}
      {initial && (
        <ReviewChanges
          plan={initial}
          revision={revision}
          review={() => setRevision(initial.revision)}
        />
      )}
      <button
        disabled={
          busy ||
          !participants.length ||
          (!!initial && revision !== initial.revision)
        }
      >
        {busy ? "Saving…" : initial ? "Save draft changes" : "Save plan draft"}
      </button>
    </form>
  );
}
function timeLabel(start: string, end: string, zone: string) {
  const format = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  });
  return `${format.format(new Date(start))} – ${format.format(new Date(end))} (${zone})`;
}
function ResponseForm({
  plan,
  send,
  busy,
  userId,
}: {
  plan: PlanView;
  send: Send;
  busy: boolean;
  userId: string;
}) {
  const response = plan.responses.find((r) => r.userId === userId);
  const [votes, setVotes] = useState<
    Record<string, "works" | "if_needed" | "cant">
  >(response?.votes ?? {});
  const [budget, setBudget] = useState(response?.budget ?? "unsure");
  const [note, setNote] = useState(response?.privateNote ?? "");
  const [version, setVersion] = useState(response?.version ?? 0);
  const closed = !!plan.deadline && Date.now() >= Date.parse(plan.deadline);
  const stale = version !== (response?.version ?? 0);
  return (
    <form
      className="dinner-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await send({
          action: "respond",
          optionsVersion: plan.optionsVersion,
          expectedResponseVersion: version,
          votes,
          budget,
          privateNote: note,
        });
        if (result)
          setVersion(
            result.responses.find((r) => r.userId === userId)?.version ??
              version,
          );
      }}
    >
      <h4>Your availability</h4>
      <p className="dinner-note">
        Availability and budget answers are visible to the room. They do not
        confirm attendance.
      </p>
      {plan.slots.map((slot) => (
        <fieldset key={slot.id}>
          <legend>{timeLabel(slot.startAt, slot.endAt, plan.timeZone)}</legend>
          {(
            [
              ["works", "Works"],
              ["if_needed", "If needed"],
              ["cant", "Can’t"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="plan-choice">
              <input
                type="radio"
                name={`vote-${plan.id}-${slot.id}`}
                required
                checked={votes[slot.id] === value}
                onChange={() => setVotes({ ...votes, [slot.id]: value })}
              />
              {label}
            </label>
          ))}
        </fieldset>
      ))}
      <label>
        Does the {usd(plan.budgetCents)} estimated maximum work?
        <select
          value={budget}
          onChange={(e) => setBudget(e.target.value as typeof budget)}
        >
          <option value="unsure">Not sure yet</option>
          <option value="works">Works for me</option>
          <option value="doesnt_work">Doesn’t work</option>
        </select>
      </label>
      <label>
        Dietary or accessibility note · optional
        <textarea
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <p className="dinner-note">
        Only you and the organizer can read this note. Requirements still need
        to be checked with the venue.
      </p>
      {response?.privateNote && (
        <button
          type="button"
          className="dinner-small dinner-quiet"
          disabled={busy || stale}
          onClick={async () => {
            const result = await send({
              action: "clear_note",
              expectedResponseVersion: version,
            });
            if (result) {
              setNote("");
              setVersion(
                result.responses.find((r) => r.userId === userId)?.version ??
                  version,
              );
            }
          }}
        >
          Clear my private note
        </button>
      )}
      {stale && (
        <p role="alert">
          Your saved response changed. Your edits are still here.{" "}
          <button
            type="button"
            onClick={() => {
              setVotes(response?.votes ?? {});
              setBudget(response?.budget ?? "unsure");
              setNote(response?.privateNote ?? "");
              setVersion(response?.version ?? 0);
            }}
          >
            Load saved response
          </button>
        </p>
      )}
      {closed ? (
        <p role="status">
          The response deadline passed. The organizer can reopen options.
        </p>
      ) : (
        <button disabled={busy || stale}>
          {busy ? "Saving…" : "Save my response"}
        </button>
      )}
    </form>
  );
}
function FinalForm({
  plan,
  send,
  busy,
}: {
  plan: PlanView;
  send: Send;
  busy: boolean;
}) {
  const first = plan.terms ?? plan.slots[0];
  const [slot, setSlot] = useState<Slot>({
    localStart: first.localStart,
    localEnd: first.localEnd,
  });
  const [zone, setZone] = useState(plan.terms?.timeZone ?? plan.timeZone);
  const [location, setLocation] = useState(
    plan.terms?.location ?? plan.location,
  );
  const [budget, setBudget] = useState(
    ((plan.terms?.budgetCents ?? plan.budgetCents) / 100).toFixed(2),
  );
  const [revision, setRevision] = useState(plan.revision);
  const [error, setError] = useState("");
  return (
    <form
      className="dinner-stack"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = parseUsd(budget);
        if (cents === null) {
          setError("Enter a valid USD budget.");
          return;
        }
        void send({
          action: "propose",
          expectedRevision: revision,
          terms: { ...slot, timeZone: zone, location, budgetCents: cents },
        });
      }}
    >
      <h4>Propose final details</h4>
      <label>
        Use a proposed time
        <select
          defaultValue=""
          onChange={(e) => {
            const selected = plan.slots.find((s) => s.id === e.target.value);
            if (selected)
              setSlot({
                localStart: selected.localStart,
                localEnd: selected.localEnd,
              });
          }}
        >
          <option value="">Choose an option or enter times below</option>
          {plan.slots.map((s, i) => (
            <option key={s.id} value={s.id}>
              Option {i + 1} · {s.localStart.replace("T", " ")}
            </option>
          ))}
        </select>
      </label>
      <label>
        Starts
        <input
          required
          type="datetime-local"
          value={slot.localStart}
          onChange={(e) => setSlot({ ...slot, localStart: e.target.value })}
        />
      </label>
      <label>
        Ends
        <input
          required
          type="datetime-local"
          value={slot.localEnd}
          onChange={(e) => setSlot({ ...slot, localEnd: e.target.value })}
        />
      </label>
      <label>
        Time zone
        <input
          required
          value={zone}
          onChange={(e) => setZone(e.target.value)}
        />
      </label>
      <label>
        Exact venue or meeting point
        <input
          required
          maxLength={240}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </label>
      <label>
        Estimated maximum per person · USD
        <input
          required
          inputMode="decimal"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>
      <p className="dinner-note">
        Each participant must accept these details to be included. Changing them
        resets previous confirmations. No reservation or payment is made.
      </p>
      {error && <p role="alert">{error}</p>}
      <ReviewChanges
        plan={plan}
        revision={revision}
        review={() => setRevision(plan.revision)}
      />
      <button disabled={busy || revision !== plan.revision}>
        Request confirmations
      </button>
    </form>
  );
}
function ReworkForm({
  plan,
  send,
  busy,
}: {
  plan: PlanView;
  send: Send;
  busy: boolean;
}) {
  const [slots, setSlots] = useState<Slot[]>(
    plan.slots.map((s) => ({ localStart: s.localStart, localEnd: s.localEnd })),
  );
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(plan.revision);
  return (
    <form
      className="dinner-stack"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          void send({
            action: "rework",
            expectedRevision: revision,
            slots,
            deadline: deadlineValue(deadline, plan.timeZone),
          });
        } catch {
          setError("Check the deadline and time zone.");
        }
      }}
    >
      <h4>Reopen options</h4>
      <p>
        New options clear availability and final approvals. Times use{" "}
        {plan.timeZone}.
      </p>
      <Slots slots={slots} setSlots={setSlots} />
      <label>
        New response deadline · optional
        <input
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <ReviewChanges
        plan={plan}
        revision={revision}
        review={() => setRevision(plan.revision)}
      />
      <button disabled={busy || revision !== plan.revision}>
        Clear responses and reopen
      </button>
    </form>
  );
}
function ReviewChanges({
  plan,
  revision,
  review,
}: {
  plan: PlanView;
  revision: number;
  review: () => void;
}) {
  if (revision === plan.revision) return null;
  return (
    <div className="dinner-card soft" role="status">
      <p>
        The saved plan changed. Your edits are preserved. Review the latest
        state before applying them.
      </p>
      <p>
        {plan.title} · {plan.state} · {plan.participantIds.length} invited ·{" "}
        {plan.responses.length} availability responses ·{" "}
        {plan.decisions.filter((d) => d.decision === "accepted").length}{" "}
        accepted
      </p>
      <p>
        {plan.terms?.location ?? plan.location} ·{" "}
        {usd(plan.terms?.budgetCents ?? plan.budgetCents)} estimated per person
      </p>
      {plan.terms ? (
        <p>
          {timeLabel(plan.terms.startAt, plan.terms.endAt, plan.terms.timeZone)}
        </p>
      ) : (
        plan.slots.map((slot) => (
          <p key={slot.id}>
            {timeLabel(slot.startAt, slot.endAt, plan.timeZone)}
          </p>
        ))
      )}
      <p>
        Response deadline:{" "}
        {plan.deadline ? new Date(plan.deadline).toLocaleString() : "None"}
      </p>
      <button type="button" onClick={review}>
        I reviewed the latest plan — keep my edits
      </button>
    </div>
  );
}
function DeadlineForm({
  plan,
  send,
  busy,
}: {
  plan: PlanView;
  send: Send;
  busy: boolean;
}) {
  const [deadline, setDeadline] = useState("");
  const [remove, setRemove] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(plan.revision);
  return (
    <form
      className="dinner-stack"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        try {
          void send({
            action: "extend_deadline",
            expectedRevision: revision,
            deadline: remove ? null : deadlineValue(deadline, plan.timeZone),
          });
        } catch {
          setError("Choose a valid deadline in the event time zone.");
        }
      }}
    >
      <h4>Extend response deadline</h4>
      <p>
        Existing availability, budget answers and private notes are preserved.
      </p>
      <label className="plan-choice">
        <input
          type="checkbox"
          checked={remove}
          onChange={(e) => setRemove(e.target.checked)}
        />
        Remove the deadline
      </label>
      {!remove && (
        <label>
          Later deadline · {plan.timeZone}
          <input
            type="datetime-local"
            required
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>
      )}
      <ReviewChanges
        plan={plan}
        revision={revision}
        review={() => setRevision(plan.revision)}
      />
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || revision !== plan.revision}>
        Save deadline without clearing responses
      </button>
    </form>
  );
}
function AddParticipants({
  plan,
  room,
  send,
  busy,
}: {
  plan: PlanView;
  room: RoomView;
  send: Send;
  busy: boolean;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [revision, setRevision] = useState(plan.revision);
  const eligible = room.members.filter(
    (m) => !plan.participantIds.includes(m.userId),
  );
  return (
    <form
      className="dinner-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void send({
          action: "add_participants",
          expectedRevision: revision,
          participantIds: ids,
        });
      }}
    >
      <h4>Invite more participants</h4>
      <p>
        {plan.terms
          ? "Changing the group reopens confirmation for everyone. No one is automatically accepted."
          : "New participants can respond to the current options. Existing responses are preserved."}
      </p>
      {eligible.length ? (
        <fieldset>
          <legend>Accepted room members</legend>
          {eligible.map((m) => (
            <label className="plan-choice" key={m.userId}>
              <input
                type="checkbox"
                checked={ids.includes(m.userId)}
                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, m.userId]
                      : ids.filter((id) => id !== m.userId),
                  )
                }
              />
              {m.name}
            </label>
          ))}
        </fieldset>
      ) : (
        <p>
          All room members are already invited. Invite someone to the room
          first.
        </p>
      )}
      <ReviewChanges
        plan={plan}
        revision={revision}
        review={() => setRevision(plan.revision)}
      />
      <button disabled={busy || !ids.length || revision !== plan.revision}>
        Add selected participants
      </button>
    </form>
  );
}
export function PlanCard({
  plan,
  room,
  saved,
}: {
  plan: PlanView;
  room: RoomView;
  saved: (plan: PlanView) => void;
}) {
  const { api, me } = useDinner();
  const [editor, setEditor] = useState<
    "final" | "rework" | "draft" | "deadline" | "participants" | null
  >(null);
  const [exportError, setExportError] = useState("");
  const [cancelReview, setCancelReview] = useState(false);
  const [withdrawReview, setWithdrawReview] = useState(false);
  const { send, busy, error } = useMutation(
    `/rooms/${room.id}/plans/${plan.id}/commands`,
    (result) => {
      saved(result);
      setEditor(null);
      setCancelReview(false);
      setWithdrawReview(false);
    },
  );
  const owner = me?.id === plan.creatorId;
  const participant = !!me && plan.participantIds.includes(me.id);
  const name = (id: string) =>
    room.members.find((m) => m.userId === id)?.name ?? "Member";
  const accepted = plan.decisions
    .filter(
      (d) => d.decision === "accepted" && d.termsVersion === plan.termsVersion,
    )
    .map((d) => d.userId);
  const closed = ["completed", "cancelled"].includes(plan.state);
  const command = (action: string) =>
    void send({ action, expectedRevision: plan.revision });
  async function download() {
    try {
      setExportError("");
      const file = await api(
        `/rooms/${room.id}/plans/${plan.id}/calendar`,
        {},
        z.object({ filename: z.string(), content: z.string() }),
      );
      const url = URL.createObjectURL(
        new Blob([file.content], { type: "text/calendar;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError(
        e instanceof Error ? e.message : "Could not export calendar",
      );
    }
  }
  return (
    <section id={`plan-${plan.id}`} className="dinner-card dinner-stack">
      <div>
        <p className="dinner-eyebrow">
          {plan.state} · organized by {name(plan.creatorId)}
        </p>
        <h3>{plan.title}</h3>
        <p>
          {plan.location} · up to {usd(plan.budgetCents)} per person, estimated
        </p>
        <p className="dinner-note">
          Invited: {plan.participantIds.map(name).join(", ")}
        </p>
      </div>
      {plan.deadline && plan.state === "collecting" && (
        <p className="dinner-note">
          Respond by{" "}
          {new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: plan.timeZone,
          }).format(new Date(plan.deadline))}{" "}
          ({plan.timeZone})
        </p>
      )}
      {["draft", "collecting"].includes(plan.state) && (
        <div className="dinner-stack">
          {compareOptions(plan).map((s) => (
            <div key={s.id} className="dinner-card soft">
              <strong>{timeLabel(s.startAt, s.endAt, plan.timeZone)}</strong>
              <p>
                {s.works} works · {s.flexible} if needed · {s.cant} can’t ·{" "}
                {s.unanswered} unanswered
              </p>
              <details>
                <summary>See who can make it</summary>
                {(
                  [
                    ["works", "Works"],
                    ["if_needed", "If needed"],
                    ["cant", "Can’t"],
                    ["unanswered", "Awaiting response"],
                  ] as const
                ).map(([value, label]) => (
                  <p key={value}>
                    <strong>{label}:</strong>{" "}
                    {plan.participantIds
                      .filter((id) => {
                        const vote = plan.responses.find((r) => r.userId === id)
                          ?.votes[s.id];
                        return value === "unanswered" ? !vote : vote === value;
                      })
                      .map(name)
                      .join(", ") || "None"}
                  </p>
                ))}
              </details>
            </div>
          ))}
          <p className="dinner-note">
            Budget: {plan.responses.filter((r) => r.budget === "works").length}{" "}
            works ·{" "}
            {plan.responses.filter((r) => r.budget === "doesnt_work").length}{" "}
            doesn’t work ·{" "}
            {plan.participantIds.length -
              plan.responses.filter((r) => r.budget !== "unsure").length}{" "}
            unknown
          </p>
          <p className="dinner-note">
            Waiting for:{" "}
            {plan.participantIds
              .filter((id) => !plan.responses.some((r) => r.userId === id))
              .map(name)
              .join(", ") || "Everyone has responded"}
          </p>
        </div>
      )}
      {plan.state === "collecting" && participant && me && (
        <ResponseForm
          key={`${plan.id}-${plan.optionsVersion}`}
          plan={plan}
          send={send}
          busy={busy}
          userId={me.id}
        />
      )}
      {plan.state !== "collecting" &&
        me &&
        plan.responses.find((r) => r.userId === me.id)?.privateNote && (
          <button
            className="dinner-small dinner-quiet"
            disabled={busy}
            onClick={() =>
              void send({
                action: "clear_note",
                expectedResponseVersion:
                  plan.responses.find((r) => r.userId === me.id)?.version ?? 0,
              })
            }
          >
            Clear my private note
          </button>
        )}
      {owner && plan.responses.some((r) => r.privateNote) && (
        <details>
          <summary>Private notes · organizer only</summary>
          {plan.responses
            .filter((r) => r.privateNote)
            .map((r) => (
              <p key={r.userId}>
                <strong>{name(r.userId)}:</strong> {r.privateNote}
              </p>
            ))}
        </details>
      )}
      {plan.terms && (
        <div className="dinner-card soft">
          <h4>
            {plan.state === "confirmed" || plan.state === "completed"
              ? "Agreed details"
              : "Details to confirm"}{" "}
            · version {plan.termsVersion}
          </h4>
          <p>
            {timeLabel(
              plan.terms.startAt,
              plan.terms.endAt,
              plan.terms.timeZone,
            )}
          </p>
          <p>
            {plan.terms.location} · up to {usd(plan.terms.budgetCents)} per
            person, estimated
          </p>
          <p className="dinner-note">
            Venue reservation is not verified. Confirming attendance does not
            authorize spending.
          </p>
          {plan.participantIds.map((id) => (
            <p key={id}>
              {name(id)} ·{" "}
              {plan.state === "confirmed" &&
              accepted.includes(id) &&
              !plan.confirmedIds.includes(id)
                ? "Asked to rejoin · awaiting organizer"
                : (plan.decisions.find(
                    (d) =>
                      d.userId === id && d.termsVersion === plan.termsVersion,
                  )?.decision ?? "Awaiting response")}
            </p>
          ))}
          {plan.state === "confirming" && participant && me && (
            <div className="plan-actions">
              {(["accepted", "declined"] as const).map((decision) => (
                <button
                  key={decision}
                  disabled={busy}
                  onClick={() =>
                    void send({
                      action: "decide",
                      termsVersion: plan.termsVersion,
                      expectedDecisionVersion:
                        plan.decisions.find((d) => d.userId === me.id)
                          ?.version ?? 0,
                      decision,
                    })
                  }
                >
                  {decision === "accepted"
                    ? "Confirm my participation"
                    : "I can’t join"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {owner && !closed && (
        <div className="dinner-stack">
          {plan.state === "draft" && (
            <div className="plan-actions">
              <button disabled={busy} onClick={() => command("publish")}>
                Publish options
              </button>
              <button
                className="dinner-quiet"
                onClick={() => setEditor(editor === "draft" ? null : "draft")}
              >
                {editor === "draft" ? "Close draft editor" : "Edit draft"}
              </button>
            </div>
          )}
          {editor === "draft" && plan.state === "draft" && (
            <CreatePlan
              room={room}
              initial={plan}
              saved={(result) => {
                saved(result);
                setEditor(null);
              }}
            />
          )}
          {plan.state === "collecting" && (
            <button
              className="dinner-quiet"
              onClick={() =>
                setEditor(editor === "deadline" ? null : "deadline")
              }
            >
              {editor === "deadline"
                ? "Close deadline editor"
                : "Extend response deadline"}
            </button>
          )}
          {plan.state !== "draft" && (
            <button
              className="dinner-quiet"
              onClick={() =>
                setEditor(editor === "participants" ? null : "participants")
              }
            >
              {editor === "participants"
                ? "Close participant editor"
                : "Invite more participants"}
            </button>
          )}
          {editor === "deadline" && plan.state === "collecting" && (
            <DeadlineForm plan={plan} send={send} busy={busy} />
          )}
          {editor === "participants" && (
            <AddParticipants plan={plan} room={room} send={send} busy={busy} />
          )}
          {plan.state !== "draft" && (
            <div className="plan-actions">
              <button
                className="dinner-quiet"
                onClick={() => setEditor(editor === "final" ? null : "final")}
              >
                {editor === "final"
                  ? "Close details form"
                  : "Propose final details"}
              </button>
              <button
                className="dinner-quiet"
                onClick={() => setEditor(editor === "rework" ? null : "rework")}
              >
                {editor === "rework" ? "Close options form" : "Reopen options"}
              </button>
            </div>
          )}
          {editor === "final" && (
            <FinalForm plan={plan} send={send} busy={busy} />
          )}
          {editor === "rework" && (
            <ReworkForm plan={plan} send={send} busy={busy} />
          )}
          {plan.state === "confirming" && (
            <div className="dinner-card soft">
              <p>
                Finalize for:{" "}
                {accepted.map(name).join(", ") ||
                  "No accepted participants yet"}
                .
              </p>
              <p className="dinner-note">
                Not included:{" "}
                {plan.participantIds
                  .filter((id) => !accepted.includes(id))
                  .map(name)
                  .join(", ") || "None"}
                . Awaiting responses are not counted.
              </p>
              <button
                disabled={busy || !accepted.length}
                onClick={() => command("finalize")}
              >
                Finalize for {accepted.length} accepted{" "}
                {accepted.length === 1 ? "person" : "people"}
              </button>
            </div>
          )}
          {plan.state === "confirmed" && (
            <button
              disabled={
                busy || !plan.terms || Date.now() < Date.parse(plan.terms.endAt)
              }
              onClick={() => command("complete")}
            >
              Mark outing complete
            </button>
          )}
          {cancelReview ? (
            <div role="group" aria-label="Cancel plan">
              <p>Cancel this outing for everyone? Its history will remain.</p>
              <button disabled={busy} onClick={() => command("cancel")}>
                Yes, cancel plan
              </button>
              <button
                className="dinner-quiet"
                onClick={() => setCancelReview(false)}
              >
                Keep plan
              </button>
            </div>
          ) : (
            <button
              className="dinner-small dinner-quiet"
              onClick={() => setCancelReview(true)}
            >
              Cancel plan
            </button>
          )}
        </div>
      )}
      {plan.state === "confirmed" &&
        me &&
        plan.confirmedIds.includes(me.id) && (
          <div className="dinner-card soft">
            {withdrawReview ? (
              <>
                <p>
                  Withdraw from this outing? The organizer and room will see
                  that you are no longer going. Any venue arrangement still
                  needs to be handled separately.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void send({
                      action: "withdraw",
                      termsVersion: plan.termsVersion,
                      expectedDecisionVersion:
                        plan.decisions.find((d) => d.userId === me.id)
                          ?.version ?? 0,
                    })
                  }
                >
                  Yes, withdraw my attendance
                </button>
                <button
                  className="dinner-quiet"
                  onClick={() => setWithdrawReview(false)}
                >
                  Keep my attendance
                </button>
              </>
            ) : (
              <button
                className="dinner-quiet"
                onClick={() => setWithdrawReview(true)}
              >
                I can no longer attend
              </button>
            )}
          </div>
        )}
      {plan.state === "confirmed" && !plan.confirmedIds.length && (
        <p role="status">
          No confirmed attendees remain. The organizer can rework or cancel this
          outing.
        </p>
      )}
      {["confirmed", "completed"].includes(plan.state) && (
        <>
          <p>Going: {plan.confirmedIds.map(name).join(", ")}</p>
          <button className="dinner-quiet" onClick={() => void download()}>
            Download calendar event
          </button>
          <p className="dinner-note">
            Calendar downloads do not sync automatically. Check Tab for changes.
          </p>
        </>
      )}
      {plan.state === "completed" && (
        <Link
          className="dinner-button"
          href={`/app/rooms/${room.id}?view=money&fromPlan=${plan.id}`}
        >
          Prepare outing expense ↗
        </Link>
      )}
      {(error || exportError) && (
        <p role="alert" className="dinner-error">
          {error || exportError}
        </p>
      )}
      <details>
        <summary>Plan history ({plan.history.length})</summary>
        {[...plan.history].reverse().map((h) => (
          <p key={h.id}>
            {name(h.actorId)} · {h.action}
            {h.decision ? `: ${h.decision}` : ""} ·{" "}
            {new Date(h.at).toLocaleString()}
            {h.participantIds &&
              ` · Invited: ${h.participantIds.map(name).join(", ")}`}
            {h.action === "extend_deadline" &&
              ` · Deadline: ${h.deadline ? new Date(h.deadline).toLocaleString() : "removed"}`}
            {h.confirmedIds &&
              ` · Included: ${h.confirmedIds.map(name).join(", ")}`}
            {h.terms &&
              ` · ${h.terms.localStart.replace("T", " ")} ${h.terms.timeZone}, ${h.terms.location}, ${usd(h.terms.budgetCents)}`}
          </p>
        ))}
      </details>
    </section>
  );
}
export function Plans({ room }: { room: RoomView }) {
  const [before, setBefore] = useState<string | undefined>();
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    setFocus(new URLSearchParams(window.location.search).get("plan"));
  }, []);
  return (
    <PlanPage
      key={`${before ?? "latest"}-${focus ?? "all"}`}
      room={room}
      before={before}
      focus={focus}
      navigate={(value) => {
        setFocus(null);
        setBefore(value);
        window.history.replaceState(
          null,
          "",
          `/app/rooms/${room.id}?view=plan`,
        );
      }}
    />
  );
}
function PlanPage({
  room,
  before,
  focus,
  navigate,
}: {
  room: RoomView;
  before?: string;
  focus: string | null;
  navigate: (before?: string) => void;
}) {
  const { api } = useDinner();
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const merge = useCallback(
    (incoming: PlanView[]) =>
      setPlans((current) => {
        const map = new Map(current.map((p) => [p.id, p]));
        for (const p of incoming)
          if (!map.has(p.id) || map.get(p.id)!.revision <= p.revision)
            map.set(p.id, p);
        return [...map.values()].sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        );
      }),
    [],
  );
  const refresh = useCallback(async () => {
    try {
      merge(
        focus
          ? [await api(`/rooms/${room.id}/plans/${focus}`, {}, planSchema)]
          : await api(
              `/rooms/${room.id}/plans${before ? `?before=${before}` : ""}`,
              {},
              z.array(planSchema),
            ),
      );
      setLoaded(true);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load plans");
    }
  }, [api, room.id, merge, before, focus]);
  useEffect(() => {
    void refresh();
    const sync = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(sync, 3000);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [refresh]);
  useEffect(() => {
    if (!loaded) return;
    const id = new URLSearchParams(window.location.search).get("plan");
    if (id)
      document
        .getElementById(`plan-${id}`)
        ?.scrollIntoView?.({ block: "start" });
  }, [loaded]);
  return (
    <div className="dinner-stack">
      <div className="dinner-heading">
        <div>
          <h2>Make a plan</h2>
          <p className="dinner-muted">
            Find a time. Agree on the details. Get together.
          </p>
        </div>
        <button onClick={() => setCreating(!creating)}>
          {creating ? "Close new plan" : "New plan"}
        </button>
      </div>
      {(before || focus) && (
        <button className="dinner-quiet" onClick={() => navigate()}>
          Back to latest plans
        </button>
      )}
      {creating && (
        <CreatePlan
          room={room}
          saved={(p) => {
            if (before || focus) navigate();
            else merge([p]);
            setCreating(false);
          }}
        />
      )}
      {error && (
        <p role="alert" className="dinner-error">
          {error} <button onClick={() => void refresh()}>Retry</button>
        </p>
      )}
      {!loaded && !error && <p role="status">Loading plans…</p>}
      {loaded && !plans.length && (
        <p className="dinner-card soft">
          Your next outing starts here. Propose a few times and invite people
          from this room.
        </p>
      )}
      {!focus && plans.length >= 100 && (
        <button
          className="dinner-quiet"
          onClick={() => navigate(plans[plans.length - 1].id)}
        >
          Older plans
        </button>
      )}
      {plans.map((p) => (
        <PlanCard
          key={p.id}
          plan={p}
          room={room}
          saved={(value) => merge([value])}
        />
      ))}
    </div>
  );
}
export function PlanAttention() {
  const { api, me } = useDinner();
  const [plans, setPlans] = useState<(PlanView & { roomName: string })[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const sync = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const result = await api(
          "/plans",
          {},
          z.array(planSchema.extend({ roomName: z.string() })),
        );
        if (active) {
          setPlans(result);
          setError("");
        }
      } catch {
        if (active)
          setError("Plans could not refresh. Open your room to check.");
      }
    };
    void sync();
    const timer = setInterval(() => void sync(), 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api]);
  if (!me) return null;
  return (
    <section className="dinner-card dinner-stack">
      <h3>Your plans</h3>
      {error && <p role="status">{error}</p>}
      {plans.length === 100 && (
        <p className="dinner-note">
          Showing the 100 most recently updated active plans. Open a room for
          its full history.
        </p>
      )}
      {!plans.length && !error && (
        <p className="dinner-note">Create a plan in one of your rooms.</p>
      )}
      {plans.map((p) => (
        <Link
          key={p.id}
          className="dinner-inline-link"
          href={`/app/rooms/${p.roomId}?view=plan&plan=${p.id}`}
        >
          <strong>{p.title}</strong> · {p.roomName}
          <br />
          <span>{planAttentionLabel(p, me.id)}</span>
        </Link>
      ))}
    </section>
  );
}
