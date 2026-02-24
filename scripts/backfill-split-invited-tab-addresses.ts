import { MongoClient, ObjectId } from "mongodb";

type SplitUserLike = {
  address?: string | null;
  fid?: number | string | null;
  userKey?: string | null;
  name?: string | null;
  amount?: number | null;
};

type SplitBillDoc = {
  _id: ObjectId;
  splitId?: string;
  code?: string;
  invited?: SplitUserLike[];
  paid?: SplitUserLike[];
  recipient?: SplitUserLike | null;
  createdAt?: Date | string;
};

type UserProfileDoc = {
  fid?: number | null;
  primaryAddress?: string | null;
  username?: string | null;
};

function normalizeAddress(value?: string | null): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function normalizeFid(value?: number | string | null): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildUserKey(params: { fid?: number | string | null; address?: string | null }) {
  const address = normalizeAddress(params.address);
  if (address) return `wallet:${address}`;
  const fid = normalizeFid(params.fid);
  if (fid !== null) return `fid:${fid}`;
  return null;
}

function keyOf(entry?: SplitUserLike | null) {
  if (!entry) return null;
  if (typeof entry.userKey === "string" && entry.userKey.trim()) {
    return entry.userKey.trim().toLowerCase();
  }
  return buildUserKey({ fid: entry.fid, address: entry.address })?.toLowerCase() ?? null;
}

function sameUser(a?: SplitUserLike | null, b?: SplitUserLike | null) {
  const aAddress = normalizeAddress(a?.address);
  const bAddress = normalizeAddress(b?.address);
  if (aAddress && bAddress && aAddress === bAddress) return true;

  const aKey = keyOf(a);
  const bKey = keyOf(b);
  if (aKey && bKey && aKey === bKey) return true;

  const aFid = normalizeFid(a?.fid);
  const bFid = normalizeFid(b?.fid);
  if (aFid !== null && bFid !== null && aFid === bFid) return true;

  return false;
}

function isPaidInvite(invite: SplitUserLike, paid: SplitUserLike[]) {
  return paid.some((entry) => sameUser(invite, entry));
}

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const getValue = (prefix: string) => {
    const match = argv.find((arg) => arg.startsWith(`${prefix}=`));
    return match ? match.slice(prefix.length + 1) : null;
  };

  const limitRaw = getValue("--limit");
  const limit =
    limitRaw && Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0
      ? Math.floor(Number(limitRaw))
      : null;

  return {
    apply: flags.has("--apply"),
    verbose: flags.has("--verbose"),
    limit,
    splitId: getValue("--splitId"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  const dbName = process.env.MONGODB_DB?.trim() || undefined;
  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = dbName ? client.db(dbName) : client.db();
    const splits = db.collection<SplitBillDoc>("a-split-bill");
    const profiles = db.collection<UserProfileDoc>("a-user-profile");

    const profileCache = new Map<number, UserProfileDoc | null>();
    const getProfileByFid = async (fid: number) => {
      if (profileCache.has(fid)) return profileCache.get(fid) ?? null;
      const profile = await profiles.findOne(
        { fid },
        { projection: { fid: 1, primaryAddress: 1, username: 1 } }
      );
      profileCache.set(fid, profile ?? null);
      return profile ?? null;
    };

    const query: Record<string, unknown> = { "invited.0": { $exists: true } };
    if (args.splitId) query.splitId = args.splitId.toLowerCase();

    const cursor = splits.find(query, {
      projection: { splitId: 1, code: 1, invited: 1, paid: 1, recipient: 1, createdAt: 1 },
      sort: { createdAt: -1, _id: -1 },
    });
    if (args.limit) cursor.limit(args.limit);

    let scannedSplits = 0;
    let splitsWithUnpaidInvites = 0;
    let patchedSplits = 0;
    let patchedInvites = 0;
    let skippedNoFid = 0;
    let skippedNoProfile = 0;
    let skippedNoTabAddress = 0;
    let skippedAlreadyCurrent = 0;
    let skippedPaid = 0;
    let collisionSkips = 0;

    const samples: Array<{
      splitId: string;
      code?: string;
      changes: Array<{ fid: number; from: string | null; to: string; name: string | null }>;
    }> = [];

    for await (const split of cursor) {
      scannedSplits += 1;

      const invited = Array.isArray(split.invited) ? split.invited : [];
      const paid = Array.isArray(split.paid) ? split.paid : [];
      if (invited.length === 0) continue;

      let hasUnpaid = false;
      const nextInvited = invited.map((entry) => ({ ...entry }));
      const splitChanges: Array<{
        index: number;
        fid: number;
        from: string | null;
        to: string;
        name: string | null;
      }> = [];

      for (let i = 0; i < invited.length; i += 1) {
        const original = invited[i];
        if (!original) continue;

        if (isPaidInvite(original, paid)) {
          skippedPaid += 1;
          continue;
        }
        hasUnpaid = true;

        const fid = normalizeFid(original.fid);
        if (fid === null) {
          skippedNoFid += 1;
          continue;
        }

        const profile = await getProfileByFid(fid);
        if (!profile) {
          skippedNoProfile += 1;
          continue;
        }

        const canonical = normalizeAddress(profile.primaryAddress);
        if (!canonical) {
          skippedNoTabAddress += 1;
          continue;
        }

        const current = normalizeAddress(original.address);
        if (current === canonical) {
          skippedAlreadyCurrent += 1;
          continue;
        }

        nextInvited[i].address = canonical;
        // Keep identity aligned with address-first matching for future consistency.
        nextInvited[i].userKey = `wallet:${canonical}`;
        splitChanges.push({
          index: i,
          fid,
          from: current,
          to: canonical,
          name:
            typeof original.name === "string" && original.name.trim()
              ? original.name.trim()
              : null,
        });
      }

      if (!hasUnpaid) continue;
      splitsWithUnpaidInvites += 1;
      if (splitChanges.length === 0) continue;

      // Safety: skip if patching would create duplicate unpaid invite identities in the same split.
      const unpaidPatched = nextInvited.filter((entry) => !isPaidInvite(entry, paid));
      const seen = new Set<string>();
      let hasCollision = false;
      for (const entry of unpaidPatched) {
        const fid = normalizeFid(entry.fid);
        const address = normalizeAddress(entry.address);
        const identityKey =
          (fid !== null ? `fid:${fid}` : null) ??
          (address ? `wallet:${address}` : null) ??
          null;
        if (!identityKey) continue;
        if (seen.has(identityKey)) {
          hasCollision = true;
          break;
        }
        seen.add(identityKey);
      }

      if (hasCollision) {
        collisionSkips += 1;
        if (args.verbose) {
          console.log(
            `[skip-collision] split=${split.splitId ?? String(split._id)} code=${split.code ?? ""}`
          );
        }
        continue;
      }

      if (args.apply) {
        await splits.updateOne({ _id: split._id }, { $set: { invited: nextInvited } });
      }

      patchedSplits += 1;
      patchedInvites += splitChanges.length;

      if (samples.length < 20) {
        samples.push({
          splitId: split.splitId ?? String(split._id),
          code: split.code,
          changes: splitChanges.map((change) => ({
            fid: change.fid,
            from: change.from,
            to: change.to,
            name: change.name,
          })),
        });
      }

      if (args.verbose) {
        console.log(
          `[${args.apply ? "patched" : "dry-run"}] split=${split.splitId ?? String(split._id)} changed=${splitChanges.length}`
        );
      }
    }

    console.log("");
    console.log(args.apply ? "Applied backfill." : "Dry run only (no writes).");
    console.log(`Scanned splits: ${scannedSplits}`);
    console.log(`Splits with unpaid invites: ${splitsWithUnpaidInvites}`);
    console.log(`Splits ${args.apply ? "patched" : "would patch"}: ${patchedSplits}`);
    console.log(`Invite entries ${args.apply ? "patched" : "would patch"}: ${patchedInvites}`);
    console.log(`Skipped paid invites: ${skippedPaid}`);
    console.log(`Skipped unpaid invites with no fid: ${skippedNoFid}`);
    console.log(`Skipped unpaid invites with no profile: ${skippedNoProfile}`);
    console.log(`Skipped unpaid invites with no TAB primaryAddress: ${skippedNoTabAddress}`);
    console.log(`Skipped already-current invites: ${skippedAlreadyCurrent}`);
    console.log(`Skipped splits due to collisions: ${collisionSkips}`);

    if (samples.length > 0) {
      console.log("");
      console.log("Sample changes:");
      for (const sample of samples) {
        console.log(`- split=${sample.splitId}${sample.code ? ` code=${sample.code}` : ""}`);
        for (const change of sample.changes) {
          console.log(
            `  fid=${change.fid} ${change.name ? `(${change.name}) ` : ""}${change.from ?? "<none>"} -> ${change.to}`
          );
        }
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[backfill-split-invited-tab-addresses] failed");
  console.error(error);
  process.exit(1);
});
