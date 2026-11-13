"use client";
import { useState } from "react";
import { z } from "zod";
import { useDinner } from "./DinnerShell";

const replySchema = z.object({ status: z.string(), text: z.string() });

/**
 * Requests Tab's reply to an already-saved message. Streams text when the shell supports it and
 * falls back to the JSON reply. The streamed text is a preview; the saved reply comes from refresh.
 */
export function useTabReply(path: string) {
  const { api, streamReply } = useDinner();
  const [live, setLive] = useState<string | null>(null);
  async function ask(messageId: string) {
    setLive("");
    try {
      if (streamReply)
        return await streamReply(path, messageId, (delta) =>
          setLive((text) => (text ?? "") + delta),
        );
      return await api(
        path,
        {
          method: "POST",
          body: JSON.stringify({ messageId }),
          signal: AbortSignal.timeout(55_000),
        },
        replySchema,
      );
    } finally {
      setLive(null);
    }
  }
  return { live, ask };
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
    <article className="dinner-message" aria-live="polite">
      <span className="dinner-avatar" aria-hidden="true">
        T
      </span>
      <div className="dinner-message-body">
        <strong>{label}</strong>
        <p>{text || "Tab is thinking…"}</p>
        <span className="dinner-note">Streaming · saved when complete</span>
      </div>
    </article>
  );
}
