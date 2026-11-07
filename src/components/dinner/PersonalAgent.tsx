"use client";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { agentViewSchema, Turn, turnSchema } from "@/lib/dinner/agent/model";
import { useDinner } from "./DinnerShell";
import { EditableNote } from "./Coordination";
import { AgentCards } from "./AgentCards";
export function PersonalAgent() {
  const { api, me } = useDinner();
  const [view, setView] = useState<z.infer<typeof agentViewSchema>>({
    messages: [],
    proposals: [],
  });
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{
    clientId: string;
    text: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setView(await api("/agent/session", {}, agentViewSchema));
  }, [api]);
  useEffect(() => {
    if (me)
      void refresh().catch(() =>
        setError("Could not load your saved conversation. Retry shortly."),
      );
    const timer = setInterval(() => {
      if (me && document.visibilityState === "visible")
        void refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [me, refresh]);
  async function respond(message: Turn) {
    setBusy(true);
    setError("");
    try {
      await api(
        "/agent/respond",
        {
          method: "POST",
          body: JSON.stringify({ messageId: message.id }),
          signal: AbortSignal.timeout(55_000),
        },
        z.object({ status: z.string(), text: z.string() }),
      );
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Reply failed. Your message is saved; retry its reply.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function send(input: { clientId: string; text: string }) {
    setBusy(true);
    setPending(input);
    setError("");
    try {
      const message = await api(
        "/agent/messages",
        { method: "POST", body: JSON.stringify(input) },
        turnSchema,
      );
      setPending(null);
      setText("");
      await refresh();
      await respond(message);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Not sent. Retry the same message.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="dinner-eyebrow">Your personal Tab agent</p>
      <h1>A little help, privately.</h1>
      <p className="dinner-muted">
        Saved across visits. Reads your authorized room obligations; prepares
        review cards, never payments. Recent messages and explicit preferences
        are processed by the configured model provider when you ask.
      </p>
      <div className="dinner-grid">
        <div className="dinner-stack">
          <section className="dinner-card">
            <div
              className="dinner-agent-thread"
              role="log"
              aria-label="Your saved Tab conversation"
            >
              {view.messages.length ? (
                view.messages.map((m) => (
                  <article className="dinner-message-body" key={m.id}>
                    <strong>
                      {m.role === "assistant"
                        ? "Tab · personal assistant"
                        : "You · saved"}
                    </strong>
                    <p>{m.text}</p>
                    {m.role === "user" &&
                      !view.messages.some(
                        (a) => a.role === "assistant" && a.replyTo === m.id,
                      ) && (
                        <button
                          className="dinner-quiet"
                          disabled={busy}
                          onClick={() => void respond(m)}
                        >
                          Ask Tab to reply
                        </button>
                      )}
                  </article>
                ))
              ) : (
                <p className="dinner-note">
                  Ask what you owe, review pending outside reports, or prepare a
                  split for one of your rooms.
                </p>
              )}
            </div>
            {error && (
              <p className="dinner-error" role="alert">
                {error}
              </p>
            )}
            {pending && (
              <div className="dinner-error">
                Not acknowledged as sent: {pending.text}
                <button disabled={busy} onClick={() => void send(pending)}>
                  Retry same message
                </button>
              </div>
            )}
            <form
              className="dinner-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim())
                  void send({
                    clientId: crypto.randomUUID(),
                    text: text.trim(),
                  });
              }}
            >
              <label>
                Message Tab
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={2000}
                  required
                />
              </label>
              <button disabled={busy || !!pending}>Ask Tab</button>
            </form>
            <p className="dinner-note">
              {busy
                ? "Saving / preparing a reply…"
                : "No model action can confirm an expense or outside receipt."}
            </p>
          </section>
          <AgentCards proposals={view.proposals} refresh={refresh} />
        </div>
        <EditableNote
          path="/agent/memory"
          title="What should Tab remember?"
          description="Explicit personal names and communication/planning preferences only. Inspect, edit or remove these anytime. They are never loaded into a group prompt. No automatic harvesting from your conversation."
        />
      </div>
    </>
  );
}
