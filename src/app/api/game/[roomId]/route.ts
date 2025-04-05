import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { encrypt, decrypt } from "@/lib/encryption";
import { isAddress } from "viem";

export async function GET(req: NextRequest) {
  const urlParts = req.nextUrl.pathname.split("/");
  const rawId = urlParts[urlParts.length - 1];
  const roomId = decodeURIComponent(rawId).toLowerCase().replace(/\s+/g, "_");

  if (!roomId) {
    return new Response(JSON.stringify({ error: "Missing roomId" }), {
      status: 400,
    });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-split-game");

  const game = await collection.findOne(
    { gameId: roomId },
    { collation: { locale: "en", strength: 2 } }
  );

  if (!game) {
    return new Response(JSON.stringify({ error: "Room not found" }), {
      status: 404,
    });
  }

  // 🔐 Decrypt recipient if it exists
  if (game.recipient) {
    try {
      const decrypted = decrypt(game.recipient);
      game.recipient = isAddress(decrypted) ? decrypted : "Invalid address";
    } catch {
      game.recipient = "Invalid encrypted address";
    }
  }

  return Response.json(game);
}

export async function POST(req: NextRequest) {
  const urlParts = req.nextUrl.pathname.split("/");
  const rawId = urlParts[urlParts.length - 1];
  const roomId = decodeURIComponent(rawId).toLowerCase().replace(/\s+/g, "_");

  if (!roomId) {
    return new Response(JSON.stringify({ error: "Missing roomId" }), {
      status: 400,
    });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-split-game");

  const body = await req.json();
  const { player } = body;

  if (!player?.address) {
    return new Response(JSON.stringify({ error: "Missing player address" }), {
      status: 400,
    });
  }

  const existingGame = await collection.findOne(
    { gameId: roomId },
    { collation: { locale: "en", strength: 2 } }
  );

  if (existingGame) {
    // 🔁 JOIN flow — just add user to participants if not already present
    const isAlreadyParticipant = (
      existingGame.participants as { address: string }[]
    ).some((p) => p.address.toLowerCase() === player.address.toLowerCase());

    if (!isAlreadyParticipant) {
      await collection.updateOne(
        { gameId: roomId },
        { $addToSet: { participants: player } }
      );
    }

    const updated = await collection.findOne(
      { gameId: roomId },
      { collation: { locale: "en", strength: 2 } }
    );
    return Response.json(updated);
  }

  // 🆕 CREATE flow
  const playerWithPfp = { ...player };

  await collection.insertOne({
    gameId: roomId,
    participants: [playerWithPfp],
    admin: playerWithPfp.address,
    recipient: "",
    amount: 0.01,
    chosen: null,
    adminOnlySpin: false,
    paid: [],
    createdAt: new Date(), // ✅ add this line
  });

  const updated = await collection.findOne(
    { gameId: roomId },
    { collation: { locale: "en", strength: 2 } }
  );
  return Response.json(updated);
}

export async function PUT(req: NextRequest) {
  const urlParts = req.nextUrl.pathname.split("/");
  const rawId = urlParts[urlParts.length - 1];
  const roomId = decodeURIComponent(rawId).toLowerCase().replace(/\s+/g, "_");

  if (!roomId) {
    return new Response(JSON.stringify({ error: "Missing roomId" }), {
      status: 400,
    });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-split-game");

  const game = await collection.findOne(
    { gameId: roomId },
    { collation: { locale: "en", strength: 2 } }
  );

  if (!game || !game.participants || game.participants.length === 0) {
    return new Response(
      JSON.stringify({ error: "No participants to choose from" }),
      { status: 400 }
    );
  }

  const randomIndex = Math.floor(Math.random() * game.participants.length);
  const chosen = game.participants[randomIndex];

  await collection.updateOne({ gameId: roomId }, { $set: { chosen } });

  const updated = await collection.findOne(
    { gameId: roomId },
    { collation: { locale: "en", strength: 2 } }
  );

  return Response.json(updated);
}

export async function PATCH(req: NextRequest) {
  const urlParts = req.nextUrl.pathname.split("/");
  const rawId = urlParts[urlParts.length - 1];
  const roomId = decodeURIComponent(rawId).toLowerCase().replace(/\s+/g, "_");

  if (!roomId) {
    return new Response(JSON.stringify({ error: "Missing roomId" }), {
      status: 400,
    });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-split-game");

  const body = await req.json();
  const { address, recipient, amount, adminOnlySpin } = body;

  // if (
  //   !address ||
  //   (recipient === undefined &&
  //     amount === undefined &&
  //     adminOnlySpin === undefined &&
  //     !body.payment)
  // ) {
  //   return new Response(
  //     JSON.stringify({ error: "Missing or invalid fields" }),
  //     { status: 400 }
  //   );
  // }

  if (
    (!body.address && !body.payment?.address) ||
    (recipient === undefined &&
      amount === undefined &&
      adminOnlySpin === undefined &&
      !body.payment)
  ) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid fields" }),
      { status: 400 }
    );
  }

  const game = await collection.findOne(
    { gameId: roomId },
    { collation: { locale: "en", strength: 2 } }
  );

  // if (!game || game.admin.toLowerCase() !== address.toLowerCase()) {
  //   return new Response(JSON.stringify({ error: "Not authorized" }), { status: 403 });
  // }

  if (!game) {
    return new Response(JSON.stringify({ error: "Room not found" }), {
      status: 404,
    });
  }

  const isAdmin = game.admin.toLowerCase() === address.toLowerCase();

  // If it's a payment, allow it even if not admin
  const isPaymentUpdate = !!body.payment?.address && !!body.payment?.txHash;

  // Block if not admin and not a payment update
  if (!isAdmin && !isPaymentUpdate) {
    return new Response(JSON.stringify({ error: "Not authorized" }), {
      status: 403,
    });
  }

  const updateFields: Partial<{
    recipient: string;
    amount: number;
    adminOnlySpin: boolean;
  }> = {};

  if (recipient) {
    updateFields.recipient = encrypt(recipient);
  }

  if (amount !== undefined) {
    const parsedAmount = parseFloat(amount);
    if (!isNaN(parsedAmount)) {
      updateFields.amount = parsedAmount;
    }
  }

  if (adminOnlySpin !== undefined) {
    updateFields.adminOnlySpin = adminOnlySpin;
  }

  const updateOps: {
    $set?: Partial<{
      recipient: string;
      amount: number;
      adminOnlySpin: boolean;
    }>;
    $addToSet?: {
      paid?: {
        address: string;
        name: string;
        txHash: string;
        timestamp?: Date; // ✅ allow optional timestamp
      };
    };
  } = {};

  if (body.payment?.address && body.payment?.txHash) {
    updateOps.$addToSet = {
      paid: {
        address: body.payment.address,
        name: body.payment.name,
        txHash: body.payment.txHash,
        timestamp: new Date(), // ✅ ADD THIS LINE
      },
    };
  }

  if (Object.keys(updateFields).length > 0) {
    updateOps.$set = updateFields;
  }

  if (!updateOps.$set && !updateOps.$addToSet) {
    return new Response(JSON.stringify({ error: "Nothing to update" }), {
      status: 400,
    });
  }

  await collection.updateOne({ gameId: roomId }, updateOps);

  const updated = await collection.findOne(
    { gameId: roomId },
    { collation: { locale: "en", strength: 2 } }
  );

  return Response.json(updated);
}

export async function DELETE(req: NextRequest) {
  const urlParts = req.nextUrl.pathname.split("/");
  const rawId = urlParts[urlParts.length - 1];
  const roomId = decodeURIComponent(rawId).toLowerCase().replace(/\s+/g, "_");

  if (!roomId) {
    return new Response(JSON.stringify({ error: "Missing roomId" }), {
      status: 400,
    });
  }

  const client = await clientPromise;
  const db = client.db();
  const collection = db.collection("a-split-game");

  const body = await req.json();
  const { address } = body;

  if (!address) {
    return new Response(JSON.stringify({ error: "Missing user address" }), {
      status: 400,
    });
  }

  const game = await collection.findOne({ gameId: roomId });
  if (!game) {
    return new Response(JSON.stringify({ error: "Room not found" }), {
      status: 404,
    });
  }

  if (game.admin.toLowerCase() !== address.toLowerCase()) {
    return new Response(JSON.stringify({ error: "Not authorized" }), {
      status: 403,
    });
  }

  await collection.deleteOne({ gameId: roomId });

  return new Response(JSON.stringify({ success: true, deleted: roomId }));
}
