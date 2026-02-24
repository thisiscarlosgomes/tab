export const runtime = "nodejs";

import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { encrypt, decrypt } from "@/lib/encryption";
import { isAddress } from "viem";
import { writeActivity } from "@/lib/writeActivity";
import { requireTrustedRequest } from "@/lib/security";
import { sendWebNotificationToUser } from "@/lib/user-notifications";

/* =========================
   Helpers
========================= */
function normalizeGameId(raw?: string): string | null {
  if (!raw) return null;

  try {
    const id = decodeURIComponent(raw)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "");

    return id.length ? id : null;
  } catch {
    return null;
  }
}

/* =========================
   GET game
========================= */
export async function GET(req: NextRequest) {
  const rawId = req.nextUrl.pathname.split("/").pop();
  const gameId = normalizeGameId(rawId);

  if (!gameId) {
    return Response.json({ error: "Missing gameId" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();
  const games = db.collection("a-split-game");

  const game = await games.findOne({ gameId });
  if (!game) {
    return Response.json({ error: "Room not found" }, { status: 404 });
  }

  /* 🔐 decrypt recipient (legacy / Mode 1 only) */
  if (game.recipient) {
    try {
      const decrypted = decrypt(game.recipient);
      game.recipient = isAddress(decrypted) ? decrypted : null;
    } catch {
      game.recipient = null;
    }
  }

  return Response.json(game);
}

/* =========================
   POST – JOIN game
========================= */
export async function POST(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "game-room-post",
    limit: 120,
    windowMs: 60_000,
  });
  if (denied) return denied;

  const rawId = req.nextUrl.pathname.split("/").pop();
  const gameId = normalizeGameId(rawId);

  if (!gameId) {
    return Response.json({ error: "Missing gameId" }, { status: 400 });
  }

  const body = await req.json();
  const { player } = body;

  if (!player?.address) {
    return Response.json({ error: "Missing player" }, { status: 400 });
  }

  const address = player.address.toLowerCase();

  const client = await clientPromise;
  const db = client.db();
  const games = db.collection("a-split-game");

  const game = await games.findOne({ gameId });
  if (!game) {
    return Response.json({ error: "Room not found" }, { status: 404 });
  }

  const alreadyInGame = game.participants.some(
    (p: any) => p.address.toLowerCase() === address
  );

  if (!alreadyInGame) {
    await games.updateOne(
      { gameId },
      { $addToSet: { participants: { ...player, address } } }
    );

    await writeActivity({
      address,
      type: "room_joined",
      refType: "room",
      refId: gameId,
      counterparty: { address: game.admin },
      timestamp: new Date(),
    });

    await writeActivity({
      address: game.admin,
      type: "room_joined",
      refType: "room",
      refId: gameId,
      counterparty: {
        address,
        name: player.name,
      },
      timestamp: new Date(),
    });
  }

  return Response.json(await games.findOne({ gameId }));
}

/* =========================
   PUT – SPIN
========================= */
export async function PUT(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "game-room-put",
    limit: 120,
    windowMs: 60_000,
  });
  if (denied) return denied;

  const rawId = req.nextUrl.pathname.split("/").pop();
  const gameId = normalizeGameId(rawId);

  if (!gameId) {
    return Response.json({ error: "Missing gameId" }, { status: 400 });
  }

  const body = await req.json();
  const { address } = body;

  if (!address) {
    return Response.json({ error: "Missing address" }, { status: 400 });
  }

  const caller = address.toLowerCase();

  const client = await clientPromise;
  const db = client.db();
  const games = db.collection("a-split-game");

  const game = await games.findOne({ gameId });
  if (!game || !game.participants?.length) {
    return Response.json({ error: "No participants" }, { status: 400 });
  }

  if (game.adminOnlySpin && caller !== game.admin) {
    return Response.json({ error: "Only admin can spin" }, { status: 403 });
  }

  if (game.chosen) {
    return Response.json({ error: "Already spun" }, { status: 400 });
  }

  const chosen =
    game.participants[Math.floor(Math.random() * game.participants.length)];

  await games.updateOne(
    { gameId },
    {
      $set: {
        chosen,
        chosenAt: new Date(),
      },
    }
  );

  return Response.json(await games.findOne({ gameId }));
}

/* =========================
   PATCH – CLOSE TAB / PAYMENT
========================= */
export async function PATCH(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "game-room-patch",
    limit: 140,
    windowMs: 60_000,
  });
  if (denied) return denied;

  const rawId = req.nextUrl.pathname.split("/").pop();
  const gameId = normalizeGameId(rawId);

  if (!gameId) {
    return Response.json({ error: "Missing gameId" }, { status: 400 });
  }

  const body = await req.json();
  const { address, amount, adminOnlySpin, spinToken, payment, closeTab } = body;

  const client = await clientPromise;
  const db = client.db();
  const games = db.collection("a-split-game");

  const game = await games.findOne({ gameId });
  if (!game) {
    return Response.json({ error: "Room not found" }, { status: 404 });
  }

  const update: any = {};
  const caller = address?.toLowerCase();

  /* -------- settings (admin only) -------- */
  if (caller && caller === game.admin) {
    if (amount !== undefined) {
      update.$set = { ...(update.$set || {}), amount };
    }

    if (adminOnlySpin !== undefined) {
      update.$set = { ...(update.$set || {}), adminOnlySpin };
    }

    if (spinToken) {
      update.$set = { ...(update.$set || {}), spinToken };
    }
  }

  /* -------- chosen user closes tab (offline settlement) -------- */
  if (closeTab === true) {
    if (!caller) {
      return Response.json({ error: "Missing address" }, { status: 400 });
    }

    if (!game.chosen) {
      return Response.json(
        { error: "Spin has not happened yet" },
        { status: 400 }
      );
    }

    if (caller !== game.chosen.address.toLowerCase()) {
      return Response.json(
        { error: "Only the chosen user can close the tab" },
        { status: 403 }
      );
    }

    const alreadyClosed = game.paid?.some((p: any) => p.address === caller);
    if (alreadyClosed) {
      return Response.json({ error: "Tab already closed" }, { status: 400 });
    }

    const closedAt = new Date();

    update.$addToSet = {
      ...(update.$addToSet || {}),
      paid: {
        address: caller,
        name: game.chosen.name,
        txHash: "offline",
        timestamp: closedAt,
      },
    };

    update.$set = {
      ...(update.$set || {}),
      archived: true,
      closedAt,
    };

    await writeActivity({
      address: caller,
      type: "room_paid",
      refType: "room",
      refId: gameId,
      amount: game.amount,
      token: game.spinToken,
      counterparty: { address: game.admin },
      timestamp: closedAt,
    });

    if (game.admin && game.admin.toLowerCase() !== caller) {
      await writeActivity({
        address: game.admin.toLowerCase(),
        type: "room_received",
        refType: "room",
        refId: gameId,
        amount: game.amount,
        token: game.spinToken,
        counterparty: {
          address: caller,
          name: game.chosen?.name,
        },
        timestamp: closedAt,
      });
    }
  }

  /* -------- legacy onchain payment (Mode 1 / advanced) -------- */
  if (payment?.address && payment?.txHash) {
    if (!game.chosen) {
      return Response.json(
        { error: "Spin has not happened yet" },
        { status: 400 }
      );
    }

    if (payment.address.toLowerCase() !== game.chosen.address.toLowerCase()) {
      return Response.json(
        { error: "Only the chosen user can pay" },
        { status: 403 }
      );
    }

    const alreadyPaid = game.paid?.some(
      (p: any) => p.address === payment.address.toLowerCase()
    );
    if (alreadyPaid) {
      return Response.json({ error: "Already paid" }, { status: 400 });
    }

    const paidAt = new Date();

    update.$addToSet = {
      ...(update.$addToSet || {}),
      paid: {
        address: payment.address.toLowerCase(),
        name: payment.name,
        txHash: payment.txHash,
        timestamp: paidAt,
      },
    };

    await writeActivity({
      address: payment.address.toLowerCase(),
      type: "room_paid",
      refType: "room",
      refId: gameId,
      amount: game.amount,
      token: game.spinToken,
      txHash: payment.txHash,
      counterparty: { address: game.admin },
      timestamp: paidAt,
    });

    if (
      game.admin &&
      game.admin.toLowerCase() !== payment.address.toLowerCase()
    ) {
      await writeActivity({
        address: game.admin.toLowerCase(),
        type: "room_received",
        refType: "room",
        refId: gameId,
        amount: game.amount,
        token: game.spinToken,
        txHash: payment.txHash,
        counterparty: {
          address: payment.address.toLowerCase(),
          name: payment.name,
        },
        timestamp: paidAt,
      });
    }
  }

  if (!update.$set && !update.$addToSet) {
  return Response.json({ error: "Nothing to update" }, { status: 400 });
}

// ✅ APPLY UPDATE FIRST
await games.updateOne({ gameId }, update);

// ✅ THEN READ UPDATED STATE
const updated = await games.findOne({ gameId });
if (!updated) {
  return Response.json(
    { error: "Room not found after update" },
    { status: 404 }
  );
}


  /* =========================
   TAB CLOSED — NOTIFY GROUP
========================= */

  if (
    updated.chosen &&
    updated.paid?.length === 1 &&
    !updated.tabClosedNotified
  ) {
    const payer = updated.chosen;

    for (const p of updated.participants ?? []) {
      try {
        await sendWebNotificationToUser({
          fid: p.fid ? Number(p.fid) : null,
          address: p.address ?? null,
        }, {
          title: "🎉 Tab settled",
          body:
            p.address.toLowerCase() === payer.address.toLowerCase()
              ? "You covered the tab. Thanks!"
              : `@${payer.name} covered the tab for everyone`,
          url: `https://usetab.app/game/${updated.gameId}`,
          tag: `game-settled-${updated.gameId}`,
        });
      } catch {
        console.warn("Tab settled notification failed for", p.fid);
      }
    }

    await games.updateOne({ gameId }, { $set: { tabClosedNotified: true } });
  }

  return Response.json(updated);

}

/* =========================
   DELETE game
========================= */
export async function DELETE(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "game-room-delete",
    limit: 40,
    windowMs: 60_000,
  });
  if (denied) return denied;

  const rawId = req.nextUrl.pathname.split("/").pop();
  const gameId = normalizeGameId(rawId);

  if (!gameId) {
    return Response.json({ error: "Missing gameId" }, { status: 400 });
  }

  const body = await req.json();
  const { address } = body;

  if (!address) {
    return Response.json({ error: "Missing address" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();
  const games = db.collection("a-split-game");

  const game = await games.findOne({ gameId });
  if (!game) {
    return Response.json({ error: "Room not found" }, { status: 404 });
  }

  if (game.admin !== address.toLowerCase()) {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }

  await games.deleteOne({ gameId });
  return Response.json({ success: true });
}
