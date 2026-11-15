"use client";
import { PlanProposalCards } from "./PlanProposalCards";
import { planProposalSchema, proposalSourceId, type PlanProposal } from "@/lib/dinner/agent/plan-proposals";
import { ConversationPlans, ConversationPlanEvent, usePlanConversation } from "./PlanConversation";
import { answersTabQuestion, repliesToTab, directlyAddressesTab } from "@/lib/dinner/agent/awareness-schema";
import { chatTimeline } from "./chat-timeline";
import { MessageText } from "./MessageText";
import { ChatMessage } from "./ChatMessage";
import { Paperclip, ArrowUp, Reply } from "lucide-react";
import { sendOnEnter } from "./chat-keyboard";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { z } from "zod";
import {
  mentionsTab,
  proposalSchema,
  Proposal,
} from "@/lib/dinner/agent/model";
import { AgentCards } from "./AgentCards";
import { messageSchema } from "@/lib/dinner/client-schema";
import { RoomView, Message, messageInput } from "@/lib/dinner/model";
import { useDinner } from "./DinnerShell";
import { PrivateImage } from "./PrivateImage";
import { LiveReply, SuggestedPrompts, useTabReply } from "./TabReply";

const ROOM_PROMPTS = [
  "@Tab who owes whom?",
  "@Tab what's still pending?",
  "@Tab split this receipt equally",
  "@Tab draft a friendly nudge for ",
];

type Pending = {
  input: z.infer<typeof messageInput>;
  state: "sending" | "failed";
  error?: string;
};
export function Chat({
  room,
  refresh,
}: {
  room: RoomView;
  refresh: () => Promise<void>;
}) {
  const { api, me } = useDinner();
  const planConversation = usePlanConversation(room.id);
  const [planProposals, setPlanProposals] = useState<PlanProposal[]>([]);
  const tabReply = useTabReply(`/rooms/${room.id}/bot`);
  const [botRequests, setBotRequests] = useState(0);
  const botBusy = botRequests > 0;
  const [botError, setBotError] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Message | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [messages, setMessages] = useState<Message[]>(room.messages);
  const [uploadRetry, setUploadRetry] = useState<{
    file: File;
    id: string;
  } | null>(null);
  const hasSavedReply = messages.some(
    (message) => message.kind === "tab" && message.runId === tabReply.messageId,
  );
  const scroll = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastRead = useRef(0);
  const initialUnread = useRef(
    room.members.find((m) => m.userId === me?.id)?.readSeq ?? 0,
  );
  const nearBottom = useRef(true);
  useEffect(() => {
    setMessages(room.messages);
  }, [room.messages]);
  const readVisible = useCallback(() => {
    if (document.visibilityState !== "visible" || !nearBottom.current) return;
    const seq = messages.at(-1)?.seq ?? 0;
    if (seq <= lastRead.current) return;
    lastRead.current = seq;
    void api(
      `/rooms/${room.id}/read`,
      { method: "PUT", body: JSON.stringify({ seq }) },
      z.unknown(),
    ).catch(() => {
      lastRead.current = 0;
    });
  }, [api, room.id, messages]);
  useEffect(() => {
    if (nearBottom.current) {
      if (scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
    }
    readVisible();
  }, [messages.length, pending.length, readVisible]);
  useEffect(() => {
    document.addEventListener("visibilitychange", readVisible);
    return () => document.removeEventListener("visibilitychange", readVisible);
  }, [readVisible]);
  useEffect(() => {
    let active = true;
    async function catchUp() {
      if (document.visibilityState !== "visible") return;
      try {
        let after = messages.at(-1)?.seq ?? 0;
        while (active) {
          const result = await api(
            `/rooms/${room.id}/messages?after=${after}`,
            {},
            z.object({
              messages: z.array(messageSchema),
              hasMore: z.boolean(),
            }),
          );
          if (!active) return;
          const incoming = result.messages;
          setMessages((current) =>
            [
              ...new Map(
                [...current, ...incoming].map((m) => [m.id, m]),
              ).values(),
            ].sort((a, b) => a.seq - b.seq),
          );
          after = incoming.at(-1)?.seq ?? after;
          if (!result.hasMore) break;
        }
      } catch {
        /* Snapshot refresh separately shows connection state. */
      }
    }
    window.addEventListener("online", catchUp);
    return () => {
      active = false;
      window.removeEventListener("online", catchUp);
    };
  }, [api, room.id, messages]);
  useEffect(() => {
    if (nearBottom.current) {
      if (scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
    }
  }, [tabReply.live, botBusy]);
  async function loadProposals() {
    try { setPlanProposals(await api(`/rooms/${room.id}/plan-proposals`, {}, z.array(planProposalSchema))); } catch { /* Keep chat available. */ }
    try {
      setProposals(
        await api(`/rooms/${room.id}/proposals`, {}, z.array(proposalSchema)),
      );
    } catch {
      /* Keep member chat usable if proposals cannot refresh. */
    }
  }
  useEffect(() => {
    void loadProposals();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadProposals();
    }, 5000);
    return () => clearInterval(timer);
  }, [api, room.id]);
  async function askTab(message: Message) {
    setBotRequests(n => n + 1);
    setBotError("");
    try {
      const result = await tabReply.ask(message.id);
      if (!["complete", "coalesced"].includes(result.status)) setBotError(result.text);
      await refresh();
      await loadProposals();
    } catch (e) {
      setBotError(
        e instanceof Error
          ? e.message
          : "Tab could not reply. Your chat message is saved.",
      );
    } finally {
      setBotRequests(n => Math.max(0, n - 1));
    }
  }
  async function send(input: z.infer<typeof messageInput>) {
    setPending((previous) => [
      ...previous.filter((p) => p.input.clientId !== input.clientId),
      { input, state: "sending" },
    ]);
    try {
      const message = await api(
        `/rooms/${room.id}/messages`,
        { method: "POST", body: JSON.stringify(input) },
        messageSchema,
      );
      setMessages((current) =>
        [...new Map([...current, message].map((m) => [m.id, m])).values()].sort(
          (a, b) => a.seq - b.seq,
        ),
      );
      setPending((previous) =>
        previous.filter((p) => p.input.clientId !== input.clientId),
      );
      // Saving the message is sufficient to start the agent; a background
      // snapshot must not add another network round trip before the reply.
      void refresh();
      if (mentionsTab(message.text) || directlyAddressesTab(message.text) || (repliesToTab(messages, message.replyTo) || answersTabQuestion(messages, message))) void askTab(message);
      else {
        // Silent classification must not show a typing bubble or block member chat.
        void api(`/rooms/${room.id}/awareness`, { method: "POST", body: JSON.stringify({ messageId: message.id }) }, z.object({ action: z.enum(["silent", "offered", "respond"]) }))
          .then(async result => { if (result.action === "respond") await askTab(message); else if (result.action === "offered") await refresh(); })
          .catch(() => { /* Optional assistance must not mark a saved message as failed. */ });
      }
    } catch (e) {
      setPending((previous) =>
        previous.map((p) =>
          p.input.clientId === input.clientId
            ? {
                ...p,
                state: "failed",
                error: e instanceof Error ? e.message : "Send failed",
              }
            : p,
        ),
      );
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!text.trim() && !attachments.length) || uploading) return;
    const input = {
      clientId: crypto.randomUUID(),
      text: text.trim(),
      ...(reply ? { replyTo: reply.id } : {}),
      attachmentIds: attachments,
    };
    setText("");
    setReply(null);
    setAttachments([]);
    nearBottom.current = true;
    void send(input);
  }
  async function upload(file: File, clientId: string) {
    if (attachments.length >= 3) {
      setError("Attach up to three images per message");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const result = await api(
        `/rooms/${room.id}/attachments?clientId=${clientId}`,
        { method: "POST", headers: { "Content-Type": file.type }, body: file },
        z.object({ id: z.string() }),
      );
      setAttachments((current) =>
        current.includes(result.id) ? current : [...current, result.id],
      );
      setUploadRetry(null);
    } catch (e) {
      setUploadRetry({ file, id: clientId });
      setError(e instanceof Error ? e.message : "Image upload failed");
    } finally {
      setUploading(false);
    }
  }
  const proposalMessage = (proposal: PlanProposal) => {
    const source = proposalSourceId(proposal);
    return (
      messages.find((m) => m.kind === "tab" && m.runId === source)?.id ??
      messages.find((m) => m.id === source)?.id
    );
  };
  const timeline = [
    ...chatTimeline(messages, proposals),
    ...planProposals.filter(p => !proposalMessage(p)).map(proposal => ({kind: "plan-proposal" as const, id: proposal.id, createdAt: proposal.createdAt, proposal})),
    ...planConversation.feed.events.map(event => ({kind: "plan-event" as const, id: event.id, createdAt: event.at, event})),
  ].sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <section className="dinner-chat">
      <ConversationPlans room={room} feed={planConversation.feed} userId={me?.id ?? ""} />
      {planConversation.error && <p role="status">{planConversation.error}<button onClick={() => void planConversation.refresh()}>Retry plan updates</button></p>}
      <div
        className="dinner-messages"
        ref={scroll}
        role="log"
        aria-label="Room conversation"
        onScroll={() => {
          const el = scroll.current;
          nearBottom.current = Boolean(
            el && el.scrollHeight - el.scrollTop - el.clientHeight < 70,
          );
          readVisible();
        }}
      >
        {planConversation.feed.nextCursor && <button disabled={planConversation.loading} onClick={() => { nearBottom.current = false; void planConversation.older(); }}>Load earlier plan updates</button>}
        {timeline.map((entry) => {
          if (entry.kind === "plan-event") return <ConversationPlanEvent key={entry.id} event={entry.event} room={room} />;
          if (entry.kind === "plan-proposal") return <PlanProposalCards key={entry.id} proposals={[entry.proposal]} allProposals={planProposals} members={room.members} />;
          if (entry.kind === "proposal") return <AgentCards key={`proposal:${entry.id}`} room={room} proposals={[entry.proposal]} refresh={async () => { await refresh(); await loadProposals(); }} />;
          const { message, index } = entry;
          return (
          <div key={message.id}>
            {message.seq > initialUnread.current &&
              message.authorId !== me?.id &&
              (!index || messages[index - 1].seq <= initialUnread.current) && (
                <p className="dinner-unread">New messages</p>
              )}
            <ChatMessage
              own={message.kind !== "tab" && message.authorId === me?.id}
              fresh={(message.kind !== "tab" || message.runId !== tabReply.messageId) && Date.now() - Date.parse(message.createdAt) < 15000}
            >
              <div className="dinner-message-body">
                <div className={`dinner-message-meta${message.authorId === me?.id ? " sr-only" : ""}`}>
                  <strong>
                    {message.kind === "tab"
                      ? "Tab"
                      : (room.members.find((m) => m.userId === message.authorId)
                          ?.name ?? "Member")}
                  </strong>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  {message.authorId === me?.id && (
                    <span className="sr-only">Sent</span>
                  )}
                </div>
                {message.replyTo && message.kind !== "tab" && (
                  <div className="dinner-reply">
                    Replying to:{" "}
                    {messages.find((m) => m.id === message.replyTo)?.text ||
                      "an image"}
                  </div>
                )}
                <MessageText text={message.text} plain={message.kind === "tab"} roomId={room.id} />
                <PlanProposalCards proposals={planProposals.filter(p => proposalMessage(p) === message.id)} allProposals={planProposals} members={room.members} />
                {message.kind !== "tab" &&
                  message.authorId === me?.id &&
                  !botBusy &&
                  (mentionsTab(message.text) || directlyAddressesTab(message.text) || (repliesToTab(messages, message.replyTo) || answersTabQuestion(messages, message)) || room.assistance?.authorized.includes(message.id)) &&
                  !messages.some(
                    (m) => m.kind === "tab" && m.runId === message.id,
                  ) && (
                    <button
                      className="dinner-quiet"
                      disabled={botBusy}
                      onClick={() => void askTab(message)}
                    >
                      {botBusy ? "Tab is preparing…" : "Ask Tab to reply"}
                    </button>
                  )}
                {message.attachmentIds.map((id) => (
                  <PrivateImage key={id} id={id} roomId={room.id} />
                ))}
              </div>
              <div className="dinner-message-actions">
                <button type="button" aria-label="Reply" title="Reply" onClick={() => {
                  setReply(message);
                  document.getElementById("room-message-input")?.focus();
                }}><Reply size={18} aria-hidden="true" /></button>
              </div>
            </ChatMessage>
          </div>
        ); })}
        {pending
          .filter(
            (p) =>
              !messages.some(
                (m) => m.authorId === me?.id && m.clientId === p.input.clientId,
              ),
          )
          .map((p) => (
            <ChatMessage own fresh key={p.input.clientId} status={p.state === "sending" ? undefined : "Send not confirmed"}>
              <div className="dinner-message-body">
                <MessageText text={p.input.text || "Image message"} />
                {p.state === "failed" && (
                  <div className="dinner-actions">
                    <p className="dinner-note">{p.error}</p>
                    <button
                      className="dinner-small dinner-quiet"
                      onClick={() => void send(p.input)}
                    >
                      Retry same message
                    </button>
                  </div>
                )}
              </div>
            </ChatMessage>
          ))}
        {((!hasSavedReply && (tabReply.live !== null || botBusy)) ||
          pending.some(
            (p) => p.state === "sending" && (mentionsTab(p.input.text) || directlyAddressesTab(p.input.text) || repliesToTab(messages, p.input.replyTo)),
          )) && <LiveReply label="Tab" text={hasSavedReply ? "" : (tabReply.live ?? "")} />}
        {messages.length === 0 && (
          <SuggestedPrompts
            prompts={ROOM_PROMPTS}
            disabled={botBusy}
            onPick={(prompt) => setText(prompt)}
          />
        )}
        <div ref={bottom} />
      </div>
      {error && (
        <div className="dinner-error" role="alert">
          {error}
          {uploadRetry && (
            <button
              className="dinner-small"
              disabled={uploading}
              onClick={() => void upload(uploadRetry.file, uploadRetry.id)}
            >
              Retry upload
            </button>
          )}
        </div>
      )}
      {botError && (
        <p role="status" className="dinner-error">
          {botError} The member message is saved. Use Ask Tab to reply to retry
          without resending it.
        </p>
      )}
      <form className="dinner-composer" onSubmit={submit}>
        {reply && (
          <div className="dinner-actions">
            <span className="dinner-note">
              Replying to {reply.text.slice(0, 55) || "image"}
            </span>
            <button
              type="button"
              className="dinner-small dinner-quiet"
              onClick={() => setReply(null)}
            >
              Cancel reply
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="dinner-actions">
            {attachments.map((id, index) => (
              <button
                type="button"
                className="dinner-small dinner-quiet"
                key={id}
                onClick={() =>
                  setAttachments((list) => list.filter((item) => item !== id))
                }
              >
                Image {index + 1} · Remove
              </button>
            ))}
          </div>
        )}
        <label>
          <span className="sr-only">Message the room</span>
          <textarea
            id="room-message-input"
            rows={1}
            onKeyDown={sendOnEnter}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message the room… @Tab for help"
            maxLength={2000}
          />
        </label>
        <div className="dinner-actions">
          <label
            className="dinner-inline-link"
            title="Private image or receipt · up to 2 MB"
            style={{ cursor: "pointer" }}
          >
            <Paperclip size={22} aria-hidden="true" />
            <span className="sr-only">
              {uploading ? "Uploading…" : "Attach image or receipt"}
            </span>
            <input
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file, crypto.randomUUID());
                e.target.value = "";
              }}
            />
          </label>
          <button
            disabled={uploading || (!text.trim() && !attachments.length)}
            type="submit"
          >
            <ArrowUp size={20} aria-hidden="true" />
            <span className="sr-only">Send</span>
          </button>
        </div>
      </form>
    </section>
  );
}
