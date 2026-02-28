"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useUser, useWallets } from "@privy-io/react-auth";
import { buildUserKey, resolveUserFid, normalizeAddress } from "@/lib/identity";
import { shortAddress } from "@/lib/shortAddress";

type FarcasterProfile = {
  fid?: number;
  username?: string;
  display_name?: string;
  pfp_url?: string;
};

const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const profileCache = new Map<
  string,
  { profile: FarcasterProfile | null; ts: number }
>();

export function useTabIdentity() {
  const { address: wagmiAddress, isConnected } = useAccount();
  const { wallets } = useWallets();
  const { user } = useUser();
  const fallbackAddress = wallets[0]?.address;

  const address = useMemo(
    () => normalizeAddress(wagmiAddress ?? fallbackAddress) ?? null,
    [wagmiAddress, fallbackAddress]
  );

  const [profile, setProfile] = useState<FarcasterProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setProfile(null);
      return;
    }

    let cancelled = false;
    const now = Date.now();
    const cached = profileCache.get(address);

    if (cached) {
      setProfile(cached.profile);
      if (now - cached.ts < PROFILE_CACHE_TTL_MS) {
        setIsProfileLoading(false);
        return;
      }
    }

    const loadProfile = async () => {
      if (!cached) setIsProfileLoading(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      try {
        const res = await fetch(`/api/neynar/user/by-address/${address}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          if (!cancelled) setProfile(null);
          profileCache.set(address, { profile: null, ts: Date.now() });
          return;
        }
        const data = await res.json();
        const nextProfile = data && typeof data === "object" ? data : null;
        profileCache.set(address, { profile: nextProfile, ts: Date.now() });
        if (!cancelled) {
          setProfile(nextProfile);
        }
      } catch {
        if (!cancelled && !cached) setProfile(null);
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setIsProfileLoading(false);
      }
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [address]);

  const privyFarcaster = user?.farcaster ?? null;
  const privyTwitter = user?.twitter ?? null;
  const privyFid =
    typeof privyFarcaster?.fid === "number"
      ? privyFarcaster.fid
      : typeof privyFarcaster?.fid === "string"
        ? Number(privyFarcaster.fid)
        : null;

  const fid = resolveUserFid({ fid: profile?.fid ?? privyFid ?? undefined, address });
  const userKey = buildUserKey({ fid, address });
  const username =
    profile?.username ??
    (typeof privyFarcaster?.username === "string" ? privyFarcaster.username : null) ??
    (typeof privyTwitter?.username === "string" ? privyTwitter.username : null) ??
    null;
  const displayName =
    profile?.display_name ??
    (typeof privyFarcaster?.displayName === "string"
      ? privyFarcaster.displayName
      : null) ??
    (typeof privyTwitter?.name === "string" ? privyTwitter.name : null) ??
    username ??
    (address ? shortAddress(address) : null);
  const pfp =
    profile?.pfp_url ??
    (typeof privyFarcaster?.pfp === "string" ? privyFarcaster.pfp : null) ??
    (typeof privyTwitter?.profilePictureUrl === "string"
      ? privyTwitter.profilePictureUrl
      : null) ??
    null;

  return {
    address,
    isConnected: isConnected || !!address,
    fid,
    userKey,
    username,
    displayName,
    pfp,
    profile,
    isProfileLoading,
  };
}
