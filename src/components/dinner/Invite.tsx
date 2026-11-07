"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { z } from "zod";
import { inviteAccountSchema, previewSchema } from "@/lib/dinner/client-schema";
import { useDinner } from "./DinnerShell";

export function Invite({ token }: { token: string }) {
  const { api, me } = useDinner();
  const { authenticated, login, logout } = usePrivy();
  const router = useRouter();
  const [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(
    null,
  );
  const [account, setAccount] = useState<z.infer<
    typeof inviteAccountSchema
  > | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api(`/invites/${token}`, {}, previewSchema)
      .then((p) => {
        if (active) setPreview(p);
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load invitation",
          );
      });
    return () => {
      active = false;
    };
  }, [api, token]);
  useEffect(() => {
    let active = true;
    setAccount(null);
    if (me)
      void api(`/invites/${token}/account`, {}, inviteAccountSchema)
        .then((value) => {
          if (active) setAccount(value);
        })
        .catch((e: unknown) => {
          if (active)
            setError(
              e instanceof Error
                ? e.message
                : "Could not check the invited account",
            );
        });
    return () => {
      active = false;
    };
  }, [api, me, token]);
  async function respond(decision: "accepted" | "declined") {
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/invites/${token}/respond`,
        { method: "POST", body: JSON.stringify({ decision }) },
        z.object({ roomId: z.string(), status: z.string() }),
      );
      if (decision === "accepted")
        router.replace(`/app/rooms/${result.roomId}`);
      else setPreview((p) => (p ? { ...p, status: "declined" } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not respond");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dinner-card dinner-invite">
      <p className="dinner-eyebrow">You’re invited</p>
      {error && (
        <p className="dinner-error" role="alert">
          {error}
        </p>
      )}
      {!preview ? (
        <p role="status">Opening your invitation…</p>
      ) : (
        <>
          <h1>{preview.name}</h1>
          <p>{preview.purpose}</p>
          <p className="dinner-muted">
            Invited by {preview.inviter}
            {preview.targetLabel ? ` · For ${preview.targetLabel}` : ""}
          </p>
          {preview.accountBound && (
            <p className="dinner-note">
              This invitation is bound to the invited X account, not just a
              matching name.
            </p>
          )}
          {authenticated && account && !account.canRespond && (
            <div className="dinner-error" role="status">
              <p>
                {account.reason === "different_account"
                  ? "You’re signed in with a different X account. Sign out, then sign in with the invited X account. This invitation link will stay open; joining never creates a debt."
                  : account.reason === "resolved_by_another"
                    ? "This single-person invitation was already used by another account. Ask the organizer for a new invitation."
                    : "This invitation has expired or was revoked. Ask your friend for a new link."}
              </p>
              {account.reason === "different_account" && (
                <button className="dinner-quiet" onClick={() => void logout()}>
                  Sign out to switch X account
                </button>
              )}
            </div>
          )}
          <div className="dinner-people">
            {preview.members.map((name, index) => (
              <span className="dinner-chip" key={`${name}-${index}`}>
                {name}
              </span>
            ))}
          </div>
          <hr className="dinner-rule" />
          <h3>Just a room. Not a money commitment.</h3>
          <p className="dinner-note">
            Joining gives you access to the conversation and shared expenses. It
            creates no debt, authorizes no payment and grants no spending
            authority. This beta does not hold or move money.
          </p>
          <p className="dinner-note">
            Conversation and receipt images are private to accepted members.
            When someone mentions @Tab, the recent room text and shared notes
            are sent to the configured model provider for that reply; ordinary
            conversation triggers no automatic reply. Room members may record
            explicitly selected expense shares; you can flag a mistake.
          </p>
          <p className="dinner-note">
            Invite status: {preview.status} · Expires{" "}
            {new Date(preview.expiresAt).toLocaleDateString("en-US")}
          </p>
          {preview.status === "pending" ? (
            !authenticated ? (
              <button onClick={() => login({ loginMethods: ["twitter"] })}>
                Sign in with X to review
              </button>
            ) : (
              <>
                <p className="dinner-note">
                  Joining as {me?.name ?? "your signed-in account"}
                  {!account ? " · Checking invited account…" : ""}
                </p>
                <div className="dinner-actions">
                  <button
                    disabled={busy || !me || !account?.canRespond}
                    onClick={() => void respond("accepted")}
                  >
                    {busy ? "Working…" : "Join room"}
                  </button>
                  <button
                    className="dinner-quiet"
                    disabled={busy || !me || !account?.canRespond}
                    onClick={() => void respond("declined")}
                  >
                    Decline
                  </button>
                </div>
              </>
            )
          ) : preview.status === "accepted" && authenticated ? (
            <button
              disabled={busy || !account?.canRespond}
              onClick={() => void respond("accepted")}
            >
              Open accepted room
            </button>
          ) : (
            <p>
              This link is no longer pending. Ask your friend for a new
              invitation if needed.
            </p>
          )}
        </>
      )}
    </section>
  );
}
