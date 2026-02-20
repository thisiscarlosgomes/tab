import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { writeActivity } from "@/lib/writeActivity";

/* =========================
   Helpers
========================= */
function generateCode() {
  const words = ["pizza", "lunch", "bill", "tab", "night", "trip", "meal"];
  const randomWord = words[Math.floor(Math.random() * words.length)];
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `${randomWord}-${randomSuffix}`;
}

function normalizeAddress(address?: string) {
  return address ? address.toLowerCase() : address;
}

function normalizeFid(fid?: string | number) {
  if (fid === undefined || fid === null) return fid;
  return Number(fid);
}

function normalizeUser(user: any) {
  if (!user) return user;
  return {
    ...user,
    fid: normalizeFid(user.fid),
    address: normalizeAddress(user.address),
  };
}

/* =========================
   GET split
========================= */
export async function GET(req: NextRequest) {
  const splitId = req.nextUrl.pathname.split("/").pop()?.toLowerCase();
  if (!splitId) {
    return Response.json({ error: "Missing splitId" }, { status: 400 });
  }

  const client = await clientPromise;
  const collection = client.db().collection("a-split-bill");

  const bill = await collection.findOne({ splitId });
  if (!bill) {
    return Response.json({ error: "Bill not found" }, { status: 404 });
  }

  bill.participants ??= [];
  bill.invited ??= [];
  bill.paid ??= [];

  return Response.json(bill);
}

/* =========================
   POST create split
========================= */
export async function POST(req: NextRequest) {
  const splitId = req.nextUrl.pathname.split("/").pop()?.toLowerCase();
  if (!splitId) {
    return Response.json({ error: "Missing splitId" }, { status: 400 });
  }

  const client = await clientPromise;
  const collection = client.db().collection("a-split-bill");

  const body = await req.json();
  const {
    creator,
    description,
    totalAmount,
    token,
    invited = [],
    recipient,
    splitType = "invited", // invited | pay_other | receipt_open
    numPeople,             // required for receipt_open
  } = body;

  const normalizedCreator = normalizeUser(creator);
  const normalizedInvited = invited.map(normalizeUser);
  const normalizedRecipient = normalizeUser(recipient ?? creator);

  const isReceiptOpen = splitType === "receipt_open";

  if (!normalizedRecipient?.address) {
    return Response.json({ error: "Missing recipient" }, { status: 400 });
  }

  if (
    !normalizedCreator?.fid ||
    !normalizedCreator?.address ||
    !description ||
    !totalAmount ||
    !token
  ) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (isReceiptOpen && (!numPeople || Number(numPeople) <= 0)) {
    return Response.json(
      { error: "numPeople required for receipt_open split" },
      { status: 400 }
    );
  }

  // recipient must never be invited
  if (
    normalizedInvited.some(
      (u: any) =>
        normalizeAddress(u.address) ===
        normalizeAddress(normalizedRecipient.address)
    )
  ) {
    return Response.json(
      { error: "Recipient cannot be invited (recipient never owes)" },
      { status: 400 }
    );
  }

  const existing = await collection.findOne({ splitId });
  if (existing) {
    return Response.json({ error: "Split already exists" }, { status: 409 });
  }

  let code = generateCode();
  while (await collection.findOne({ code })) {
    code = generateCode();
  }

  const createdAt = new Date();
  const debtorCount = isReceiptOpen
    ? Number(numPeople)
    : normalizedInvited.length;

  const perPerson =
    debtorCount > 0 ? parseFloat(totalAmount) / debtorCount : 0;

  const doc = {
    splitId,
    code,
    creator: normalizedCreator,
    description,
    totalAmount: parseFloat(totalAmount),
    token,

    participants: [],

    invited: isReceiptOpen
      ? [] // lazy invites on join
      : normalizedInvited.map((u: any) => ({
          ...u,
          amount: perPerson,
        })),

    recipient: normalizedRecipient,

    paid: [],
    createdAt,
    splitType,
    invitedOnly: !isReceiptOpen,
    numPeople: isReceiptOpen ? Number(numPeople) : undefined,
  };

  await collection.insertOne(doc);

  writeActivity({
    address: normalizedCreator.address,
    type: "bill_created",
    refType: "bill",
    refId: splitId,
    timestamp: createdAt,
  });

  return Response.json(doc);
}

/* =========================
   PATCH join / pay
========================= */
export async function PATCH(req: NextRequest) {
  const splitId = req.nextUrl.pathname.split("/").pop()?.toLowerCase();
  if (!splitId) {
    return Response.json({ error: "Missing splitId" }, { status: 400 });
  }

  const client = await clientPromise;
  const collection = client.db().collection("a-split-bill");

  const body = await req.json();
  const { participant, payment } = body;

  const normalizedParticipant = participant ? normalizeUser(participant) : null;
  const normalizedPayment = payment ? normalizeUser(payment) : null;

  const existing = await collection.findOne({ splitId });
  if (!existing) {
    return Response.json({ error: "Split not found" }, { status: 404 });
  }

  const isReceiptOpen = existing.splitType === "receipt_open";
  const updateOps: any = {};

  /* -------- JOIN -------- */
  if (normalizedParticipant?.fid) {
    const fid = normalizedParticipant.fid;

    // recipient can never join
    if (fid === existing.recipient.fid) {
      return Response.json(
        { error: "Recipient cannot join or pay this split" },
        { status: 400 }
      );
    }

    const isInvited = existing.invited?.some((i: any) => i.fid === fid);

    // invited-only enforcement
    if (!isReceiptOpen && !isInvited) {
      return Response.json(
        { error: "You are not invited to this split" },
        { status: 403 }
      );
    }

    // capacity check (receipt_open)
    if (
      isReceiptOpen &&
      existing.invited.length >= Number(existing.numPeople)
    ) {
      return Response.json({ error: "Split is full" }, { status: 400 });
    }

    // lazy invite creation
    if (isReceiptOpen && !isInvited) {
      updateOps.$addToSet = {
        ...(updateOps.$addToSet ?? {}),
        invited: {
          ...normalizedParticipant,
          amount: existing.totalAmount / existing.numPeople,
        },
      };
    }

    const alreadyParticipant = existing.participants?.some(
      (p: any) => p.fid === fid
    );

    if (!alreadyParticipant) {
      updateOps.$addToSet = {
        ...(updateOps.$addToSet ?? {}),
        participants: {
          ...normalizedParticipant,
          amount:
            isReceiptOpen
              ? existing.totalAmount / existing.numPeople
              : existing.invited.find((i: any) => i.fid === fid)?.amount,
        },
      };

      writeActivity({
        address: normalizedParticipant.address,
        type: "bill_joined",
        refType: "bill",
        refId: splitId,
        counterparty: {
          address: existing.recipient.address,
          name: existing.recipient.name,
        },
        timestamp: new Date(),
      });
    }
  }

  /* -------- PAYMENT -------- */
  if (
    normalizedPayment &&
    (normalizedPayment.fid === existing.recipient.fid ||
      normalizeAddress(normalizedPayment.address) ===
        normalizeAddress(existing.recipient.address))
  ) {
    return Response.json(
      { error: "Recipient does not owe this split" },
      { status: 400 }
    );
  }

  if (normalizedPayment?.fid) {
    const fid = normalizedPayment.fid;
    const invitedEntry = existing.invited.find((i: any) => i.fid === fid);

    if (!invitedEntry) {
      return Response.json({ error: "Not a debtor" }, { status: 403 });
    }

    const alreadyPaid = existing.paid?.some((p: any) => p.fid === fid);
    if (!alreadyPaid) {
      updateOps.$addToSet = {
        ...(updateOps.$addToSet ?? {}),
        paid: {
          fid,
          address: normalizedPayment.address,
          name: normalizedPayment.name,
          txHash: normalizedPayment.txHash,
          token: normalizedPayment.token,
          amount: invitedEntry.amount,
          timestamp: new Date(),
        },
      };

      writeActivity({
        address: normalizedPayment.address,
        type: "bill_paid",
        refType: "bill",
        refId: splitId,
        amount: invitedEntry.amount,
        token: normalizedPayment.token,
        txHash: normalizedPayment.txHash,
        counterparty: {
          address: existing.recipient.address,
          name: existing.recipient.name,
          pfp: existing.recipient.pfp,
        },
        timestamp: new Date(),
      });
    }
  }

  if (!updateOps.$addToSet && !updateOps.$set) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  await collection.updateOne({ splitId }, updateOps);
  const updated = await collection.findOne({ splitId });

  return Response.json(updated);
}

/* =========================
   DELETE split
========================= */
export async function DELETE(req: NextRequest) {
  const splitId = req.nextUrl.pathname.split("/").pop()?.toLowerCase();
  if (!splitId) {
    return Response.json({ error: "Missing splitId" }, { status: 400 });
  }

  const client = await clientPromise;
  const collection = client.db().collection("a-split-bill");

  const body = await req.json();
  const { address } = body;

  const existing = await collection.findOne({ splitId });
  if (!existing) {
    return Response.json({ error: "Split not found" }, { status: 404 });
  }

  if (
    normalizeAddress(existing.creator.address) !== normalizeAddress(address)
  ) {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }

  await collection.deleteOne({ splitId });
  return Response.json({ success: true });
}
