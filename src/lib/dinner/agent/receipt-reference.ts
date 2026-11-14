import type { Message } from "../model";

/** Resolve an explicit reply or nearby reference without looking beyond the tagged turn. */
export function referencedRoomMessage(messages: Message[], source: Message): Message | undefined {
  if (source.attachmentIds.length) return source;
  if (source.replyTo) {
    const linked = messages.find((m) => m.id === source.replyTo && m.seq < source.seq);
    if (linked?.kind === "tab") {
      const origin = messages.find(m => m.id === linked.runId && m.seq < linked.seq);
      // Follow persisted reply provenance, never the assistant's generated wording.
      return origin ? referencedRoomMessage(messages, origin) ?? origin : undefined;
    }
    return linked;
  }
  if (/^(?:@?tab\s*)?\^+$/i.test(source.text.trim()) || /\b(?:message\s+(?:above|before)|(?:previous|last|above)\s+(?:message|image|receipt)|(?:check|see|look at|use)\s+(?:the\s+)?(?:above|this|that))\b/i.test(source.text)) {
    const previous = messages.filter((m) => m.seq < source.seq && m.kind !== "tab").at(-1);
    if (previous) return previous;
  }
  return undefined;
}

export function referencedReceipt(messages: Message[], source: Message): Message | undefined {
  const message = referencedRoomMessage(messages, source);
  return message?.attachmentIds.length ? message : undefined;
}

/** A separate manual bill must not inherit an unrelated receipt task. */
export function requestsManualBill(messages: Message[], source: Message): boolean {
  const reference = referencedRoomMessage(messages, source);
  if (reference && reference.authorId === source.authorId && !reference.attachmentIds.length)
    source = { ...source, text: reference.text };
  if (referencedReceipt(messages, source) || /\breceipt\b/i.test(source.text)) return false;
  return /\b(?:create|make|prepare)\s+(?:(?:a|an|the|new|another|separate)\s+)*(?:bill|expense|tab)\b|\b(?:new|another|separate)\s+(?:bill|expense|split|tab)\b/i.test(source.text);
}
