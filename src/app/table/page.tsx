"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import sdk from "@farcaster/frame-sdk";
import { NumericFormat } from "react-number-format";
import { tokenList } from "@/lib/tokens";
import { useTabIdentity } from "@/lib/useTabIdentity";
import { PaymentTokenPickerDialog } from "@/components/app/PaymentTokenPickerDialog";
import { FriendsPickerDialog } from "@/components/app/FriendsPickerDialog";
import { getSocialUserKey, SocialUser } from "@/lib/social";
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog";

import { LoaderCircle } from "lucide-react";

type InviteUser = SocialUser & {
  verified_addresses?: {
    primary?: {
      eth_address?: string | null;
    };
    eth_addresses?: string[];
  };
};

export default function SplitPage() {
  const { address, isConnected } = useAccount();
  const { user, getAccessToken } = usePrivy();
  const {
    username: tabUsername,
    pfp: tabPfp,
    fid: tabFid,
  } = useTabIdentity();
  const router = useRouter();

  const [roomName, setRoomName] = useState("");
  const [amount, setAmount] = useState("");
  const [tokenType, setTokenType] = useState("USDC");

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [showSpinCreateIntroDialog, setShowSpinCreateIntroDialog] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [followers, setFollowers] = useState<InviteUser[]>([]);
  const [filteredFollowers, setFilteredFollowers] = useState<InviteUser[]>([]);
  const [selectedInvites, setSelectedInvites] = useState<InviteUser[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteSearchLoading, setInviteSearchLoading] = useState(false);

  const selectedToken = tokenList.find((t) => t.name === tokenType);
  const [showHowItWorks, setShowHowItWorks] = useState(true);

  const linkedFarcasterFid = user?.farcaster?.fid ?? null;
  const linkedFarcasterUsername = user?.farcaster?.username ?? null;
  const linkedTwitterSubject = user?.twitter?.subject ?? null;
  const linkedTwitterUsername = user?.twitter?.username ?? null;
  const hasLinkedFarcaster = Boolean(
    user?.farcaster ||
      user?.linkedAccounts?.some((account) => account.type === "farcaster")
  );
  const hasLinkedTwitter = Boolean(
    user?.twitter ||
      user?.linkedAccounts?.some((account) => account.type === "twitter_oauth")
  );
  const prefersTwitterGraph = hasLinkedTwitter && !hasLinkedFarcaster;

  const friendsCacheKey = useMemo(
    () =>
      prefersTwitterGraph
        ? (linkedTwitterSubject ? `twitter:followers:${linkedTwitterSubject}` : null) ??
          (linkedTwitterUsername
            ? `twitter:followers:${linkedTwitterUsername.toLowerCase()}`
            : null) ??
          tabUsername ??
          address ??
          null
        : (linkedFarcasterFid ? `farcaster:mutuals:fid:${linkedFarcasterFid}` : null) ??
          (linkedFarcasterUsername
            ? `farcaster:mutuals:username:${linkedFarcasterUsername.toLowerCase()}`
            : null) ??
          (tabFid ? `farcaster:mutuals:fid:${tabFid}` : null) ??
          (tabUsername ? `farcaster:mutuals:username:${tabUsername.toLowerCase()}` : null) ??
          (address ? `farcaster:mutuals:address:${address.toLowerCase()}` : null) ??
          null,
    [
      linkedFarcasterFid,
      linkedFarcasterUsername,
      linkedTwitterSubject,
      linkedTwitterUsername,
      prefersTwitterGraph,
      tabFid,
      tabUsername,
      address,
    ]
  );

  useEffect(() => {
    try {
      const seen = window.localStorage.getItem("tab:intro:spin-create");
      if (seen !== "1") setShowSpinCreateIntroDialog(true);
    } catch {
      setShowSpinCreateIntroDialog(true);
    }
  }, []);

  useEffect(() => {
    try {
      if (!friendsCacheKey) return;
      const cached = localStorage.getItem(`tab_friends_${friendsCacheKey}`);
      if (!cached) return;
      const parsed = JSON.parse(cached);
      if (!Array.isArray(parsed)) return;
      const next = parsed
        .map((entry) => entry?.user ?? entry)
        .filter((u): u is InviteUser => Boolean(u?.username && u?.provider));
      setFollowers(next);
      if (!inviteQuery.trim()) setFilteredFollowers(next);
    } catch {
      // ignore cache parse errors
    }
  }, [friendsCacheKey, inviteQuery]);

  useEffect(() => {
    let cancelled = false;
    const mapFarcasterUser = (entry: unknown): InviteUser | null => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as SocialUser;
      if (typeof candidate.fid !== "number") return null;
      return {
        ...candidate,
        id: `farcaster:${candidate.fid}`,
        provider: "farcaster",
      };
    };
    const q = inviteQuery.trim().toLowerCase().replace(/^@/, "");
    if (!q) {
      setInviteSearchLoading(false);
      setFilteredFollowers(followers);
      return;
    }

    setInviteSearchLoading(true);
    const localMatches = followers.filter((u) => {
      const username = (u.username ?? "").toLowerCase();
      const displayName = (u.display_name ?? "").toLowerCase();
      return username.includes(q) || displayName.includes(q);
    });
    // Show local/cached matches immediately so typing feels instant.
    setFilteredFollowers(localMatches.slice(0, 50));
    if (q.length < 2) {
      setInviteSearchLoading(false);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        let remoteMatches: InviteUser[] = [];
        if (prefersTwitterGraph) {
          const token = await getAccessToken().catch(() => null);
          const res = await fetch(
            `/api/twitter/user/by-username?username=${encodeURIComponent(inviteQuery)}`,
            token
              ? {
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                }
              : undefined
          );
          const data = await res.json().catch(() => null);
          remoteMatches = data?.user ? [data.user as InviteUser] : [];
        } else {
          const res = await fetch(`/api/neynar/user/search?q=${encodeURIComponent(inviteQuery)}`);
          const data = await res.json().catch(() => null);
          const remoteUsers = Array.isArray(data)
            ? data
            : Array.isArray(data?.users)
              ? data.users
              : [];
          remoteMatches = remoteUsers
            .map(mapFarcasterUser)
            .filter((user): user is InviteUser => Boolean(user));
        }
        const seen = new Set<string>();
        const merged = [...localMatches, ...remoteMatches].filter((entry) => {
          if (!entry) return false;
          const key = getSocialUserKey(entry);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (!cancelled) {
          setFilteredFollowers(merged.slice(0, 50));
        }
      } catch {
        // keep local matches
        if (!cancelled) {
          setFilteredFollowers(localMatches.slice(0, 50));
        }
      } finally {
        if (!cancelled) {
          setInviteSearchLoading(false);
        }
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      setInviteSearchLoading(false);
    };
  }, [inviteQuery, followers, prefersTwitterGraph, getAccessToken]);

  useEffect(() => {
    const loadFollowers = async () => {
      if (!inviteDialogOpen && followers.length > 0) return;

      let fid = tabFid ?? null;
      let username = tabUsername ?? null;
      let addr = address ?? null;

      if (!fid && !username && !addr) {
        try {
          const context = await sdk.context;
          fid = context?.user?.fid ?? null;
          username = context?.user?.username ?? null;
        } catch {
          // ignore
        }
      }

      const query = fid
        ? `fid=${encodeURIComponent(String(fid))}`
        : username
          ? `username=${encodeURIComponent(username)}`
          : addr
            ? `address=${encodeURIComponent(addr)}`
            : null;

      setInvitesLoading(true);
      try {
        let next: InviteUser[] = [];
        if (prefersTwitterGraph) {
          const token = await getAccessToken().catch(() => null);
          if (!token) return;
          const res = await fetch("/api/twitter/followers?limit=50", {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          const data = await res.json().catch(() => []);
          if (!Array.isArray(data)) return;
          next = data
            .filter((entry): entry is InviteUser => Boolean(entry?.username))
            .slice(0, 50);
        } else {
          if (!query) return;
          const res = await fetch(`/api/neynar/user/mutuals?${query}`);
          const data = await res.json().catch(() => []);
          if (!Array.isArray(data)) return;
          next = data
            .map((entry) => entry?.user ?? entry)
            .map((entry) =>
              entry && typeof entry?.fid === "number"
                ? {
                    ...entry,
                    id: `farcaster:${entry.fid}`,
                    provider: "farcaster" as const,
                  }
                : null
            )
            .filter((entry): entry is InviteUser => Boolean(entry))
            .slice(0, 50);
        }
        setFollowers(next);
        if (!inviteQuery.trim()) setFilteredFollowers(next);
        if (friendsCacheKey && next.length > 0) {
          localStorage.setItem(`tab_friends_${friendsCacheKey}`, JSON.stringify(next));
        }
      } catch {
        // best-effort
      } finally {
        setInvitesLoading(false);
      }
    };

    void loadFollowers();
  }, [
    inviteDialogOpen,
    followers.length,
    tabFid,
    tabUsername,
    address,
    inviteQuery,
    friendsCacheKey,
    prefersTwitterGraph,
    getAccessToken,
  ]);

  const buildPlayer = async () => {
    let context: Awaited<typeof sdk.context> | null = null;

    if (!tabUsername && !tabPfp && !tabFid) {
      try {
        context = await sdk.context;
      } catch {
        context = null;
      }
    }

    const frameUser = context?.user;

    return {
      address: address!.toLowerCase(),
      name: frameUser?.username ?? tabUsername ?? address?.slice(0, 6),
      pfp: frameUser?.pfpUrl ?? tabPfp ?? null,
      fid: frameUser?.fid ?? tabFid ?? null,
    };
  };

  const handleCreateRoom = async () => {
    if (!isConnected || !address) return;
    if (!roomName.trim() || !amount) return;

    setCreating(true);
    setError(null);
    let shouldResetCreating = true;

    try {
      const player = await buildPlayer();

      const res = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: roomName.trim(),
          amount: Number(amount),
          spinToken: tokenType,
          player,
          invited: selectedInvites.map((u) => ({
            provider: u.provider,
            fid: u.fid ?? null,
            twitter_subject: u.twitter_subject ?? null,
            username: u.username,
            name: u.username,
            pfp: u.pfp_url ?? null,
            address:
              u.verified_addresses?.primary?.eth_address ??
              u.verified_addresses?.eth_addresses?.find(
                (addr) => typeof addr === "string" && addr.startsWith("0x")
              ) ??
              null,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create room");
      if (!data?.gameId) throw new Error("Room created but no gameId returned");

      const nextUrl = `/game/${data.gameId}`;
      shouldResetCreating = false;
      router.push(nextUrl);

      // Fallback for embedded webviews where Next client navigation can be flaky.
      setTimeout(() => {
        if (typeof window !== "undefined" && window.location.pathname !== nextUrl) {
          window.location.assign(nextUrl);
        }
      }, 25);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (shouldResetCreating) {
        setCreating(false);
      }
    }
  };

  const getTokenSuffix = (token: string) => {
    switch (token) {
      case "USDC":
        return "$";
      case "EURC":
        return "€";
      case "ETH":
      case "WETH":
        return "Ξ";
      default:
        return "$";
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center p-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(7rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
      <ResponsiveDialog
        open={showSpinCreateIntroDialog}
        onOpenChange={(open) => {
          if (open) setShowSpinCreateIntroDialog(true);
        }}
      >
        <ResponsiveDialogContent className="top-auto h-auto min-h-0 max-h-[calc(100dvh-80px)] p-4 pb-16 md:top-1/2 md:-translate-y-1/2 md:max-w-md md:pb-4">
          <ResponsiveDialogTitle className="sr-only">
            Spin the tab
          </ResponsiveDialogTitle>
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Create a new spin</h2>
              <p className="mt-2 text-sm leading-6 text-white/60">
                Set the amount, invite friends, and let a spin decide who pays.
                Fast and fair for group tabs.
              </p>
            </div>

            <Button
              className="w-full bg-white/5 text-white"
              onClick={() => {
                try {
                  window.localStorage.setItem("tab:intro:spin-create", "1");
                } catch {}
                setShowSpinCreateIntroDialog(false);
              }}
            >
              Got it
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <div className="w-full max-w-md flex flex-col space-y-5">
        {/* Intro */}

        <div className="text-center text-lg font-medium">
          Create a new spin
        </div>

        {/* Amount */}
        <div className="flex flex-col items-center -mt-1">
          <NumericFormat
            inputMode="decimal"
            value={amount}
            onValueChange={(v) => setAmount(v.value)}
            thousandSeparator
            allowNegative={false}
            decimalScale={4}
            prefix={getTokenSuffix(tokenType)}
            placeholder={`${getTokenSuffix(tokenType)}0`}
            className={`leading-none text-5xl bg-transparent text-center font-medium outline-none placeholder-white/20 ${
              !amount ? "text-white/20" : "text-primary"
            }`}
          />
          <p className="text-sm text-white/30">Amount at stake</p>
        </div>

        <div className="w-full max-w-md flex flex-col space-y-3 mt-6">
          {/* Room name */}
          <input
            type="text"
            placeholder="name"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            className="placeholder-white/30 w-full p-4 rounded-lg text-white bg-white/5"
          />

          {/* Token selector */}
          <button
            onClick={() => setTokenDialogOpen(true)}
            className="w-full flex items-center justify-between p-4 rounded-lg bg-white/5"
          >
            <div className="flex items-center gap-2">
              <img
                src={selectedToken?.icon}
                alt={selectedToken?.name ?? tokenType}
                className="w-7 h-7 rounded-full"
              />
              <span className="text-white">{tokenType}</span>
            </div>
            <span className="text-primary">Change</span>
          </button>

          <div className="rounded-lg bg-white/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-white">
                  Invite friends <span className="text-white/40">(optional)</span>
                </p>
                <p className="text-sm text-white/40">
                  They&apos;ll show as invited until they join.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInviteDialogOpen(true)}
                className="shrink-0 text-primary"
              >
                {selectedInvites.length === 0 ? "Add" : "Edit"}
              </button>
            </div>

            {selectedInvites.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedInvites.map((u) => (
                  <div
                    key={getSocialUserKey(u)}
                    className="flex items-center gap-2 rounded-full bg-white/5 pl-1 pr-2 py-1"
                  >
                    <img
                      src={
                        u.pfp_url ||
                        `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${u.username}`
                      }
                      className="h-6 w-6 rounded-full object-cover"
                      alt={u.username}
                    />
                    <span className="text-xs text-white">@{u.username}</span>
                    <button
                      type="button"
                      className="text-white/50"
                      onClick={() =>
                        setSelectedInvites((prev) =>
                          prev.filter(
                            (x) => getSocialUserKey(x) !== getSocialUserKey(u)
                          )
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CTA */}
          <Button
            onClick={handleCreateRoom}
            disabled={creating || !roomName || !amount}
            className="w-full bg-primary"
          >
            {creating ? (
              <>
                <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                Creating…
              </>
            ) : (
              <>Create</>
            )}
          </Button>

          {error && <p className="text-sm text-red-400 text-center">{error}</p>}

          <div className="hidden rounded-[16px] bg-card p-4 text-left">
            <button
              onClick={() => setShowHowItWorks(!showHowItWorks)}
              className="w-full flex items-center justify-between text-white/40"
            >
              <span className="text-md ml-2">How it works</span>
              <span className="hidden text-white/60">
                {showHowItWorks ? "−" : "+"}
              </span>
            </button>

            {showHowItWorks && (
              <div className="mt-2 space-y-1 text-white/50 text-sm">
                <p>• Everyone joins the group</p>
                <p>• One spin randomly picks who pays</p>
                <p>• The chosen person covers the full tab</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <PaymentTokenPickerDialog
        open={tokenDialogOpen}
        onOpenChange={setTokenDialogOpen}
        selectedToken={tokenType}
        onSelect={setTokenType}
      />

      <FriendsPickerDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        query={inviteQuery}
        onQueryChange={setInviteQuery}
        onPaste={async () => {
          try {
            const text = await navigator.clipboard.readText();
            setInviteQuery(text);
          } catch {}
        }}
        users={filteredFollowers}
        selectedUsers={selectedInvites}
        onToggleUser={(u) =>
          setSelectedInvites((prev) =>
            prev.some((x) => getSocialUserKey(x) === getSocialUserKey(u))
              ? prev.filter(
                  (x) => getSocialUserKey(x) !== getSocialUserKey(u)
                )
              : [...prev, u]
          )
        }
        onDone={() => setInviteDialogOpen(false)}
        loading={invitesLoading}
        searching={inviteSearchLoading}
      />
    </div>
  );
}
