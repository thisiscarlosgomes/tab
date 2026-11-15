import { z } from "zod";
export const awarenessStateSchema = z.object({
  mode: z.enum(["mentions", "smart"]),
  checkedSeq: z.number(),
  offeredTopics: z.array(z.string()),
  authorized: z.array(z.string()),
  offer: z
    .object({
      sourceId: z.string(),
      topicId: z.string(),
      createdAt: z.string(),
      status: z.enum(["open", "accepted", "declined", "expired", "completed"]),
      acceptedBy: z.string().optional(),
      acceptedSourceId: z.string().optional(),
      awaitingReplyId: z.string().optional(),
      participants: z.array(z.string()).optional(),
      updatedAt: z.string().optional(),
    })
    .optional(),
});
export type AwarenessState = z.infer<typeof awarenessStateSchema>;

const requestToTab = /^(?:(?:please|kindly)\s+)?(?:create|prepare|make|split|check|show|help|cancel|review|add|tell|calculate|summari[sz]e|explain|update|change|remove|delete|remind|find|list|settle|pay|send|record|open|look|confirm|stop|resume|retry|who|what|how|when|where|why|(?:can|could|would|will|do|did|are|have)\s+you|is\s+(?:there|this|that|it)|i\s+(?:paid|want|need|was)|we\s+(?:paid|want|need))\b/i;
const greetingToTab = /^(?:hey|hi|hello|hiya|yo|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you)[,! ]+tab\b/i;

/** Vocative address, not every occurrence of the assistant's name. */
export function directlyAddressesTab(text: string) {
  const value = text.trim();
  if (/^[>"'“‘`]/.test(value)) return false;
  if (/^tab[!?.,]*$/i.test(value)) return true;
  const greeting = value.match(greetingToTab);
  if (greeting) {
    const rest = value.slice(greeting[0].length).trim();
    if (!rest || /^[,!?]/.test(rest)) return true;
    return requestToTab.test(rest);
  }
  const prefix = value.match(/^(?:please\s+)?tab\b([,:!?]?)[ \t]*/i);
  if (prefix) {
    const rest = value.slice(prefix[0].length);
    // Appositive descriptions remain references, e.g. "Tab, our assistant, was helpful".
    if (/^(?:our|the|an?)\s+[^,]+,\s*(?:was|is|said|had)\b/i.test(rest)) return false;
    if (prefix[1] && rest) return true;
    return requestToTab.test(rest);
  }
  const suffix = value.match(/^(.+),\s*tab[.!?]*$/i);
  return !!suffix && (requestToTab.test(suffix[1]) || /^(?:thanks|thank you|hi|hello|hey)\b/i.test(suffix[1]));
}

export function stripTabAddress(text: string) {
  if (!directlyAddressesTab(text)) return text;
  return text.replace(greetingToTab, "").replace(/^(?:please\s+)?tab\b[,!:? ]*/i, "").replace(/,\s*tab[.!?]*$/i, "").replace(/^[,!:? ]+/, "");
}

export const defaultAssistance = (): AwarenessState => ({ mode: "smart", checkedSeq: 0, offeredTopics: [], authorized: [] });

export function repliesToTab(messages: { id: string; kind?: string }[], replyTo?: string | null) {
  return !!replyTo && messages.some(message => message.id === replyTo && message.kind === "tab");
}

/** Persisted question + same speaker + adjacent turn; no model consent inference. */
export function answersTabQuestion(
  messages: { id: string; seq: number; kind?: string; requestedBy?: string; expectsReply?: boolean; text: string; createdAt: string }[],
  source: { seq: number; authorId: string; replyTo?: string | null; text: string; createdAt: string },
) {
  if (source.replyTo || /@(?!(?:tab)\b)[\w]+/i.test(source.text)) return false;
  const previous = messages.filter(m => m.seq < source.seq).at(-1);
  if (!previous || previous.kind !== "tab" || previous.requestedBy !== source.authorId || !(previous.expectsReply ?? previous.text.includes("?"))) return false;
  const age = Date.parse(source.createdAt) - Date.parse(previous.createdAt);
  return age >= 0 && age < 15 * 60_000;
}
