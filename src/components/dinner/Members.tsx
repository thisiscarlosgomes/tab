"use client";
import { useState } from "react";
import { z } from "zod";
import { RoomView, invitationStatus } from "@/lib/dinner/model";
import { useDinner } from "./DinnerShell";

const friendsSchema = z.array(
  z.object({
    subject: z.string(),
    username: z.string(),
    name: z.string(),
    onTab: z.boolean(),
  }),
);
export function Members({
  room,
  refresh,
}: {
  room: RoomView;
  refresh: () => Promise<void>;
}) {
  const { api, me } = useDinner();
  const [removing, setRemoving] = useState<{
    userId: string;
    clientId: string;
  } | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [friends, setFriends] = useState<z.infer<typeof friendsSchema> | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/rooms/${room.id}/members/${removing.userId}`,
        {
          method: "DELETE",
          body: JSON.stringify({ clientId: removing.clientId }),
        },
        z.unknown(),
      );
      setRemoving(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove member");
    } finally {
      setBusy(false);
    }
  }
  async function invite(target?: { subject: string; username: string }) {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const result = await api(
        `/rooms/${room.id}/invites`,
        {
          method: "POST",
          body: JSON.stringify({
            clientId: crypto.randomUUID(),
            ...(target
              ? {
                  targetSubject: target.subject,
                  targetLabel: `@${target.username}`,
                }
              : {}),
          }),
        },
        z.object({ id: z.string(), token: z.string(), expiresAt: z.string() }),
      );
      setLink(`${window.location.origin}/app/invite/${result.token}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create invitation");
    } finally {
      setBusy(false);
    }
  }
  async function following() {
    setBusy(true);
    setError("");
    try {
      setFriends(await api("/friends", {}, friendsSchema));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "X following unavailable. You can still share an invite link.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      await api(
        `/rooms/${room.id}/invites/${id}`,
        { method: "DELETE" },
        z.unknown(),
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dinner-grid">
      <section className="dinner-card">
        <h2>Your people</h2>
        {room.members.map((m) => (
          <div className="dinner-room-row" key={m.userId}>
            <span className="dinner-avatar">{m.name.slice(0, 1)}</span>
            <div className="dinner-grow">
              <h3>
                {m.name}
                {m.userId === me?.id ? " · you" : ""}
              </h3>
              <p className="dinner-note">
                Accepted member{m.role === "owner" ? " · room owner" : ""}
              </p>
            </div>
            {room.ownerId === me?.id && m.userId !== room.ownerId && (
              <button
                className="dinner-quiet"
                disabled={busy}
                onClick={() =>
                  setRemoving({
                    userId: m.userId,
                    clientId: crypto.randomUUID(),
                  })
                }
              >
                Remove {m.name}
              </button>
            )}
          </div>
        ))}
        {removing && (
          <div
            className="dinner-outside-review"
            role="group"
            aria-label="Review member removal"
          >
            <h3>Remove from room?</h3>
            <p>
              They lose access to this room’s chat, images and Plan, including
              earlier messages. Copies they already viewed cannot be recalled.
              Their receipts, expense history, outside reports and obligations
              stay recorded. Removal does not forgive debt or forfeit a refund
              right. Their wallet keeps their totals; room ownership stays
              unchanged.
            </p>
            <div className="dinner-actions">
              <button disabled={busy} onClick={() => void remove()}>
                Remove from room
              </button>
              <button
                className="dinner-quiet"
                disabled={busy}
                onClick={() => setRemoving(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {(room.removals ?? []).map((m) => (
          <p className="dinner-note" key={m.id}>
            {m.name} · removed {new Date(m.removedAt).toLocaleDateString()} ·
            financial history preserved
          </p>
        ))}
        <p className="dinner-note">
          Room ownership is not spending authority. Nobody can move money here.
        </p>
      </section>
      <section className="dinner-card">
        <h2>Bring a friend</h2>
        <p className="dinner-note">
          Create one link per person. They preview the plan and choose to join.
          A link expires after seven days.
        </p>
        <div className="dinner-actions">
          <button disabled={busy} onClick={() => void invite()}>
            Create invite link
          </button>
          <button
            className="dinner-quiet"
            disabled={busy}
            onClick={() => void following()}
          >
            Find friends on X
          </button>
        </div>
        {error && (
          <p className="dinner-error" role="alert" style={{ marginTop: 14 }}>
            {error}
          </p>
        )}
        {link && (
          <div style={{ marginTop: 18 }}>
            <p className="dinner-linkbox">{link}</p>
            <button
              className="dinner-small dinner-quiet"
              onClick={() => {
                void navigator.clipboard
                  .writeText(link)
                  .then(() => setCopied(true))
                  .catch(() => setError("Copy the link above manually."));
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <p className="dinner-note">
              Share it yourself. Joining does not create a debt or authorize
              payment.
            </p>
          </div>
        )}
        {friends && (
          <div style={{ marginTop: 20 }}>
            <h3>People you recognize</h3>
            {friends.length ? (
              friends.map((f) => (
                <div className="dinner-room-row" key={f.subject}>
                  <div>
                    <h3>{f.name}</h3>
                    <p className="dinner-note">
                      @{f.username} ·{" "}
                      {f.onTab
                        ? "Using Rooms beta"
                        : "Not yet using Rooms beta"}
                    </p>
                  </div>
                  <button
                    className="dinner-small dinner-quiet"
                    disabled={busy}
                    onClick={() => void invite(f)}
                  >
                    Invite
                  </button>
                </div>
              ))
            ) : (
              <p className="dinner-note">
                No following found. Share a personal invite link instead.
              </p>
            )}
          </div>
        )}
        <hr className="dinner-rule" />
        <h3>Invitations</h3>
        {room.invitations.length ? (
          room.invitations.map((i) => (
            <div className="dinner-event" key={i.id}>
              <div>
                <p>{i.targetLabel ?? "Single-person share link"}</p>
                <p className="dinner-note">
                  {invitationStatus(i, new Date().toISOString())}
                </p>
              </div>
              {invitationStatus(i, new Date().toISOString()) === "pending" &&
                (room.ownerId === me?.id || i.inviterId === me?.id) && (
                  <button
                    className="dinner-small dinner-quiet"
                    disabled={busy}
                    onClick={() => void revoke(i.id)}
                  >
                    Revoke
                  </button>
                )}
            </div>
          ))
        ) : (
          <p className="dinner-note">
            No pending invitations. Your first link starts here.
          </p>
        )}
      </section>
    </div>
  );
}
