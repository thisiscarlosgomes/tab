import { createPublicClient, http, isAddress } from "viem";
import { normalize } from "viem/ens";
import { mainnet } from "viem/chains";
import { neynarApi } from "@/lib/neynar";
import { getCanonicalUserProfileByUsername } from "@/lib/user-profile";

export type ResolvedRecipient = {
  address: string;
  username: string | null;
  source: "address" | "ens" | "tab" | "farcaster";
  fid?: number | null;
};

function normalizeAddress(value?: string | null) {
  return value ? value.toLowerCase() : null;
}

function normalizeUsername(raw: string) {
  return raw.trim().replace(/^@/, "");
}

function extractAddressesFromNeynarUser(user: unknown) {
  if (!user || typeof user !== "object") return [] as string[];
  const record = user as Record<string, unknown>;
  const verified =
    (record.verified_addresses as Record<string, unknown> | undefined) ?? {};
  const primary = (verified.primary as Record<string, unknown> | undefined) ?? {};

  const candidates: string[] = [];

  if (typeof primary.eth_address === "string") candidates.push(primary.eth_address);

  const ethAddresses = verified.eth_addresses;
  if (Array.isArray(ethAddresses)) {
    for (const value of ethAddresses) {
      if (typeof value === "string") candidates.push(value);
    }
  }

  if (typeof record.custody_address === "string") candidates.push(record.custody_address);

  return Array.from(
    new Set(
      candidates
        .map((value) => value.trim())
        .filter((value) => isAddress(value))
        .map((value) => value.toLowerCase())
    )
  );
}

export async function resolveRecipient(params: {
  recipient: string;
  recipientAddress?: string;
  recipientUsername?: string;
  recipientEns?: string;
}): Promise<ResolvedRecipient | null> {
  const directAddress =
    normalizeAddress(params.recipientAddress) ??
    normalizeAddress(isAddress(params.recipient) ? params.recipient : null);

  if (directAddress && isAddress(directAddress)) {
    return {
      address: directAddress,
      username: null,
      source: "address",
    };
  }

  const ensCandidateRaw = (
    params.recipientEns ??
    (params.recipient.includes(".") && !params.recipient.startsWith("@")
      ? params.recipient
      : "")
  ).trim();
  const ensCandidate = ensCandidateRaw.toLowerCase();

  if (ensCandidate.endsWith(".eth")) {
    try {
      const ensRpcUrl =
        process.env.ETHEREUM_RPC_URL ??
        process.env.ALCHEMY_MAINNET_URL ??
        "https://eth.llamarpc.com";
      const ensClient = createPublicClient({
        chain: mainnet,
        transport: http(ensRpcUrl),
      });
      const resolved = await ensClient.getEnsAddress({
        name: normalize(ensCandidate),
      });
      const resolvedAddress = normalizeAddress(resolved);
      if (resolvedAddress && isAddress(resolvedAddress)) {
        return {
          address: resolvedAddress,
          username: null,
          source: "ens",
        };
      }
    } catch {
      // continue to username lookup fallback
    }
  }

  const usernameCandidate =
    normalizeUsername(params.recipientUsername ?? "") ||
    normalizeUsername(params.recipient);
  if (!usernameCandidate) return null;

  const localProfile = await getCanonicalUserProfileByUsername(usernameCandidate);
  if (
    localProfile?.primaryAddress &&
    isAddress(localProfile.primaryAddress)
  ) {
    return {
      address: localProfile.primaryAddress.toLowerCase(),
      username: localProfile.username ?? usernameCandidate,
      source: "tab",
      fid: localProfile.fid ?? null,
    };
  }

  try {
    const { user } = await neynarApi.lookupUserByUsername({
      username: usernameCandidate,
    });
    const resolvedAddress = extractAddressesFromNeynarUser(user)[0] ?? null;
    if (!resolvedAddress) return null;

    const profile =
      user && typeof user === "object" ? (user as Record<string, unknown>) : {};

    const fidRaw = profile.fid;
    const fid = Number.isFinite(Number(fidRaw)) ? Number(fidRaw) : null;

    return {
      address: resolvedAddress,
      username:
        typeof profile.username === "string" ? profile.username : usernameCandidate,
      source: "farcaster",
      fid,
    };
  } catch {
    return null;
  }
}
