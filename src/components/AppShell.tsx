"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCreateWallet,
  useIdentityToken,
  useOAuthTokens,
  usePrivy,
  useToken,
  useWallets,
} from "@privy-io/react-auth";
import { Header } from "@/components/header";
import { FooterNav } from "@/components/footer-nav";
import { InstallQrCard } from "@/components/InstallQrCard";
import { InlineTabAssistant } from "@/components/app/InlineTabAssistant";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, authenticated, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { getAccessToken } = useToken();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const lastSyncedUserKeyRef = useRef<string | null>(null);
  const walletCreationAttemptedUserIdRef = useRef<string | null>(null);
  const [pendingTwitterOAuthTokens, setPendingTwitterOAuthTokens] = useState<{
    provider: string;
    accessToken: string;
    accessTokenExpiresInSeconds?: number;
    refreshToken?: string;
    refreshTokenExpiresInSeconds?: number;
    scopes?: string[];
  } | null>(null);

  const isPublicRoute =
    pathname === "/" ||
    pathname === "/faq" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname.startsWith("/claim/") ||
    pathname.startsWith("/claims/") ||
    pathname.startsWith("/r/") ||
    pathname === "/r" ||
    pathname.startsWith("/receive/") ||
    pathname.startsWith("/join-split") ||
    pathname.startsWith("/agent/claim/");
  const hideHeaderOnRoute =
    pathname === "/rooms" || pathname.startsWith("/assistant");
  const hideFooterOnRoute = pathname.startsWith("/assistant");
  const hideAssistantLauncherOnRoute = pathname.startsWith("/assistant");
  const hideInstallQrOnRoute = pathname.startsWith("/assistant");
  const showDesktopHeaderOnly = pathname.startsWith("/game");
  const hasLinkedTwitter = useMemo(
    () =>
      Boolean(
        user?.twitter ||
          user?.linkedAccounts?.some((account) => account.type === "twitter_oauth")
      ),
    [user]
  );
  const hasLinkedFarcaster = useMemo(
    () =>
      Boolean(
        user?.farcaster ||
          user?.linkedAccounts?.some((account) => account.type === "farcaster")
      ),
    [user]
  );
  const hasLinkedSupportedSocial = hasLinkedFarcaster || hasLinkedTwitter;
  const hasEmbeddedPrivyWallet = useMemo(
    () =>
      wallets.some(
        (wallet) =>
          wallet.walletClientType === "privy" &&
          typeof wallet.address === "string"
      ),
    [wallets]
  );
  const needsSocialOnboarding = Boolean(
    ready && authenticated && user?.id && !hasLinkedSupportedSocial
  );
  const isAuthed = ready && authenticated && !needsSocialOnboarding;

  useOAuthTokens({
    onOAuthTokenGrant: async ({ oAuthTokens }) => {
      if (oAuthTokens.provider !== "twitter") return;
      setPendingTwitterOAuthTokens({
        provider: oAuthTokens.provider,
        accessToken: oAuthTokens.accessToken,
        accessTokenExpiresInSeconds: oAuthTokens.accessTokenExpiresInSeconds,
        refreshToken: oAuthTokens.refreshToken,
        refreshTokenExpiresInSeconds: oAuthTokens.refreshTokenExpiresInSeconds,
        scopes: Array.isArray(oAuthTokens.scopes) ? oAuthTokens.scopes : [],
      });
    },
  });

  useEffect(() => {
    if (!pendingTwitterOAuthTokens) return;
    if (!ready || !authenticated || !user?.id) return;

    let cancelled = false;
    const persistTwitterOAuthTokens = async () => {
      const token = identityToken ?? (await getAccessToken().catch(() => null));
      if (!token || cancelled) return;

      try {
        const res = await fetch("/api/twitter/oauth", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            tokens: pendingTwitterOAuthTokens,
          }),
        });

        if (!res.ok || cancelled) return;
        setPendingTwitterOAuthTokens(null);
      } catch {
        // best-effort token persistence for Twitter graph sync
      }
    };

    void persistTwitterOAuthTokens();
    return () => {
      cancelled = true;
    };
  }, [
    pendingTwitterOAuthTokens,
    ready,
    authenticated,
    user?.id,
    identityToken,
    getAccessToken,
  ]);

  useEffect(() => {
    if (ready && !authenticated && !isPublicRoute) {
      router.replace("/");
    }
  }, [ready, authenticated, isPublicRoute, router]);

  useEffect(() => {
    if (!ready || !authenticated || !needsSocialOnboarding) return;
    if (!isPublicRoute) {
      router.replace("/");
    }
  }, [ready, authenticated, needsSocialOnboarding, isPublicRoute, router]);

  useEffect(() => {
    if (!isAuthed) return;
    router.prefetch("/profile");
    router.prefetch("/activity");
    router.prefetch("/table");
    router.prefetch("/faq");
  }, [isAuthed, router]);

  useEffect(() => {
    if (!ready || !authenticated || !user?.id) {
      walletCreationAttemptedUserIdRef.current = null;
      return;
    }

    if (hasEmbeddedPrivyWallet) {
      walletCreationAttemptedUserIdRef.current = user.id;
      return;
    }

    if (walletCreationAttemptedUserIdRef.current === user.id) return;
    walletCreationAttemptedUserIdRef.current = user.id;

    let cancelled = false;
    const ensureWallet = async () => {
      try {
        await createWallet();
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to create embedded wallet", error);
      }
    };

    void ensureWallet();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, user?.id, hasEmbeddedPrivyWallet, createWallet]);

  useEffect(() => {
    if (!ready || !authenticated || !user?.id || !hasLinkedSupportedSocial) {
      lastSyncedUserKeyRef.current = null;
      return;
    }

    const syncKey = `${user.id}:${user.farcaster?.fid ?? user.twitter?.subject ?? "linked"}`;
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
  }, [
    ready,
    authenticated,
    user?.id,
    user?.farcaster?.fid,
    user?.twitter?.subject,
    hasLinkedSupportedSocial,
    identityToken,
    getAccessToken,
  ]);

  if (!ready) {
    return (
      <div className="bg-background min-h-screen w-full overflow-x-hidden scrollbar-hide">
        {children}
        {!hideInstallQrOnRoute ? <InstallQrCard /> : null}
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
        {!hideInstallQrOnRoute ? <InstallQrCard /> : null}
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
      {!hideInstallQrOnRoute ? <InstallQrCard /> : null}
      {/* {isAuthed && !hideAssistantLauncherOnRoute ? <InlineTabAssistant /> : null} */}
      {isAuthed && !hideFooterOnRoute ? <div className="md:hidden"><FooterNav /></div> : null}
    </div>
  );
}
