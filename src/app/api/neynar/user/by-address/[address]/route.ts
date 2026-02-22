import type { NextRequest } from 'next/server';
import { fetchFarcasterUsersByAddresses } from '@/lib/proxy';

type FarcasterProfile = {
  username?: string | null;
  pfp_url?: string | null;
  pfp?: { url?: string | null } | null;
  fid?: number | null;
};

function normalizeProfile(profile: FarcasterProfile | null): FarcasterProfile | null {
  if (!profile) return null;
  if (typeof profile.pfp_url === 'string' && profile.pfp_url.length > 0) {
    return profile;
  }

  const nestedUrl = profile.pfp?.url;
  if (typeof nestedUrl === 'string' && nestedUrl.length > 0) {
    return { ...profile, pfp_url: nestedUrl };
  }

  return profile;
}

function resolveProfileByAddress(
  profilesByAddress: Record<string, unknown>,
  address: string
): FarcasterProfile | null {
  const normalized = address.toLowerCase();
  const candidate =
    profilesByAddress[address] ??
    profilesByAddress[normalized] ??
    profilesByAddress[address.trim()];

  if (candidate && typeof candidate === 'object') {
    const candidateRecord = candidate as Record<string, unknown>;
    if (candidateRecord.user && typeof candidateRecord.user === 'object') {
      return normalizeProfile(candidateRecord.user as FarcasterProfile);
    }
    return normalizeProfile(candidate as FarcasterProfile);
  }

  const values = Object.values(profilesByAddress);
  if (values.length === 1 && values[0] && typeof values[0] === 'object') {
    const first = values[0] as Record<string, unknown>;
    if (first.user && typeof first.user === 'object') {
      return normalizeProfile(first.user as FarcasterProfile);
    }
    return normalizeProfile(first as FarcasterProfile);
  }

  return null;
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.pathname.split('/').pop()?.toLowerCase();

  if (!address)
    return Response.json({ error: 'Missing address' }, { status: 400 });

  try {
    const farcasterUsers = await fetchFarcasterUsersByAddresses(address);
    const profile = resolveProfileByAddress(farcasterUsers, address);
    return Response.json(profile);
  } catch {
    // Treat missing/unavailable Neynar data as "no Farcaster profile".
    return Response.json(null);
  }
}
