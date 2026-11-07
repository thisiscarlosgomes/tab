"use client";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { noteSchema, reminderSchema } from "@/lib/dinner/agent/model";
import { useDinner } from "./DinnerShell";
export function EditableNote({
  path,
  title,
  description,
  shared = false,
}: {
  path: string;
  title: string;
  description: string;
  shared?: boolean;
}) {
  const { api } = useDinner();
  const [note, setNote] = useState<z.infer<typeof noteSchema> | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryId, setRetryId] = useState(() => crypto.randomUUID());
  const load = useCallback(async () => {
    try {
      const n = await api(path, {}, noteSchema);
      setNote(n);
      setText(n.text);
      setError("");
      setRetryId(crypto.randomUUID());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notes");
    }
  }, [api, path]);
  useEffect(() => {
    void load(); /* Explicit refresh avoids overwriting unsaved edits. */
  }, [load]);
  async function save(value: string) {
    if (!note) return;
    setBusy(true);
    setError("");
    try {
      const n = await api(
        path,
        {
          method: "PUT",
          body: JSON.stringify({
            text: value,
            expectedVersion: note.version,
            clientId: retryId,
          }),
        },
        noteSchema,
      );
      setNote(n);
      setText(n.text);
      setRetryId(crypto.randomUUID());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save notes");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dinner-card">
      <h2>{title}</h2>
      <p className="dinner-note">{description}</p>
      {error && (
        <p role="alert" className="dinner-error">
          {error}
        </p>
      )}
      <form
        className="dinner-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(text);
        }}
      >
        <label>
          {shared ? "Shared notes" : "Your preferences"}
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setRetryId(crypto.randomUUID());
            }}
            maxLength={4000}
            rows={5}
            disabled={!note}
          />
        </label>
        <div className="dinner-actions">
          <button disabled={busy || !note}>Save notes</button>
          <button
            className="dinner-quiet"
            type="button"
            disabled={busy || !note}
            onClick={() => void save("")}
          >
            Remove notes
          </button>
          <button
            type="button"
            className="dinner-quiet"
            onClick={() => void load()}
          >
            Refresh notes
          </button>
        </div>
      </form>
      {note && (
        <p className="dinner-note">
          Version {note.version} ·{" "}
          {shared ? "Visible to room members" : "Private to you"}
        </p>
      )}
      {!!note?.history.length && (
        <details>
          <summary>Previous agreement versions</summary>
          {note.history
            .slice()
            .reverse()
            .map((n) => (
              <p className="dinner-note" key={n.version}>
                Version {n.version}: {n.text || "Empty"}
              </p>
            ))}
        </details>
      )}
    </section>
  );
}
export function ReminderForm({ roomId }: { roomId: string }) {
  const { api } = useDinner();
  const [text, setText] = useState("Review my outstanding shares");
  const [due, setDue] = useState("");
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="dinner-card">
      <h2>A private reminder</h2>
      <p className="dinner-note">
        Only you see this on Today when you open Tab. No email, push
        notification or background payment is sent. Times use this device’s time
        zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}.
      </p>
      <form
        className="dinner-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setStatus("");
          try {
            await api(
              "/agent/reminders",
              {
                method: "POST",
                body: JSON.stringify({
                  clientId,
                  roomId,
                  text,
                  dueAt: new Date(due).toISOString(),
                }),
              },
              reminderSchema,
            );
            setStatus("Private reminder saved. Find it on Today.");
            setClientId(crypto.randomUUID());
          } catch (e) {
            setStatus(
              e instanceof Error ? e.message : "Could not save reminder",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Remind me to
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setClientId(crypto.randomUUID());
            }}
            maxLength={240}
            required
          />
        </label>
        <label>
          When
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => {
              setDue(e.target.value);
              setClientId(crypto.randomUUID());
            }}
            required
          />
        </label>
        <button disabled={busy}>Save private reminder</button>
      </form>
      {status && (
        <p role="status" className="dinner-note">
          {status}
        </p>
      )}
    </section>
  );
}
export function RoomPlan({ roomId }: { roomId: string }) {
  return (
    <div className="dinner-grid">
      <div className="dinner-stack">
        <EditableNote
          path={`/rooms/${roomId}/agreements`}
          title="Room agreements"
          shared
          description="Versioned coordination notes, not legal contracts, debts or payment permission. Every accepted member can edit; stale versions cannot overwrite someone else’s changes."
        />
        <EditableNote
          path={`/rooms/${roomId}/memory`}
          title="What Tab should remember here"
          shared
          description="Explicit shared names and planning preferences, read when someone mentions @Tab. Don’t put private account, funding or personal balance details here. Memory never proves that someone paid."
        />
      </div>
      <ReminderForm roomId={roomId} />
    </div>
  );
}
