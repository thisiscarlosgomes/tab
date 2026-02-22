import { AGENT_SKILLS } from "@/lib/agent-skills";

export async function GET() {
  return Response.json({
    skills: AGENT_SKILLS,
  });
}

