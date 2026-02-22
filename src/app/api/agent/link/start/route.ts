import { createHash, randomBytes } from "crypto";
import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { requireTrustedRequest } from "@/lib/security";

function getServiceAgentKey(req: NextRequest) {
  const provided = req.headers.get("x-agent-key")?.trim();
  const expected = process.env.AGENT_EXECUTOR_KEY?.trim();
  if (!provided || !expected) return false;
  return provided === expected;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getPublicBaseUrl(req: NextRequest) {
  return (
    process.env.PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_URL?.trim() ||
    req.nextUrl.origin
  );
}

export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "agent-link-start",
    limit: 30,
    windowMs: 60_000,
  });
  if (denied && !(denied.status === 403 && getServiceAgentKey(req))) {
    return denied;
  }

  if (!getServiceAgentKey(req)) {
    return Response.json({ error: "Unauthorized agent" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const agentId = String(body?.agentId ?? "").trim();
  const agentName = String(body?.agentName ?? "").trim();
  const expiresInMinutesInput = Number(body?.expiresInMinutes ?? 30);

  if (!agentId) {
    return Response.json({ error: "Missing agentId" }, { status: 400 });
  }

  const expiresInMinutes = Number.isFinite(expiresInMinutesInput)
    ? Math.min(24 * 60, Math.max(5, Math.floor(expiresInMinutesInput)))
    : 30;

  const token = randomBytes(24).toString("base64url");
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000);

  const client = await clientPromise;
  const db = client.db();
  const claims = db.collection("a-agent-link-claims");

  await claims.insertOne({
    tokenHash,
    status: "PENDING",
    agentId,
    agentName: agentName || null,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    createdBy: "service_agent",
  });

  const claimUrl = `${getPublicBaseUrl(req).replace(/\/$/, "")}/agent/claim/${token}`;

  return Response.json({
    success: true,
    agentId,
    claimUrl,
    expiresAt: expiresAt.toISOString(),
  });
}

