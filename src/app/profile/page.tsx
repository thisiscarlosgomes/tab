"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIdentityToken, usePrivy, useToken } from "@privy-io/react-auth";
import { useTabIdentity } from "@/lib/useTabIdentity";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { shortAddress } from "@/lib/shortAddress";

/* -------------------------------------- */
/* TYPES                                  */
/* -------------------------------------- */

interface SplitBill {
  splitId: string;
  code: string;
  description: string;
  participants: { name: string; pfp?: string }[];
  creator: string;
  totalAmount: number;
  perPersonAmount: number;
  remaining: number;
  debtors: number;
  paidCount: number;
  isSettled?: boolean;

  createdAt: string;
  token?: string;
  paid?: { address: string; name?: string }[];

  // ✅ NEW — from API
  userStatus?: "creator" | "participant" | "invited" | null;
  hasPaid?: boolean;
}

interface Room {
  gameId: string;
  members: { name: string; pfp: string }[];
  admin?: string;
  createdAt: string;
  name: string | null;
  chosen?: { address?: string | null } | null;
  paid?: { address: string }[];
}

type ProfileTab = "splits" | "spins";

type FarcasterHeroState = {
  displayName: string | null;
  username: string | null;
  pfpUrl: string | null;
  bio: string | null;
  followerCount: number | null;
  joinedAt: string | null;
  followerPreviewPfps: string[];
};

const PROFILE_HERO_CACHE_TTL_MS = 5 * 60 * 1000;
const profileHeroCache = new Map<
  string,
  { hero: FarcasterHeroState; ts: number }
>();
const PROFILE_LIST_CACHE_TTL_MS = 60 * 1000;
const profileBillsCache = new Map<string, { bills: SplitBill[]; ts: number }>();
const profileRoomsCache = new Map<string, { rooms: Room[]; ts: number }>();

export default function ProfilePage() {
  const {
    address,
    isProfileLoading,
    username,
    displayName,
    pfp,
    fid,
  } = useTabIdentity();
  const { identityToken } = useIdentityToken();
  const { getAccessToken } = useToken();
  const { logout, ready, authenticated } = usePrivy();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ProfileTab>("splits");
  const [loggingOut, setLoggingOut] = useState(false);

  const [userRooms, setUserRooms] = useState<Room[]>([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [bills, setBills] = useState<SplitBill[]>([]);
  const [billsLoaded, setBillsLoaded] = useState(false);
  const [billsLoading, setBillsLoading] = useState(false);
  const [agentAuthToken, setAgentAuthToken] = useState<string | null>(null);
  const [farcasterHero, setFarcasterHero] = useState<FarcasterHeroState | null>(null);
  const [farcasterHeroLoading, setFarcasterHeroLoading] = useState(false);

  const formatCompactNumber = (value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: value >= 10000 ? 0 : 1,
    }).format(value);
  };

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      if (ready && authenticated) {
        await logout();
      }
      router.replace("/");
      router.refresh();
    } catch (error) {
      console.error("Profile logout failed", error);
    } finally {
      setLoggingOut(false);
    }
  }, [authenticated, loggingOut, logout, ready, router]);

  useEffect(() => {
    let cancelled = false;
    const resolveAuthToken = async () => {
      if (identityToken) {
        if (!cancelled) {
          setAgentAuthToken(identityToken);
        }
        return;
      }

      const accessToken = await getAccessToken().catch(() => null);
      if (!cancelled) {
        setAgentAuthToken(accessToken);
      }
    };

    void resolveAuthToken();
    return () => {
      cancelled = true;
    };
  }, [identityToken, getAccessToken]);

  useEffect(() => {
    if (!address) {
      setFarcasterHero(null);
      setFarcasterHeroLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const cacheKey = address.toLowerCase();
    const cachedHero = profileHeroCache.get(cacheKey);

    const readString = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim() : null;
    const readNumber = (value: unknown) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const readDate = (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) {
        const ms = value > 10_000_000_000 ? value : value * 1000;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      }
      if (typeof value === "string" && value.trim()) {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      }
      return null;
    };

    const parseHeroFromUser = (user: any): FarcasterHeroState => {
      const nestedPfp =
        readString(user?.pfp_url) ??
        readString(user?.pfp?.url) ??
        readString(user?.pfpUrl) ??
        pfp ??
        null;
      const nestedDisplayName =
        readString(user?.display_name) ??
        readString(user?.displayName) ??
        displayName ??
        null;
      const nestedUsername = readString(user?.username) ?? username ?? null;
      const bioText =
        readString(user?.profile?.bio?.text) ??
        readString(user?.bio?.text) ??
        readString(user?.profile?.bio) ??
        null;
      const followerCount =
        readNumber(user?.follower_count) ??
        readNumber(user?.followerCount) ??
        null;
      const joinedAt =
        readDate(user?.created_at) ??
        readDate(user?.createdAt) ??
        readDate(user?.registered_at) ??
        readDate(user?.registeredAt) ??
        readDate(user?.custody_registered_at) ??
        null;

      return {
        displayName: nestedDisplayName,
        username: nestedUsername,
        pfpUrl: nestedPfp,
        bio: bioText,
        followerCount,
        joinedAt,
        followerPreviewPfps: [],
      };
    };

    const loadFarcasterHero = async () => {
      if (cachedHero) {
        setFarcasterHero(cachedHero.hero);
        if (Date.now() - cachedHero.ts < PROFILE_HERO_CACHE_TTL_MS) {
          setFarcasterHeroLoading(false);
          return;
        }
      } else {
        setFarcasterHeroLoading(true);
      }
      let canonicalUsername: string | null = username ?? null;
      let canonicalFid: number | null = fid ?? null;

      let hero: FarcasterHeroState = {
        displayName: displayName ?? null,
        username: username ?? null,
        pfpUrl: pfp ?? null,
        bio: null,
        followerCount: null,
        joinedAt: null,
        followerPreviewPfps: [],
      };

      try {
        const shouldFetchMe =
          Boolean(agentAuthToken) &&
          (!canonicalUsername || !canonicalFid || !hero.displayName || !hero.pfpUrl);

        if (shouldFetchMe && agentAuthToken) {
          const meRes = await fetch("/api/user/me", {
            headers: {
              Authorization: `Bearer ${agentAuthToken}`,
            },
            signal: controller.signal,
          });
          if (meRes.ok) {
            const me = await meRes.json();
            const meUsername = readString(me?.username);
            const meDisplayName = readString(me?.displayName);
            const mePfpUrl = readString(me?.pfpUrl);
            const meFid = readNumber(me?.fid);

            canonicalUsername = meUsername ?? canonicalUsername;
            canonicalFid = meFid ?? canonicalFid;
            hero = {
              ...hero,
              username: meUsername ?? hero.username,
              displayName: meDisplayName ?? hero.displayName,
              pfpUrl: mePfpUrl ?? hero.pfpUrl,
            };
          }
        }

        if (canonicalUsername) {
          const res = await fetch(
            `/api/neynar/user/by-username?username=${encodeURIComponent(canonicalUsername)}`,
            { signal: controller.signal }
          );
          if (res.ok) {
            const user = await res.json();
            if (user && typeof user === "object") {
              hero = parseHeroFromUser(user);
            }
          }
        }

        const qs = new URLSearchParams();
        if (canonicalFid) qs.set("fid", String(canonicalFid));
        else if (canonicalUsername) qs.set("username", canonicalUsername);
        else if (address) qs.set("address", address);

        if (qs.toString()) {
          const followingRes = await fetch(`/api/neynar/user/following?${qs.toString()}`, {
            signal: controller.signal,
          });
          if (followingRes.ok) {
            const raw = await followingRes.json();
            const list = Array.isArray(raw) ? raw : [];
            const preview = list
              .map((entry: any) => (entry?.user && typeof entry.user === "object" ? entry.user : entry))
              .map(
                (u: any) =>
                  readString(u?.pfp_url) ?? readString(u?.pfp?.url) ?? readString(u?.pfpUrl)
              )
              .filter((v: string | null): v is string => Boolean(v))
              .slice(0, 3);
            hero = { ...hero, followerPreviewPfps: preview };
          }
        }
      } catch {
        // keep base identity fallback
      } finally {
        if (!cancelled) {
          profileHeroCache.set(cacheKey, { hero, ts: Date.now() });
          setFarcasterHero(hero);
          setFarcasterHeroLoading(false);
        }
      }
    };

    void loadFarcasterHero();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [address, username, displayName, pfp, fid, agentAuthToken]);

  const fetchUserBills = useCallback(async () => {
    if (!address) {
      setBillsLoading(false);
      return;
    }

    const cacheKey = address.toLowerCase();
    const hasVisibleBills = billsLoaded || bills.length > 0;
    if (!hasVisibleBills) setBillsLoading(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`/api/user-bills?address=${address}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      if (Array.isArray(data.bills)) {
        setBills(data.bills);
        profileBillsCache.set(cacheKey, { bills: data.bills, ts: Date.now() });
      }
    } catch {
      // Keep last successful bills list on transient failure.
    } finally {
      clearTimeout(timeoutId);
      setBillsLoading(false);
      setBillsLoaded(true);
    }
  }, [address, bills.length, billsLoaded]);

  const fetchUserRooms = useCallback(async () => {
    if (!address) {
      setRoomsLoading(false);
      return;
    }

    const cacheKey = address.toLowerCase();
    const hasVisibleRooms = roomsLoaded || userRooms.length > 0;
    if (!hasVisibleRooms) setRoomsLoading(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`/api/user-rooms?address=${address}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      if (Array.isArray(data.rooms)) {
        setUserRooms(data.rooms);
        profileRoomsCache.set(cacheKey, { rooms: data.rooms, ts: Date.now() });
      }
    } catch {
      // Keep last successful rooms list on transient failure.
    } finally {
      clearTimeout(timeoutId);
      setRoomsLoading(false);
      setRoomsLoaded(true);
    }
  }, [address, roomsLoaded, userRooms.length]);

  useEffect(() => {
    if (!address) return;

    const cacheKey = address.toLowerCase();
    const now = Date.now();
    const cachedBills = profileBillsCache.get(cacheKey);
    const cachedRooms = profileRoomsCache.get(cacheKey);

    if (cachedBills && now - cachedBills.ts < PROFILE_LIST_CACHE_TTL_MS) {
      setBills(cachedBills.bills);
      setBillsLoaded(true);
      setBillsLoading(false);
    }

    if (cachedRooms && now - cachedRooms.ts < PROFILE_LIST_CACHE_TTL_MS) {
      setUserRooms(cachedRooms.rooms);
      setRoomsLoaded(true);
      setRoomsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (!address) {
      if (isProfileLoading) return;
      setBills([]);
      setUserRooms([]);
      setBillsLoaded(false);
      setRoomsLoaded(false);
      return;
    }

    let cancelled = false;

    const bootstrapProfileData = async () => {
      const followups: Promise<unknown>[] = [];
      if (!billsLoaded && !billsLoading) {
        followups.push(fetchUserBills());
      }
      if (!roomsLoaded && !roomsLoading) {
        followups.push(fetchUserRooms());
      }
      if (followups.length) {
        await Promise.allSettled(followups);
      }
    };

    void bootstrapProfileData();

    return () => {
      cancelled = true;
    };
  }, [
    address,
    isProfileLoading,
    billsLoaded,
    billsLoading,
    roomsLoaded,
    roomsLoading,
    fetchUserBills,
    fetchUserRooms,
  ]);

  useEffect(() => {
    if (!address) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (activeTab === "splits") void fetchUserBills();
      if (activeTab === "spins") void fetchUserRooms();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [address, activeTab, fetchUserBills, fetchUserRooms]);

  useEffect(() => {
    if (!address) return;
    if (activeTab === "splits") void fetchUserBills();
    if (activeTab === "spins") void fetchUserRooms();
  }, [address, activeTab, fetchUserBills, fetchUserRooms]);

  useEffect(() => {
    if (!bills.length) return;
    bills.slice(0, 8).forEach((bill) => {
      if (bill.splitId) {
        router.prefetch(`/split/${bill.splitId}`);
      }
    });
  }, [bills, router]);

  /* -------------------------------------- */
  /* RENDER                                 */
  /* -------------------------------------- */

  const isInitialProfileLoading = isProfileLoading && !address;
  const unpaidSplitsCount = bills.filter((bill) => {
    if (bill.userStatus === "creator") {
      const debtors = Number(bill.debtors ?? 0);
      const paidCount = Number(bill.paidCount ?? 0);
      return debtors > 0 && paidCount < debtors;
    }
    if (bill.userStatus === "participant" || bill.userStatus === "invited") {
      return bill.hasPaid !== true && bill.isSettled !== true;
    }
    return false;
  }).length;
  const unpaidSpinsCount = userRooms.filter((room) => {
    const chosenAddress = room.chosen?.address?.toLowerCase();
    if (!chosenAddress) return true;

    return !(room.paid ?? []).some(
      (payment) => payment.address?.toLowerCase() === chosenAddress
    );
  }).length;
  const renderProfileSkeleton = () => (
    <div className="min-h-screen w-full flex flex-col items-center p-4 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(10rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
      <div className="w-full max-w-md">
        <div className="pt-3 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-9 w-40 rounded-md" />
              <Skeleton className="h-4 w-24 rounded-md" />
            </div>
            <Skeleton className="w-16 h-16 rounded-full shrink-0" />
          </div>

        </div>


        <div className="space-y-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      </div>
    </div>
  );

  if (isInitialProfileLoading) {
    return renderProfileSkeleton();
  }

  const renderProfileHero = () => {
    if (!address) {
      return (
        <div className="text-center text-white/40 py-10">
          Connect an account to view your profile.
        </div>
      );
    }

    const hero = farcasterHero;
    const effectiveUsername = hero?.username ?? username ?? null;
    const effectiveName =
      effectiveUsername ? `@${effectiveUsername}` : hero?.displayName ?? displayName ?? "Profile";
    const effectivePfp = hero?.pfpUrl ?? pfp ?? null;
    const followerCountLabel = formatCompactNumber(hero?.followerCount);
    const joinedLabel = hero?.joinedAt
      ? `Joined ${new Date(hero.joinedAt).toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      })}`
      : null;

    if (farcasterHeroLoading && !hero) {
      return (
        <div className="pt-3 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-12 w-40 rounded-md" />
              <Skeleton className="h-6 w-28 rounded-md" />
            </div>
            <Skeleton className="w-24 h-24 rounded-full" />
          </div>
         
        </div>
      );
    }

    return (
      <div className="pt-3 pb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white truncate">
              {effectiveName}
            </h1>
            {!effectiveUsername && (
              <div className="mt-2 text-white/50 text-base truncate">
                No Farcaster handle
              </div>
            )}
            <div className="mt-2 text-white/35 text-sm truncate">
              {shortAddress(address)}
            </div>
            {/* {joinedLabel ? (
              <p className="mt-1 text-sm text-white/35 truncate">{joinedLabel}</p>
            ) : null} */}
          </div>

          <div className="shrink-0">
            <UserAvatar
              src={effectivePfp}
              seed={effectiveName}
              alt={effectiveName}
              width={80}
              className="w-20 h-20 rounded-full object-cover border border-white/10 bg-white/5"
            />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {hero?.bio ? (
            <p className="text-md leading-snug text-white/90">
              {hero.bio}
            </p>
          ) : (
            <p className="text-md leading-snug text-white/40">
              Add a Farcaster bio to personalize your profile.
            </p>
          )}

          {(followerCountLabel || (hero?.followerPreviewPfps?.length ?? 0) > 0) && (
            <div className="flex items-center gap-1">
              {hero?.followerPreviewPfps?.length ? (
                <div className="flex -space-x-2">
                  {hero.followerPreviewPfps.map((pfpUrl, idx) => (
                    <UserAvatar
                      key={`${pfpUrl}-${idx}`}
                      src={pfpUrl}
                      seed={`${effectiveUsername ?? effectiveName}-${idx}`}
                      width={32}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover border-2 border-background bg-white/5"
                    />
                  ))}
                </div>
              ) : null}
              {followerCountLabel ? (
                <p className="text-md text-white/50">
                  {followerCountLabel} followers
                </p>
              ) : null}
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="inline-flex items-center rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loggingOut ? "Logging out..." : "Log out"}
          </button>
        </div>
      </div>
    );
  };

  const renderListLoadingSkeleton = (rows = 3) => (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, idx) => (
        <div
          key={idx}
          className="p-4 rounded-xl border border-white/10 bg-white/[0.02]"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0 space-y-2">
              <Skeleton className="h-4 w-40 rounded-md" />
              <Skeleton className="h-3 w-24 rounded-md" />
            </div>
            <div className="space-y-2 text-right shrink-0">
              <Skeleton className="h-4 w-16 rounded-md" />
              <Skeleton className="h-3 w-14 rounded-md" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderSplitsTab = () => {
    if (billsLoading && !billsLoaded) {
      return renderListLoadingSkeleton(3);
    }

    return (
      <div>
        {bills.length === 0 ? (
          <div className="flex flex-col items-center text-center text-white/30 py-10">
     
            <p>No split bills yet...</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {bills.map((bill) => {
              const isCreator = bill.userStatus === "creator";
              const isInvited = bill.userStatus === "invited";
              const hasPaid = bill.hasPaid === true;

              return (
                <li key={bill.splitId}>
                  <Link
                    href={`/split/${bill.splitId}`}
                    prefetch
                    className="block p-4 rounded-xl border border-white/10 hover:bg-white/5 active:scale-[0.98] transition cursor-pointer"
                  >
                    <div className="flex justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-1 w-full">
                          <div className="flex items-center gap-1 min-w-0">
                            <p className="text-md font-medium text-white/90 truncate max-w-[30vw] sm:max-w-[100px]">
                              {bill.description || "No description"}
                            </p>
                            <div className="flex -space-x-2 shrink-0">
                              {bill.participants.slice(0, 3).map((p, idx) => (
                                <UserAvatar
                                  key={idx}
                                  src={p.pfp}
                                  seed={p.name}
                                  width={24}
                                  alt={p.name || "Participant"}
                                  className="w-6 h-6 rounded-full border-2 border-background object-cover"
                                />
                              ))}

                              {bill.participants.length > 3 && (
                                <div className="w-6 h-6 flex items-center justify-center rounded-full bg-white/5 text-xs text-white/40 border-2 border-background">
                                  +{bill.participants.length - 3}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0">
                            {isCreator ? (
                              <span className="px-1.5 py-0.5 text-xs rounded-[6px] bg-yellow-600/20 text-yellow-300 border border-yellow-500/30">
                                Owner
                              </span>
                            ) : isInvited && !hasPaid ? (
                              <span className="px-1.5 py-0.5 text-xs rounded-[6px] bg-white/10 text-white/40 border border-white/20">
                                Invited
                              </span>
                            ) : hasPaid ? (
                              <span className="px-1.5 py-0.5 text-xs rounded-[6px] bg-green-500/20 text-green-300 border border-green-500/30">
                                Paid
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 text-xs rounded-[6px] bg-orange-900/20 text-orange-400 border border-orange-400/30">
                                Unpaid
                              </span>
                            )}
                          </div>
                        </div>

                        <p className="text-xs text-white/30">
                          {new Date(bill.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      </div>

                      <div className="text-right space-y-1">
                        <p className="text-lg font-semibold">${bill.totalAmount}</p>
                        <p
                          className={`text-xs ${bill.debtors === 0
                            ? "text-white/40"
                            : bill.paidCount >= bill.debtors
                              ? "text-green-400"
                              : bill.paidCount > 0
                                ? "text-yellow-400"
                                : "text-red-400"
                            }`}
                        >
                          {bill.debtors === 0
                            ? "No payments"
                            : bill.paidCount >= bill.debtors
                              ? "Settled"
                              : `${bill.paidCount} / ${bill.debtors} paid`}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  const renderSpinsTab = () => {
    if (roomsLoading && !roomsLoaded) {
      return renderListLoadingSkeleton(3);
    }

    return (
      <div>
        {userRooms.length === 0 ? (
          <div className="flex flex-col items-center text-center text-white/30 py-10">
          
            <p>No pay spins yet...</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {userRooms.map((room) => {
              const isAdmin =
                address?.toLowerCase() === room.admin?.toLowerCase();

              return (
                <li
                  key={room.gameId}
                  onClick={() => router.push(`/game/${room.gameId}`)}
                  className="p-4 rounded-xl border border-white/10 hover:bg-white/5 transition cursor-pointer flex justify-between items-center"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-medium">{room.name}</p>
                      {isAdmin ? (
                        <span className="px-1.5 py-0.5 text-xs rounded-[6px] bg-yellow-600/20 text-yellow-300 border border-yellow-500/30">
                          Host
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-xs rounded-[6px] bg-white/10 text-white/40 border border-white/20">
                          Invited
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/30 mt-1">
                      {new Date(room.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>

                  <div className="flex -space-x-2">
                    {room.members.slice(0, 5).map((m, i) => (
                      <UserAvatar
                        key={i}
                        src={m.pfp}
                        seed={m.name}
                        width={24}
                        alt={m.name || "Member"}
                        className="w-6 h-6 rounded-full object-cover"
                      />
                    ))}
                    {room.members.length > 5 && (
                      <div className="w-6 h-6 flex items-center justify-center rounded-full bg-white/5 text-xs text-white/40 border-2 border-background">
                        +{room.members.length - 5}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center p-4 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(10rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
      <div className="w-full max-w-md">
        <div className="mb-2 mt-4">{renderProfileHero()}</div>

        <div className="mb-4 mt-3 flex border-b border-white/10">
          <button
            onClick={() => {
              setActiveTab("splits");
              void fetchUserBills();
            }}
            className={`w-1/2 pb-3 text-lg font-medium transition relative ${activeTab === "splits" ? "text-white" : "text-white/50"
              }`}
          >
            {`Splits (${unpaidSplitsCount})`}
            {activeTab === "splits" && (
              <span className="absolute left-0 right-0 -bottom-[1px] h-1 bg-primary rounded-full" />
            )}
          </button>
          <button
            onClick={() => {
              setActiveTab("spins");
              void fetchUserRooms();
            }}
            className={`w-1/2 pb-3 text-lg font-medium transition relative ${activeTab === "spins" ? "text-white" : "text-white/50"
              }`}
          >
            {unpaidSpinsCount > 0 ? `Spins (${unpaidSpinsCount})` : "Spins"}
            {activeTab === "spins" && (
              <span className="absolute left-0 right-0 -bottom-[1px] h-1 bg-primary rounded-full" />
            )}
          </button>
        </div>

        {activeTab === "splits" && renderSplitsTab()}
        {activeTab === "spins" && renderSpinsTab()}
      </div>
    </div>
  );
}
