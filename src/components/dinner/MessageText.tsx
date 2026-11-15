"use client";
import Link from "next/link";
import { plainAssistantText } from "@/lib/dinner/agent/plain-text";
import { lazy, Suspense } from "react";
const MarkdownMessage = lazy(() => import("./MarkdownMessage"));

/** The same Markdown renderer for saved, optimistic, and streaming messages. */
export function MessageText({ text, streaming = false, plain = false, roomId }: { text: string; streaming?: boolean; plain?: boolean; roomId?: string }) {
  if (plain) return <p style={{whiteSpace: "pre-wrap"}}>{plainAssistantText(text).replace(/View or edit:\s*(?=\/app\/rooms\/)/g, "").split(/(\/app\/rooms\/[0-9a-f-]{36}\?view=plan&plan=[0-9a-f-]{36})/g).map((part,i) => part.startsWith(`/app/rooms/${roomId}?view=plan&plan=`) ? <Link key={i} href={part} className="dinner-inline-link">View or edit details</Link> : part)}</p>;
  const fallback = <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</p>;
  // Most texts have no formatting. Keep them synchronous, including optimistic sends.
  if (!/[*_`#~\[\]<>]|https?:|^\s*(?:[-+]|\d+\.)\s/m.test(text)) return fallback;
  return <Suspense fallback={fallback}><MarkdownMessage text={text} streaming={streaming} /></Suspense>;
}
