"use client";

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
  const [botBusy, setBotBusy] = useState(false);
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
    if (nearBottom.current)
      bottom.current?.scrollIntoView({ block: "nearest" });
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
  async function loadProposals() {
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
    setBotBusy(true);
    setBotError("");
    try {
      const result = await api(
        `/rooms/${room.id}/bot`,
        {
          method: "POST",
          body: JSON.stringify({ messageId: message.id }),
          signal: AbortSignal.timeout(55_000),
        },
        z.object({ status: z.string(), text: z.string() }),
      );
      if (result.status !== "complete") setBotError(result.text);
      await refresh();
      await loadProposals();
    } catch (e) {
      setBotError(
        e instanceof Error
          ? e.message
          : "Tab could not reply. Your chat message is saved.",
      );
    } finally {
      setBotBusy(false);
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
      await refresh();
      if (mentionsTab(message.text)) void askTab(message);
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
  async function react(message: Message, emoji: string) {
    try {
      await api(
        `/rooms/${room.id}/messages/${message.id}/reaction`,
        {
          method: "PUT",
          body: JSON.stringify({
            emoji,
            active: !message.reactions.some(
              (r) => r.userId === me?.id && r.emoji === emoji,
            ),
          }),
        },
        messageSchema,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not react");
    }
  }
  return (
    <section className="dinner-card dinner-chat">
      <div className="dinner-heading" style={{ marginBottom: 12 }}>
        <h2>Conversation</h2>
        <span className="dinner-note">Only room members</span>
      </div>
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
        {!messages.length && (
          <div>
            <h3>The plan starts here.</h3>
            <p className="dinner-note">
              Pick a place. Share a receipt. Keep everyone in the loop.
            </p>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={message.id}>
            {message.seq > initialUnread.current &&
              message.authorId !== me?.id &&
              (!index || messages[index - 1].seq <= initialUnread.current) && (
                <p className="dinner-unread">New messages</p>
              )}
            <article className="dinner-message">
              <span className="dinner-avatar" aria-hidden="true">
                {message.kind === "tab"
                  ? "T"
                  : (
                      room.members.find((m) => m.userId === message.authorId)
                        ?.name ?? "?"
                    ).slice(0, 1)}
              </span>
              <div className="dinner-message-body">
                <div className="dinner-message-meta">
                  <strong>
                    {message.kind === "tab"
                      ? "Tab · room assistant"
                      : (room.members.find((m) => m.userId === message.authorId)
                          ?.name ?? "Member")}
                  </strong>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  {message.authorId === me?.id && <span>Sent</span>}
                </div>
                {message.replyTo && (
                  <div className="dinner-reply">
                    Replying to:{" "}
                    {messages.find((m) => m.id === message.replyTo)?.text ||
                      "an image"}
                  </div>
                )}
                {message.kind === "tab" && (
                  <p className="dinner-note">
                    Requested by{" "}
                    {room.members.find((m) => m.userId === message.requestedBy)
                      ?.name ?? "a member"}{" "}
                    · read / prepare only
                  </p>
                )}
                <p>{message.text}</p>
                {message.kind !== "tab" &&
                  message.authorId === me?.id &&
                  mentionsTab(message.text) &&
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
                <div className="dinner-message-actions">
                  <button onClick={() => setReply(message)}>Reply</button>
                  {["👍", "❤️", "🎉"].map((emoji) => (
                    <button
                      key={emoji}
                      aria-label={`React ${emoji}`}
                      aria-pressed={message.reactions.some(
                        (r) => r.emoji === emoji && r.userId === me?.id,
                      )}
                      onClick={() => void react(message, emoji)}
                    >
                      {emoji}{" "}
                      {message.reactions.filter((r) => r.emoji === emoji)
                        .length || ""}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          </div>
        ))}
        {pending
          .filter(
            (p) =>
              !messages.some(
                (m) => m.authorId === me?.id && m.clientId === p.input.clientId,
              ),
          )
          .map((p) => (
            <article className="dinner-message" key={p.input.clientId}>
              <div className="dinner-message-body">
                <p>{p.input.text || "Image message"}</p>
                <span className="dinner-note">
                  {p.state === "sending" ? "Sending…" : "Not sent"}
                </span>
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
            </article>
          ))}
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
      <p className="dinner-note">
        Tab is here when you mention @Tab. Recent text and shared notes are
        processed for addressed requests only. No payment or receipt
        confirmation can be executed by the model.
      </p>
      <button
        type="button"
        className="dinner-quiet"
        onClick={() => setText((value) => `@Tab ${value}`)}
      >
        Mention @Tab
      </button>
      <AgentCards
        proposals={proposals}
        refresh={async () => {
          await refresh();
          await loadProposals();
        }}
      />
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
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What’s the plan?"
            maxLength={2000}
          />
        </label>
        <div className="dinner-actions">
          <label className="dinner-inline-link" style={{ cursor: "pointer" }}>
            {uploading ? "Uploading…" : "+ Image or receipt"}
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
          <span className="dinner-note dinner-grow">Private · up to 2 MB</span>
          <button
            disabled={uploading || (!text.trim() && !attachments.length)}
            type="submit"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
