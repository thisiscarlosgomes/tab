"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { z } from "zod";
import { previewSchema } from "@/lib/dinner/client-schema";
import { useDinner } from "./DinnerShell";

export function Invite({ token }: { token: string }) {
  const { api, me } = useDinner();
  const { authenticated, login } = usePrivy();
  const router = useRouter();
  const [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(
    null,
  );
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
            Conversation and receipt images are private to accepted members. No
            room assistant processes your conversation in this slice. Room
            members may record explicitly selected expense shares; you can flag
            a mistake.
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
                </p>
                <div className="dinner-actions">
                  <button
                    disabled={busy || !me}
                    onClick={() => void respond("accepted")}
                  >
                    {busy ? "Working…" : "Join room"}
                  </button>
                  <button
                    className="dinner-quiet"
                    disabled={busy || !me}
                    onClick={() => void respond("declined")}
                  >
                    Decline
                  </button>
                </div>
              </>
            )
          ) : preview.status === "accepted" && authenticated ? (
            <button disabled={busy} onClick={() => void respond("accepted")}>
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
