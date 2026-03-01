export const runtime = "nodejs";

import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { encrypt } from "@/lib/encryption";
import { writeActivity } from "@/lib/writeActivity";
import { requireTrustedRequest } from "@/lib/security";
import { getCanonicalUserProfileByFid } from "@/lib/user-profile";
import { sendWebNotificationToUser } from "@/lib/user-notifications";
import { resolveTwitterRecipientByUsername } from "@/lib/twitter";

/* =========================
   Helpers
========================= */
function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeAddress(value?: string | null) {
  return typeof value === "string" && value ? value.toLowerCase() : null;
}

function normalizeFid(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function resolvePreferredGamePlayer(player: any) {
  const fallbackAddress = normalizeAddress(player?.address);
  const fid = normalizeFid(player?.fid);

  if (fid) {
    const profile = await getCanonicalUserProfileByFid(fid).catch(() => null);
    const tabAddress = normalizeAddress(profile?.primaryAddress);
    if (tabAddress) {
      return {
        ...player,
        fid,
        address: tabAddress,
        payoutAddressSource: "tab_wallet",
        farcasterVerifiedAddress: fallbackAddress,
      };
    }
  }

  return {
    ...player,
    fid,
    address: fallbackAddress,
    payoutAddressSource: "farcaster_verified",
    farcasterVerifiedAddress: fallbackAddress,
  };
}

async function resolvePreferredInvitedPlayer(invited: any) {
  const fallbackAddress = normalizeAddress(invited?.address);
  const fid = normalizeFid(invited?.fid);
  const provider =
    typeof invited?.provider === "string" && invited.provider
      ? invited.provider
      : null;
  const name =
    typeof invited?.name === "string" && invited.name.trim()
      ? invited.name.trim()
      : typeof invited?.username === "string" && invited.username.trim()
        ? invited.username.trim()
        : "friend";
  const pfp =
    typeof invited?.pfp === "string" && invited.pfp
      ? invited.pfp
      : typeof invited?.pfp_url === "string" && invited.pfp_url
        ? invited.pfp_url
        : null;

  if (fid) {
    const profile = await getCanonicalUserProfileByFid(fid).catch(() => null);
    const tabAddress = normalizeAddress(profile?.primaryAddress);
    return {
      fid,
      name,
      pfp,
      address: tabAddress ?? fallbackAddress,
      payoutAddressSource: tabAddress ? "tab_wallet" : "farcaster_verified",
      farcasterVerifiedAddress: fallbackAddress,
    };
  }

  if (
    provider === "twitter" &&
    typeof invited?.username === "string" &&
    invited.username.trim()
  ) {
    const resolved = await resolveTwitterRecipientByUsername(invited.username).catch(
      () => null
    );
    return {
      fid: null,
      name,
      pfp,
      address: normalizeAddress(resolved?.address) ?? fallbackAddress,
      payoutAddressSource: resolved?.address ? "twitter" : "twitter_pending",
      twitter_subject:
        typeof invited?.twitter_subject === "string" ? invited.twitter_subject : null,
      username: invited.username,
      farcasterVerifiedAddress: fallbackAddress,
    };
  }

  return {
    fid: null,
    name,
    pfp,
    address: fallbackAddress,
    payoutAddressSource: "farcaster_verified",
    farcasterVerifiedAddress: fallbackAddress,
  };
}

/* =========================
   POST – Create room
========================= */
export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "game-create",
    limit: 80,
    windowMs: 60_000,
  });
  if (denied) return denied;

  console.log("➡️ POST /api/game");

  /* ---------- parse body ---------- */
  let body: any;
  try {
    body = await req.json();
    console.log("✅ req.json:", body);
  } catch (err) {
    console.error("❌ Invalid JSON body", err);
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, player, amount, spinToken, invited } = body;


  if (!player?.address) {
    return Response.json({ error: "Missing player" }, { status: 400 });
  }

  const resolvedPlayer = await resolvePreferredGamePlayer(player);
  if (!resolvedPlayer?.address) {
    return Response.json({ error: "Missing player" }, { status: 400 });
  }

  /* ---------- normalize address ---------- */
  const address = resolvedPlayer.address.toLowerCase();

  /* ---------- generate gameId ---------- */
  const base = slugify(name || "room");
  const suffix = Math.random().toString(36).slice(2, 6);
  const gameId = `${base}-${suffix}`;

  console.log("🏷 gameId:", gameId);

  /* ---------- encrypt recipient ---------- */
  let encryptedRecipient: string;
  try {
    encryptedRecipient = encrypt(address);
  } catch (err) {
    console.error("❌ encrypt failed", err);
    return Response.json({ error: "Encryption failed" }, { status: 500 });
  }

  /* ---------- connect DB ---------- */
  let client;
  try {
    client = await clientPromise;
  } catch (err) {
    console.error("❌ Mongo connection failed", err);
    return Response.json({ error: "Database connection failed" }, { status: 500 });
  }

  const db = client.db();
  const games = db.collection("a-split-game");

  const createdAt = new Date();
  const invitedInput = Array.isArray(invited) ? invited : [];
  const invitedResolvedRaw = await Promise.all(
    invitedInput.map((entry: any) => resolvePreferredInvitedPlayer(entry).catch(() => null))
  );
  const seenInviteKeys = new Set<string>();
  const creatorAddressLower = address;
  const creatorFid = normalizeFid(resolvedPlayer.fid);
  const invitedResolved = invitedResolvedRaw
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) => {
      if (
        creatorFid !== null &&
        creatorFid !== undefined &&
        entry.fid !== null &&
        entry.fid !== undefined &&
        Number(entry.fid) === Number(creatorFid)
      ) {
        return false;
      }
      if (
        entry.address &&
        entry.address.toLowerCase() === creatorAddressLower.toLowerCase()
      ) {
        return false;
      }
      const key =
        entry.fid !== null && entry.fid !== undefined
          ? `fid:${entry.fid}`
          : `addr:${entry.address ?? entry.name}`;
      if (seenInviteKeys.has(key)) return false;
      seenInviteKeys.add(key);
      return true;
    });

  /* ---------- create game ---------- */
  const game = {
  gameId,
  name: name || "Untitled room",

  admin: address,
  participants: [resolvedPlayer],
  invited: invitedResolved,

  recipient: encryptedRecipient,
  amount: typeof amount === "number" ? amount : 1,
  spinToken: spinToken || "USDC",

  chosen: null,
  adminOnlySpin: true,
  paid: [],

  createdAt,
  expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
};

  console.log("📦 Inserting game:", game);

  try {
    await games.insertOne(game);
    console.log("✅ Game inserted");
  } catch (err) {
    console.error("❌ insertOne failed", err);
    return Response.json({ error: "Failed to create room" }, { status: 500 });
  }

  /* ---------- activity (non-blocking) ---------- */
  void writeActivity({
    address,
    type: "room_created",
    refType: "room",
    refId: gameId,
    timestamp: createdAt,
  }).catch((err) => {
    console.error("⚠️ Activity write failed", err);
  });

  for (const invitedPlayer of invitedResolved) {
    const invitedAddress = normalizeAddress(invitedPlayer?.address);
    if (!invitedAddress) continue;
    void writeActivity({
      address: invitedAddress,
      type: "room_invited",
      refType: "room",
      refId: gameId,
      counterparty: {
        address,
        name: resolvedPlayer.name,
        pfp: resolvedPlayer.pfp,
      },
      timestamp: createdAt,
    }).catch(() => {
      // best-effort
    });
  }

  console.log("🎉 Room created:", gameId);

  if (invitedResolved.length > 0) {
    void Promise.all(
      invitedResolved.map(async (p) => {
        try {
          await sendWebNotificationToUser(
            {
              fid: p.fid ?? null,
              address: p.address ?? null,
            },
            {
              title: "Spin invite",
              body: `@${resolvedPlayer.name} invited you to a spin tab`,
              url: `https://usetab.app/game/${gameId}`,
              tag: `spin-invite-${gameId}`,
            }
          );
        } catch {
          // best-effort
        }
      })
    );
  }

  return Response.json({ gameId });
}
