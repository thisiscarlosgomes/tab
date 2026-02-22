import { AGENT_SKILL_MARKDOWN } from "@/lib/agent-skill-markdown";

export async function GET() {
  return new Response(AGENT_SKILL_MARKDOWN, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}

