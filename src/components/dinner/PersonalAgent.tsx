"use client";
import { PlanProposalCards } from "./PlanProposalCards";
import { chatTimeline } from "./chat-timeline";
import { MessageText } from "./MessageText";
import { ChatMessage } from "./ChatMessage";
import { ArrowUp, Trash2 } from "lucide-react";
import { PageSkeleton } from "./PageSkeleton";
import { useCallback, useEffect, useState, useRef } from "react";
import { z } from "zod";
import { agentViewSchema, Turn, turnSchema } from "@/lib/dinner/agent/model";
import { useDinner } from "./DinnerShell";
import { sendOnEnter } from "./chat-keyboard";
import { AgentCards } from "./AgentCards";
import { LiveReply, SuggestedPrompts, useTabReply } from "./TabReply";

const PERSONAL_PROMPTS = [
  "Who owes whom across my rooms?",
  "What's still pending?",
  "Which outside reports need my confirmation?",
];
export function PersonalAgent() {
  const { api, me } = useDinner();
  const tabReply = useTabReply("/agent/respond");
  const [view, setView] = useState<z.infer<typeof agentViewSchema>>({
    messages: [],
    proposals: [],
    planProposals: [],
  });
  const hasSavedReply = view.messages.some(
    (message) => message.role === "assistant" && message.replyTo === tabReply.messageId,
  );
  const scroll = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{
    clientId: string;
    text: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const historyVersion = useRef(0);
  const clearing = useRef(false);
  const refresh = useCallback(async () => {
    if (clearing.current) return;
    const version = historyVersion.current;
    const next = await api("/agent/session", {}, agentViewSchema);
    if (version !== historyVersion.current) return;
    setView(next);
    setLoaded(true);
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
  useEffect(() => {
    if (nearBottom.current) {
      if (scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
    }
  }, [view.messages.length, tabReply.live, pending, busy]);
  async function clearChat() {
    if (busy || pending || !window.confirm("Clear your Ask Tab conversation? This removes the messages permanently. Saved preferences, pending reviews, and financial records stay unchanged.")) return;
    clearing.current = true;
    historyVersion.current += 1;
    setBusy(true);
    setError("");
    try {
      const next = await api("/agent/session", { method: "DELETE" }, agentViewSchema);
      tabReply.reset();
      setView(next);
      setText("");
    } catch {
      setError("Could not clear your chat. Please try again.");
    } finally {
      clearing.current = false;
      setBusy(false);
    }
  }
  async function respond(message: Turn) {
    setBusy(true);
    setError("");
    try {
      const result = await tabReply.ask(message.id);
      if (result.status !== "complete") setError(result.text);
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
    setText("");
    nearBottom.current = true;
    setError("");
    try {
      const message = await api(
        "/agent/messages",
        { method: "POST", body: JSON.stringify(input) },
        turnSchema,
      );
      setPending(null);
      setText("");
      setView((current) => ({
        ...current,
        messages: [
          ...current.messages.filter((m) => m.id !== message.id),
          message,
        ],
      }));
      await respond(message);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Not sent. Retry the same message.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!loaded && !error) return <PageSkeleton chat />;
  return (
    <div className="dinner-personal-page">
      <div className="dinner-personal-heading">
        <h1>Ask Tab</h1>
        <button type="button" className="dinner-quiet" onClick={() => void clearChat()} disabled={busy || !!pending || !view.messages.length}>
          <Trash2 size={16} aria-hidden="true" /> Clear chat
        </button>
      </div>
      <div className="dinner-personal-layout">
        <div className="dinner-personal-chat">
          <section className="dinner-personal-thread">
            <div
              className="dinner-agent-thread"
              ref={scroll}
              onScroll={() => {
                const el = scroll.current;
                nearBottom.current =
                  !!el && el.scrollHeight - el.scrollTop - el.clientHeight < 70;
              }}
              role="log"
              aria-label="Your saved Tab conversation"
            >
              {view.messages.length || view.proposals.length ? (
                chatTimeline(view.messages, view.proposals).map((entry) => {
                  if (entry.kind === "proposal") return <AgentCards key={`proposal:${entry.id}`} proposals={[entry.proposal]} refresh={refresh} />;
                  const m = entry.message;
                  return (
                  <ChatMessage
                    own={m.role === "user"}
                    fresh={m.replyTo !== tabReply.messageId && Date.now() - Date.parse(m.createdAt) < 15000}
                    key={m.id}
                  >
                    <div className="dinner-message-body">
                      <strong className="sr-only">
                        {m.role === "assistant" ? "Tab" : (me?.name ?? "You")}
                      </strong>
                      <MessageText plain={m.role === "assistant"} text={m.text} />
                      {m.role === "user" &&
                        !busy &&
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
                    </div>
                  </ChatMessage>
                ); })
              ) : (
                <p className="dinner-note">
                  Ask what you owe, review pending outside reports, or prepare a
                  split for one of your rooms.
                </p>
              )}
              {view.messages.length === 0 && (
                <SuggestedPrompts
                  prompts={PERSONAL_PROMPTS}
                  disabled={busy || !!pending}
                  onPick={(prompt) =>
                    void send({ clientId: crypto.randomUUID(), text: prompt })
                  }
                />
              )}
              {pending &&
                !view.messages.some((m) => m.clientId === pending.clientId) && (
                  <ChatMessage own fresh status={busy ? undefined : "Send not confirmed"}>
                    <div className="dinner-message-body">
                      <MessageText text={pending.text} />
                    </div>
                  </ChatMessage>
                )}
              {!clearing.current && ((pending && busy) || (!hasSavedReply && (tabReply.live !== null || busy))) && (
                <LiveReply label="Tab" text={pending ? "" : (tabReply.live ?? "")} />
              )}
              <div ref={bottom} />
            </div>
            {error && (
              <p className="dinner-error" role="alert">
                {error}
              </p>
            )}
            {pending && !busy && (
              <div className="dinner-error">
                Not acknowledged as sent: {pending.text}
                <button disabled={busy} onClick={() => void send(pending)}>
                  Retry same message
                </button>
              </div>
            )}
            <form
              className="dinner-form dinner-personal-composer"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim() && !busy && !pending)
                  void send({
                    clientId: crypto.randomUUID(),
                    text: text.trim(),
                  });
              }}
            >
              <label>
                <span className="sr-only">Message Tab</span>
                <textarea
                  rows={1}
                  placeholder="Message Tab…"
                  onKeyDown={sendOnEnter}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={2000}
                  required
                />
              </label>
              <button disabled={busy || !!pending || !text.trim()}>
                <ArrowUp size={20} aria-hidden="true" />
                <span className="sr-only">Ask Tab</span>
              </button>
            </form>
          </section>
          <PlanProposalCards proposals={view.planProposals} />
        </div>
      </div>
    </div>
  );
}
