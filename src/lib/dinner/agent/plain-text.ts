/** Chat is plain text; preserve link destinations without Markdown decoration. */
export function plainAssistantText(text: string) {
  return text
    .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, "$2")
    .replace(/https?:\/\/app\/rooms\//g, "/app/rooms/")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*]\s+|\d+\.\s+)/gm, "")
    .replace(/\n+/g, " ")
    .trim();
}
