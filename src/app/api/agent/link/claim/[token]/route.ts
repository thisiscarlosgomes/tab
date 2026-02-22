import { createHash } from "crypto";
import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { getBearerToken, getPrivyServerClient } from "@/lib/privy-server";

type LinkedAccountLike = {
  type?: string;
  fid?: number | string;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toLinkedAccounts(user: unknown): LinkedAccountLike[] {
  if (!user || typeof user !== "object") return [];
  const maybeAccounts =
    (user as { linked_accounts?: unknown; linkedAccounts?: unknown })
      .linked_accounts ??
    (user as { linked_accounts?: unknown; linkedAccounts?: unknown })
      .linkedAccounts;
  if (!Array.isArray(maybeAccounts)) return [];
  return maybeAccounts as LinkedAccountLike[];
}

function normalizeFid(value?: number | string) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function findFarcasterFid(accounts: LinkedAccountLike[]) {
  const farcaster = accounts.find((account) => account.type === "farcaster");
  return normalizeFid(farcaster?.fid);
}

async function requirePrivyUser(req: NextRequest) {
  const token = getBearerToken(req.headers.get("authorization"));
  if (!token) {
    return {
      error: Response.json({ error: "Missing identity token" }, { status: 401 }),
      userId: "",
      linkedAccounts: [] as LinkedAccountLike[],
    };
  }

  try {
    const privy = getPrivyServerClient();
    const user = await privy.users().get({ id_token: token });
    const userId = String((user as { id?: string }).id ?? "").trim();
    const linkedAccounts = toLinkedAccounts(user);
    if (!userId) {
      return {
        error: Response.json({ error: "Invalid user" }, { status: 401 }),
        userId: "",
        linkedAccounts: [] as LinkedAccountLike[],
      };
    }
    return { error: null, userId, linkedAccounts };
  } catch {
    try {
      const privy = getPrivyServerClient();
      const verified = await privy.utils().auth().verifyAccessToken(token);
      const user = await privy.users()._get(verified.user_id);
      const userId = String((user as { id?: string }).id ?? "").trim();
      const linkedAccounts = toLinkedAccounts(user);
      if (!userId) {
        return {
          error: Response.json({ error: "Invalid user" }, { status: 401 }),
          userId: "",
          linkedAccounts: [] as LinkedAccountLike[],
        };
      }
      return { error: null, userId, linkedAccounts };
    } catch {
      return {
        error: Response.json({ error: "Invalid auth token" }, { status: 401 }),
        userId: "",
        linkedAccounts: [] as LinkedAccountLike[],
      };
    }
  }
}

async function getOptionalPrivyUserId(req: NextRequest) {
  const token = getBearerToken(req.headers.get("authorization"));
  if (!token) return null;

  try {
    const privy = getPrivyServerClient();
    const user = await privy.users().get({ id_token: token });
    const userId = String((user as { id?: string }).id ?? "").trim();
    return userId || null;
  } catch {
    try {
      const privy = getPrivyServerClient();
      const verified = await privy.utils().auth().verifyAccessToken(token);
      const user = await privy.users()._get(verified.user_id);
      const userId = String((user as { id?: string }).id ?? "").trim();
      return userId || null;
    } catch {
      return null;
    }
  }
}

function getServiceAgentKey(req: NextRequest) {
  const provided = req.headers.get("x-agent-key")?.trim();
  const expected = process.env.AGENT_EXECUTOR_KEY?.trim();
  if (!provided || !expected) return false;
  return provided === expected;
}

function getTokenFromPath(req: NextRequest) {
  const parts = req.nextUrl.pathname.split("/");
  return decodeURIComponent(parts[parts.length - 1] ?? "").trim();
}

export async function GET(req: NextRequest) {
  const rawToken = getTokenFromPath(req);
  if (!rawToken) {
    return Response.json({ error: "Missing claim token" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();
  const claims = db.collection("a-agent-link-claims");
  const claim = await claims.findOne({ tokenHash: hashToken(rawToken) });

  if (!claim) {
    return Response.json({ error: "Claim not found" }, { status: 404 });
  }

  const isExpired = new Date(claim.expiresAt).getTime() < Date.now();
  const isServiceAgent = getServiceAgentKey(req);
  const viewerUserId = isServiceAgent ? null : await getOptionalPrivyUserId(req);
  const isClaimOwner =
    !!viewerUserId &&
    claim.status === "CLAIMED" &&
    String(claim.claimedByUserId ?? "") === viewerUserId;

  return Response.json({
    status: claim.status,
    agentId: claim.agentId ?? null,
    agentName: claim.agentName ?? null,
    expiresAt: claim.expiresAt ? new Date(claim.expiresAt).toISOString() : null,
    claimedAt: claim.claimedAt ? new Date(claim.claimedAt).toISOString() : null,
    isExpired,
    ...(isServiceAgent
      ? {
          claimedByUserId: claim.claimedByUserId ?? null,
          linkId: claim.linkId ?? null,
        }
      : isClaimOwner
        ? {
            linkedUserId: claim.claimedByUserId ?? null,
          }
        : {}),
  });
}

export async function POST(req: NextRequest) {
  const rawToken = getTokenFromPath(req);
  if (!rawToken) {
    return Response.json({ error: "Missing claim token" }, { status: 400 });
  }

  const { error, userId, linkedAccounts } = await requirePrivyUser(req);
  if (error) return error;

  const client = await clientPromise;
  const db = client.db();
  const claims = db.collection("a-agent-link-claims");
  const links = db.collection("a-agent-links");
  const policies = db.collection("a-agent-access");
  const now = new Date();

  const claim = await claims.findOne({ tokenHash: hashToken(rawToken) });
  if (!claim) {
    return Response.json({ error: "Claim not found" }, { status: 404 });
  }

  if (new Date(claim.expiresAt).getTime() < now.getTime()) {
    return Response.json({ error: "Claim expired" }, { status: 410 });
  }

  if (
    claim.status === "CLAIMED" &&
    claim.claimedByUserId &&
    claim.claimedByUserId !== userId
  ) {
    return Response.json({ error: "Claim already used" }, { status: 409 });
  }

  if (claim.status === "REVOKED") {
    return Response.json({ error: "Claim revoked" }, { status: 410 });
  }

  const farcasterFid = findFarcasterFid(linkedAccounts);

  const linkUpdate = await links.findOneAndUpdate(
    {
      userId,
      agentId: claim.agentId,
    },
    {
      $set: {
        userId,
        agentId: claim.agentId,
        agentName: claim.agentName ?? null,
        status: "ACTIVE",
        farcasterFid,
        linkedAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    {
      upsert: true,
      returnDocument: "after",
    }
  );

  await claims.updateOne(
    { _id: claim._id },
    {
      $set: {
        status: "CLAIMED",
        claimedAt: now,
        claimedByUserId: userId,
        updatedAt: now,
        linkId: linkUpdate?._id ?? null,
      },
    }
  );

  const activePolicy = await policies.findOne(
    {
      userId,
      status: "ACTIVE",
      delegated: true,
    },
    { sort: { updatedAt: -1, createdAt: -1 } }
  );

  return Response.json({
    success: true,
    status: "CLAIMED",
    agentId: claim.agentId,
    agentName: claim.agentName ?? null,
    linkedUserId: userId,
    farcasterLinked: farcasterFid !== null,
    agentAccessActive: Boolean(activePolicy),
    nextStep: activePolicy
      ? null
      : "Enable Agent Access in Profile to allow token sends",
  });
}
