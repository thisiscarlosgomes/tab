"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useIdentityToken, usePrivy, useToken } from "@privy-io/react-auth";
import { Header } from "@/components/header";
import { FooterNav } from "@/components/footer-nav";
import { InstallQrCard } from "@/components/InstallQrCard";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, authenticated, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { getAccessToken } = useToken();
  const lastSyncedUserKeyRef = useRef<string | null>(null);

  const isPublicRoute =
    pathname === "/" ||
    pathname === "/faq" ||
    pathname.startsWith("/claim/") ||
    pathname.startsWith("/claims/") ||
    pathname.startsWith("/r/") ||
    pathname === "/r" ||
    pathname.startsWith("/receive/") ||
    pathname.startsWith("/join-split") ||
    pathname.startsWith("/agent/claim/");
  const hideHeaderOnRoute =
    pathname === "/rooms";
  const showDesktopHeaderOnly = pathname.startsWith("/game");
  const hasLinkedFarcaster = useMemo(
    () =>
      Boolean(
        user?.farcaster ||
          user?.linkedAccounts?.some((account) => account.type === "farcaster")
      ),
    [user]
  );
  const needsFarcasterOnboarding = Boolean(
    ready && authenticated && user?.id && !hasLinkedFarcaster
  );
  const isAuthed = ready && authenticated && !needsFarcasterOnboarding;

  useEffect(() => {
    if (ready && !authenticated && !isPublicRoute) {
      router.replace("/");
    }
  }, [ready, authenticated, isPublicRoute, router]);

  useEffect(() => {
    if (!ready || !authenticated || !needsFarcasterOnboarding) return;
    if (!isPublicRoute) {
      router.replace("/");
    }
  }, [ready, authenticated, needsFarcasterOnboarding, isPublicRoute, router]);

  useEffect(() => {
    if (!isAuthed) return;
    router.prefetch("/profile");
    router.prefetch("/activity");
    router.prefetch("/table");
    router.prefetch("/faq");
  }, [isAuthed, router]);

  useEffect(() => {
    if (!ready || !authenticated || !user?.id || !hasLinkedFarcaster) {
      lastSyncedUserKeyRef.current = null;
      return;
    }

    const syncKey = `${user.id}:${user.farcaster?.fid ?? "linked"}`;
    if (lastSyncedUserKeyRef.current === syncKey) return;
    lastSyncedUserKeyRef.current = syncKey;

    let cancelled = false;
    const syncProfile = async () => {
      const token = identityToken ?? (await getAccessToken().catch(() => null));
      if (!token || cancelled) return;

      try {
        await fetch("/api/user/sync", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {
        // best-effort background sync
      }
    };

    void syncProfile();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, user?.id, user?.farcaster?.fid, hasLinkedFarcaster, identityToken, getAccessToken]);

  if (!ready) {
    return (
      <div className="bg-background min-h-screen w-full overflow-x-hidden scrollbar-hide">
        {children}
        <InstallQrCard />
      </div>
    );
  }

  if (!authenticated) {
    if (!isPublicRoute) {
      return (
        <div className="bg-background min-h-screen w-full overflow-x-hidden scrollbar-hide" />
      );
    }

    return (
      <div className="bg-background min-h-screen w-full overflow-x-hidden scrollbar-hide">
        {children}
        <InstallQrCard />
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen w-full overflow-x-hidden scrollbar-hide">
      {isAuthed && !hideHeaderOnRoute ? <Header /> : null}
      {isAuthed && hideHeaderOnRoute && showDesktopHeaderOnly ? (
        <div className="hidden md:block">
          <Header />
        </div>
      ) : null}
      {children}
      <InstallQrCard />
      {isAuthed ? <div className="md:hidden"><FooterNav /></div> : null}
    </div>
  );
}
