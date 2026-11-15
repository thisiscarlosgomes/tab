"use client";
import { Streamdown, type Components } from "streamdown";
const components: Components = { strong: ({ children }) => <strong>{children}</strong> };
export default function MarkdownMessage({ text, streaming }: { text: string; streaming: boolean }) {
  return <Streamdown className="chat-markdown" mode={streaming ? "streaming" : "static"}
    isAnimating={streaming} controls={false} components={components} skipHtml disallowedElements={["img"]}>
    {text}
  </Streamdown>;
}
