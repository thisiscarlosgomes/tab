import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { writeActivity } from "@/lib/writeActivity";
import { requireTrustedRequest } from "@/lib/security";
import { buildUserKey, resolveUserFid } from "@/lib/identity";
import { getCanonicalUserProfileByFid } from "@/lib/user-profile";
import { sendWebNotificationToUser } from "@/lib/user-notifications";

/* =========================
   Helpers
========================= */
function generateCode() {
  const words = ["pizza", "lunch", "bill", "tab", "night", "trip", "meal"];
  const randomWord = words[Math.floor(Math.random() * words.length)];
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `${randomWord}-${randomSuffix}`;
}

function getPublicBaseUrl(req: NextRequest) {
  return (
    process.env.PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_URL?.trim() ||
    req.nextUrl.origin
  ).replace(/\/$/, "");
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
  const address = normalizeAddress(user.address);
  const fid = resolveUserFid({ fid: normalizeFid(user.fid), address });
  const userKey =
    buildUserKey({ fid, address }) ??
    (typeof user.userKey === "string" ? user.userKey.toLowerCase() : null);
  return {
    ...user,
    fid,
    address,
    userKey,
  };
}

function getUserKeys(user: any) {
  const keys = new Set<string>();
  if (!user) return keys;

  const normalizedAddress = normalizeAddress(user.address);
  const normalizedFid = normalizeFid(user.fid);

  if (typeof user.userKey === "string" && user.userKey) {
    keys.add(user.userKey.toLowerCase());
  }

  const canonicalKey = buildUserKey({
    fid: normalizedFid,
    address: normalizedAddress,
  });
  if (canonicalKey) keys.add(canonicalKey.toLowerCase());

  if (normalizedAddress) keys.add(`wallet:${normalizedAddress}`);
  if (normalizedFid && Number.isFinite(normalizedFid)) {
    keys.add(`fid:${Number(normalizedFid)}`);
  }

  return keys;
}

function isSameUser(a: any, b: any) {
  if (!a || !b) return false;

  const aAddress = normalizeAddress(a.address);
  const bAddress = normalizeAddress(b.address);
  if (aAddress && bAddress && aAddress === bAddress) return true;

  const aKeys = getUserKeys(a);
  const bKeys = getUserKeys(b);

  for (const key of aKeys) {
    if (bKeys.has(key)) return true;
  }

  return false;
}

async function resolvePreferredSplitUser(user: any) {
  const normalized = normalizeUser(user);
  if (!normalized) return normalized;

  // For Tab users, prefer their Tab (Privy) wallet for payouts and split invites.
  if (normalized.fid) {
    const profile = await getCanonicalUserProfileByFid(Number(normalized.fid)).catch(
      () => null
    );
    if (profile?.primaryAddress) {
      return normalizeUser({
        ...normalized,
        address: profile.primaryAddress,
        payoutAddressSource: "tab_wallet",
        farcasterVerifiedAddress: normalized.address ?? null,
      });
    }
  }

  return {
    ...normalized,
    payoutAddressSource: "farcaster_verified",
    farcasterVerifiedAddress: normalized.address ?? null,
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
  const denied = requireTrustedRequest(req, {
    bucket: "split-post",
    limit: 60,
    windowMs: 60_000,
  });
  if (denied) return denied;

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

  const normalizedCreator = await resolvePreferredSplitUser(creator);
  const normalizedInvited = await Promise.all(invited.map(resolvePreferredSplitUser));
  const normalizedRecipient = recipient
    ? normalizeUser(recipient)
    : normalizedCreator;

  const isReceiptOpen = splitType === "receipt_open";

  if (!normalizedRecipient?.address) {
    return Response.json({ error: "Missing recipient" }, { status: 400 });
  }

  if (
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
    normalizedInvited.some((u: any) => isSameUser(u, normalizedRecipient))
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

  // Best-effort invite notifications for users who already enabled web push.
  const splitUrl = `${getPublicBaseUrl(req)}/split/${splitId}`;
  const creatorLabel =
    typeof normalizedCreator?.name === "string" && normalizedCreator.name.trim()
      ? normalizedCreator.name.trim().replace(/^@+/, "")
      : "Someone";
  const perPersonText =
    Number.isFinite(perPerson) && perPerson > 0
      ? ` (${perPerson.toFixed(token === "ETH" ? 4 : 2)} ${token} each)`
      : "";
  if (!isReceiptOpen && Array.isArray(doc.invited) && doc.invited.length > 0) {
    void Promise.allSettled(
      doc.invited.map((invitedUser: any) =>
        sendWebNotificationToUser(
          {
            fid: invitedUser?.fid ?? null,
            address: invitedUser?.address ?? null,
          },
          {
            title: "Split invite",
            body: `@${creatorLabel} invited you to split "${description}"${perPersonText}`,
            url: splitUrl,
            tag: `split-invite-${splitId}`,
          }
        )
      )
    ).catch(() => {});
  }

  return Response.json(doc);
}

/* =========================
   PATCH join / pay
========================= */
export async function PATCH(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "split-patch",
    limit: 120,
    windowMs: 60_000,
  });
  if (denied) return denied;

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
  const arrayFilters: Record<string, unknown>[] = [];

  /* -------- JOIN -------- */
  if (normalizedParticipant?.address) {
    if (getUserKeys(normalizedParticipant).size === 0) {
      return Response.json({ error: "Invalid participant" }, { status: 400 });
    }

    // recipient can never join
    if (isSameUser(normalizedParticipant, existing.recipient)) {
      return Response.json(
        { error: "Recipient cannot join or pay this split" },
        { status: 400 }
      );
    }

    const isInvited = existing.invited?.some(
      (invited: any) => isSameUser(invited, normalizedParticipant)
    );

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
      (participant: any) => isSameUser(participant, normalizedParticipant)
    );

    const invitedEntry = existing.invited.find(
      (invited: any) => isSameUser(invited, normalizedParticipant)
    );

    // Reconcile FID-first invites to the user's current Tab wallet once identity is proven.
    if (invitedEntry && normalizedParticipant.address) {
      const invitedFid = normalizeFid(invitedEntry.fid);
      const participantFid = normalizeFid(normalizedParticipant.fid);
      const invitedAddress = normalizeAddress(invitedEntry.address);
      if (
        invitedFid &&
        participantFid &&
        invitedFid === participantFid &&
        invitedAddress !== normalizedParticipant.address
      ) {
        updateOps.$set = {
          ...(updateOps.$set ?? {}),
          "invited.$[inviteJoin].address": normalizedParticipant.address,
        };
        arrayFilters.push({ "inviteJoin.fid": invitedFid });
      }
    }

    if (!alreadyParticipant) {
      updateOps.$addToSet = {
        ...(updateOps.$addToSet ?? {}),
        participants: {
          ...normalizedParticipant,
          amount:
            isReceiptOpen
              ? existing.totalAmount / existing.numPeople
              : invitedEntry?.amount,
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
    isSameUser(normalizedPayment, existing.recipient)
  ) {
    return Response.json(
      { error: "Recipient does not owe this split" },
      { status: 400 }
    );
  }

  if (normalizedPayment?.address) {
    const paymentKeys = getUserKeys(normalizedPayment);
    const paymentKey =
      [...paymentKeys].find((key) => key.startsWith("fid:")) ??
      [...paymentKeys][0] ??
      null;
    const invitedEntry = existing.invited.find(
      (invited: any) => isSameUser(invited, normalizedPayment)
    );

    if (!invitedEntry) {
      return Response.json({ error: "Not a debtor" }, { status: 403 });
    }

    const alreadyPaid = existing.paid?.some(
      (paid: any) => isSameUser(paid, normalizedPayment)
    );
    if (!alreadyPaid) {
      // Keep invited entries aligned with the payer's current Tab wallet for future address lookups.
      const invitedFid = normalizeFid(invitedEntry.fid);
      const paymentFid = normalizeFid(normalizedPayment.fid);
      const invitedAddress = normalizeAddress(invitedEntry.address);
      if (
        invitedFid &&
        paymentFid &&
        invitedFid === paymentFid &&
        invitedAddress !== normalizedPayment.address
      ) {
        updateOps.$set = {
          ...(updateOps.$set ?? {}),
          "invited.$[invitePay].address": normalizedPayment.address,
        };
        arrayFilters.push({ "invitePay.fid": invitedFid });
      }

      updateOps.$addToSet = {
        ...(updateOps.$addToSet ?? {}),
        paid: {
          fid: normalizedPayment.fid,
          userKey: paymentKey,
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

      const recipientAddress = normalizeAddress(existing.recipient?.address);
      if (recipientAddress && recipientAddress !== normalizedPayment.address) {
        writeActivity({
          address: recipientAddress,
          type: "bill_received",
          refType: "bill",
          refId: splitId,
          amount: invitedEntry.amount,
          token: normalizedPayment.token ?? existing.token,
          txHash: normalizedPayment.txHash,
          counterparty: {
            address: normalizedPayment.address,
            name: normalizedPayment.name,
            pfp: normalizedPayment.pfp,
          },
          timestamp: new Date(),
        });
      }
    }
  }

  if (!updateOps.$addToSet && !updateOps.$set) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  await collection.updateOne(
    { splitId },
    updateOps,
    arrayFilters.length ? ({ arrayFilters } as any) : undefined
  );
  const updated = await collection.findOne({ splitId });

  return Response.json(updated);
}

/* =========================
   DELETE split
========================= */
export async function DELETE(req: NextRequest) {
  const denied = requireTrustedRequest(req, {
    bucket: "split-delete",
    limit: 40,
    windowMs: 60_000,
  });
  if (denied) return denied;

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
