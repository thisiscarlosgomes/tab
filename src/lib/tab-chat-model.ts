import { openai } from "@ai-sdk/openai";
// Shared by the legacy read-only assistant and the scoped dinner runtime.
// Keep the existing provider/model convention; no new vendor or key is introduced.
export function getTabChatModel() {
  return openai(process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini");
}
