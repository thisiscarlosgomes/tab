"use client";
import Link from "next/link";
import { plainAssistantText } from "@/lib/dinner/agent/plain-text";
import { Streamdown, type Components } from "streamdown";

const components: Components = {
  strong: ({ children }) => <strong>{children}</strong>,
};

/** The same Markdown renderer for saved, optimistic, and streaming messages. */
export function MessageText({ text, streaming = false, plain = false, roomId }: { text: string; streaming?: boolean; plain?: boolean; roomId?: string }) {
  if (plain) return <p style={{whiteSpace: "pre-wrap"}}>{plainAssistantText(text).replace(/View or edit:\s*(?=\/app\/rooms\/)/g, "").split(/(\/app\/rooms\/[0-9a-f-]{36}\?view=plan&plan=[0-9a-f-]{36})/g).map((part,i) => part.startsWith(`/app/rooms/${roomId}?view=plan&plan=`) ? <Link key={i} href={part} className="dinner-inline-link">View or edit details</Link> : part)}</p>;
  return (
    <Streamdown
      className="chat-markdown"
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      controls={false}
      components={components}
      skipHtml
      disallowedElements={["img"]}
    >
      {text}
    </Streamdown>
  );
}
