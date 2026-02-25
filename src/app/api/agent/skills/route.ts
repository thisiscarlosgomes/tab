import { NextRequest } from "next/server";
import { AGENT_SKILLS } from "@/lib/agent-skills";

function getBaseUrl(req: NextRequest) {
  return (
    process.env.PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_URL?.trim() ||
    req.nextUrl.origin
  ).replace(/\/$/, "");
}

function toAbsoluteEndpoint(baseUrl: string, endpoint: string) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

export async function GET(req: NextRequest) {
  const baseUrl = getBaseUrl(req);
  return Response.json({
    skills: AGENT_SKILLS.map((skill) => ({
      ...skill,
      endpoint: toAbsoluteEndpoint(baseUrl, skill.endpoint),
    })),
  });
}
