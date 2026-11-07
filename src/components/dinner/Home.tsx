"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { listSchema, roomSchema } from "@/lib/dinner/client-schema";
import { totals, usd } from "@/lib/dinner/model";
import { useDinner } from "./DinnerShell";

export function Home({
  destination = "today",
}: {
  destination?: "today" | "rooms" | "activity";
}) {
  const { api, me } = useDinner();
  const router = useRouter();
  const [data, setData] = useState<z.infer<typeof listSchema> | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("Friday Dinner");
  const [purpose, setPurpose] = useState("");
  const [creationId] = useState(() => crypto.randomUUID());
  const refresh = useCallback(async () => {
    try {
      const value = await api("/rooms", {}, listSchema);
      setData(value);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load rooms");
    }
  }, [api]);
  useEffect(() => {
    if (!me) return;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10_000);
    return () => clearInterval(timer);
  }, [me, refresh]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const room = await api(
        "/rooms",
        {
          method: "POST",
          body: JSON.stringify({ name, purpose, clientId: creationId }),
        },
        roomSchema,
      );
      router.push(`/app/rooms/${room.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create room");
    } finally {
      setBusy(false);
    }
  }
  async function respond(
    roomId: string,
    invitationId: string,
    decision: "accepted" | "declined",
  ) {
    setBusy(true);
    setError("");
    try {
      await api(
        `/rooms/${roomId}/respond`,
        { method: "POST", body: JSON.stringify({ invitationId, decision }) },
        z.unknown(),
      );
      await refresh();
      if (decision === "accepted") router.push(`/app/rooms/${roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not respond");
    } finally {
      setBusy(false);
    }
  }
  if (!me) return null;
  const sum = (data?.rooms ?? []).reduce(
    (s, r) => {
      const t = totals(r, me.id);
      return { owe: s.owe + t.owe, owed: s.owed + t.owed };
    },
    { owe: 0, owed: 0 },
  );
  const drafts =
    data?.rooms.flatMap((r) =>
      r.expenses
        .filter((e) => e.status === "draft" && e.creatorId === me.id)
        .map((e) => ({ room: r, expense: e })),
    ) ?? [];
  const activities = (data?.rooms ?? [])
    .flatMap((r) => [
      {
        id: `room-${r.id}`,
        roomId: r.id,
        title: `Room created · ${r.name}`,
        detail: r.purpose,
        at: r.createdAt,
      },
      ...r.members
        .filter((m) => m.userId !== r.ownerId)
        .map((m) => ({
          id: `member-${r.id}-${m.userId}`,
          roomId: r.id,
          title: `${m.name} joined ${r.name}`,
          detail: "Membership only · no payment authority",
          at: m.joinedAt,
        })),
      ...r.expenses.map((e) => ({
        id: e.id,
        roomId: r.id,
        title: `${e.status === "draft" ? "Expense drafted" : "Expense confirmed"} · ${e.description}`,
        detail: `${r.name} · ${usd(e.totalCents)} · ${e.status === "draft" ? "No obligations yet" : "Obligations recorded, not paid"}`,
        at: e.status === "confirmed" ? e.confirmedAt : e.createdAt,
      })),
    ])
    .sort((a, b) => b.at.localeCompare(a.at));
  const roomList = (
    <section className="dinner-card">
      <div className="dinner-heading">
        <h2>Your rooms</h2>
        <span className="dinner-note">{data?.rooms.length ?? 0} together</span>
      </div>
      {data?.rooms.length ? (
        data.rooms.map((r) => (
          <Link
            className="dinner-room-row"
            href={`/app/rooms/${r.id}`}
            key={r.id}
          >
            <span className="dinner-avatar" aria-hidden="true">
              {r.name.slice(0, 1)}
            </span>
            <div className="dinner-grow">
              <h3>{r.name}</h3>
              <div className="dinner-note">
                {r.members.length}{" "}
                {r.members.length === 1 ? "person" : "people"} ·{" "}
                {r.lastMessage || r.purpose}
              </div>
            </div>
            {r.unread > 0 ? (
              <span
                className="dinner-badge"
                aria-label={`${r.unread} unread messages`}
              >
                {r.unread}
              </span>
            ) : (
              <span aria-hidden="true">↗</span>
            )}
          </Link>
        ))
      ) : (
        <div>
          <p>Every good plan starts with your people.</p>
          <p className="dinner-note">
            Make a room for your next dinner. Conversation and expenses stay
            together for the next one.
          </p>
          <button onClick={() => setCreating(true)}>
            Create your first room
          </button>
        </div>
      )}
    </section>
  );
  return (
    <>
      <div className="dinner-heading">
        <div>
          <p className="dinner-eyebrow">
            {destination === "today"
              ? `A little more together, ${me.name.split(" ")[0]}`
              : "Your shared context"}
          </p>
          <h1>
            {destination === "today"
              ? "Today"
              : destination === "rooms"
                ? "Rooms"
                : "Activity"}
          </h1>
          <p className="dinner-muted">
            {destination === "today"
              ? "Less chasing. More making plans."
              : destination === "rooms"
                ? "A place for this plan. And the next one."
                : "What happened, all in one place."}
          </p>
        </div>
        {destination !== "activity" && (
          <button onClick={() => setCreating(!creating)}>
            {creating ? "Close" : "+ New room"}
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="dinner-error">
          {error}
          <button className="dinner-small" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      {creating && (
        <section className="dinner-card" style={{ marginBottom: 24 }}>
          <h2>A new reason to get together</h2>
          <form className="dinner-form" onSubmit={create}>
            <label>
              Room name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
              />
            </label>
            <label>
              What is the plan?
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                maxLength={400}
                placeholder="Dinner this Friday. Let’s pick a place and keep the split simple."
                required
              />
            </label>
            <div className="dinner-actions">
              <button disabled={busy} type="submit">
                {busy ? "Creating…" : "Create room"}
              </button>
              <span className="dinner-note">
                A room does not need to hold money. This beta never does.
              </span>
            </div>
          </form>
        </section>
      )}
      {!data && !error && <p role="status">Finding your rooms…</p>}
      {data && destination === "today" && (
        <div className="dinner-grid">
          <div className="dinner-stack">
            <section className="dinner-card soft">
              <p className="dinner-eyebrow">Your shared expenses</p>
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
                Obligations, not cash. No payments are made in this beta.
              </p>
            </section>
            {roomList}
          </div>
          <aside className="dinner-stack">
            <section className="dinner-card">
              <h2>Needs your attention</h2>
              {data.invites.map((i) => (
                <div className="dinner-event" key={i.id}>
                  <div>
                    <h3>{i.name}</h3>
                    <p className="dinner-note">
                      {i.inviter} invited you · {i.purpose}
                    </p>
                    <p className="dinner-note">With {i.members.join(", ")}</p>
                    <div className="dinner-actions">
                      <button
                        className="dinner-small"
                        disabled={busy}
                        onClick={() => void respond(i.roomId, i.id, "accepted")}
                      >
                        Join room
                      </button>
                      <button
                        className="dinner-small dinner-quiet"
                        disabled={busy}
                        onClick={() => void respond(i.roomId, i.id, "declined")}
                      >
                        Decline
                      </button>
                    </div>
                    <p className="dinner-note">
                      Joining gives access to room conversation and shared
                      expense records, not debt or spending authority. No
                      assistant processes this room’s conversation.
                    </p>
                  </div>
                </div>
              ))}
              {drafts.map((d) => (
                <Link
                  className="dinner-event"
                  key={d.expense.id}
                  href={`/app/rooms/${d.room.id}?view=money`}
                >
                  <div>
                    <h3>Review {d.expense.description}</h3>
                    <p className="dinner-note">
                      {d.room.name} · unconfirmed draft
                    </p>
                  </div>
                  <span>↗</span>
                </Link>
              ))}
              {sum.owe > 0 && (
                <p className="dinner-note">
                  You have {usd(sum.owe)} in outstanding shares. Open a room’s
                  Money view to review them.
                </p>
              )}
              {!data.invites.length && !drafts.length && !sum.owe && (
                <>
                  <p>Nothing to chase right now.</p>
                  <p className="dinner-note">
                    Invitations and drafts that need you will land here.
                  </p>
                </>
              )}
            </section>
            <section className="dinner-card">
              <p className="dinner-eyebrow">A room for the whole plan</p>
              <h2>Make it a regular thing.</h2>
              <p className="dinner-note">
                Your conversation, receipts and expenses stay here. Next Friday
                is already one step easier.
              </p>
            </section>
          </aside>
        </div>
      )}
      {data && destination === "rooms" && (
        <>
          {roomList}
          {data.invites.length > 0 && (
            <p className="dinner-note" style={{ marginTop: 18 }}>
              <Link href="/app">
                You have {data.invites.length} pending invitations. Review them
                on Today.
              </Link>
            </p>
          )}
        </>
      )}
      {data && destination === "activity" && (
        <section className="dinner-card">
          {activities.length ? (
            activities.map((a) => (
              <Link
                href={`/app/rooms/${a.roomId}?view=money`}
                className="dinner-event"
                key={a.id}
              >
                <div>
                  <h3>{a.title}</h3>
                  <p className="dinner-note">{a.detail}</p>
                </div>
                <time dateTime={a.at}>
                  {new Date(a.at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </Link>
            ))
          ) : (
            <>
              <h2>The story starts here.</h2>
              <p className="dinner-note">
                Create a room and your shared activities will appear here. An
                expense is a record, not a payment.
              </p>
            </>
          )}
        </section>
      )}
    </>
  );
}
