"use client";
import { MessageText } from "./MessageText";
import { ChatMessage } from "./ChatMessage";
import { useRef, useState } from "react";
import { z } from "zod";
import { useDinner } from "./DinnerShell";

const replySchema = z.object({ status: z.string(), text: z.string() });

/**
 * Requests Tab's reply to an already-saved message. Streams text when the shell supports it and
 * falls back to the JSON reply. The streamed text is a preview; the saved reply comes from refresh.
 */
export function useTabReply(path: string) {
  const { api, streamReply } = useDinner();
  const [messageId, setMessageId] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const latest = useRef(0);
  async function ask(messageId: string) {
    const request = ++latest.current;
    setMessageId(messageId);
    setLive("");
    try {
      const result = streamReply
        ? await streamReply(path, messageId, (delta) =>
            request === latest.current && setLive((text) => (text ?? "") + delta),
          )
        : await api(
            path,
            {
              method: "POST",
              body: JSON.stringify({ messageId }),
              signal: AbortSignal.timeout(55_000),
            },
            replySchema,
          );
      // Keep the completed preview until the transcript contains its saved reply.
      // Clearing here used to flash typing dots while refresh was still in flight.
      if (request === latest.current) setLive(result.status === "complete" ? result.text : null);
      return result;
    } catch (error) {
      if (request === latest.current) setLive(null);
      throw error;
    }
  }
  return { live, messageId, ask, reset: () => { setLive(null); setMessageId(null); } };
}

export function SuggestedPrompts({
  prompts,
  disabled,
  onPick,
}: {
  prompts: string[];
  disabled?: boolean;
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="dinner-actions" aria-label="Suggested questions for Tab">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          className="dinner-small dinner-quiet"
          disabled={disabled}
          onClick={() => onPick(prompt)}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}

/** Unsaved, in-progress reply preview. */
export function LiveReply({ label, text }: { label: string; text: string }) {
  return (
    <ChatMessage fresh label="Tab reply">
      <div className="dinner-message-body">
        <strong className="sr-only">{label}</strong>
        {text ? (
          <MessageText plain text={text} streaming />
        ) : (
          <span
            className="dinner-typing"
            role="status"
            aria-label="Tab is typing"
          >
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
    </ChatMessage>
  );
}
