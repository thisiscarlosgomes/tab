"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { z } from "zod";
import { meSchema } from "@/lib/dinner/client-schema";

type Api = <T = unknown>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
) => Promise<T>;
export const DinnerContext = createContext<{
  api: Api;
  me: z.infer<typeof meSchema> | null;
  image: (path: string) => Promise<Blob>;
} | null>(null);
export function useDinner() {
  const context = useContext(DinnerContext);
  if (!context) throw new Error("Dinner shell is required");
  return context;
}
export function DinnerShell({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const pathname = usePathname();
  const [me, setMe] = useState<z.infer<typeof meSchema> | null>(null);
  const [error, setError] = useState("");
  const api: Api = useCallback(
    async <T,>(
      path: string,
      init: RequestInit,
      schema: z.ZodType<T>,
    ): Promise<T> => {
      const token = identityToken ?? (await getAccessToken());
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (typeof init.body === "string")
        headers.set("Content-Type", "application/json");
      const res = await fetch(`/api/dinner${path}`, {
        ...init,
        headers,
        cache: "no-store",
        signal: init.signal ?? AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const parsed = z
          .object({ error: z.string() })
          .safeParse(await res.json());
        throw new Error(
          parsed.success
            ? parsed.data.error
            : "Could not complete that request",
        );
      }
      const value: unknown = await res.json();
      return schema.parse(value);
    },
    [identityToken, getAccessToken],
  );
  const image = useCallback(
    async (path: string) => {
      const token = identityToken ?? (await getAccessToken());
      const response = await fetch(`/api/dinner${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not open this private image");
      return response.blob();
    },
    [identityToken, getAccessToken],
  );
  useEffect(() => {
    setMe(null);
    setError("");
    if (!authenticated) return;
    let active = true;
    void api("/me", {}, meSchema)
      .then((value) => {
        if (active) setMe(value);
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load your identity",
          );
      });
    return () => {
      active = false;
    };
  }, [api, authenticated]);
  const publicInvite = pathname.startsWith("/app/invite/");
  return (
    <div className="dinner-app">
      <header className="dinner-header">
        <Link className="dinner-wordmark" href="/app">
          tab<span>together is easier</span>
        </Link>
        <div className="dinner-account">
          <Link className="dinner-inline-link" href="/app/agent">
            Ask Tab ↗
          </Link>
          <span className="dinner-beta">Rooms beta</span>
          {authenticated ? (
            <button className="dinner-quiet" onClick={() => void logout()}>
              Sign out
            </button>
          ) : (
            <button onClick={() => login({ loginMethods: ["twitter"] })}>
              Sign in with X
            </button>
          )}
        </div>
      </header>
      <nav className="dinner-nav" aria-label="Main navigation">
        {[
          { href: "/app", label: "Today" },
          { href: "/app/rooms", label: "Rooms" },
          { href: "/app/wallet", label: "Wallet" },
          { href: "/app/activity", label: "Activity" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={
              item.href === "/app"
                ? pathname === item.href
                  ? "page"
                  : undefined
                : pathname.startsWith(item.href)
                  ? "page"
                  : undefined
            }
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <DinnerContext.Provider value={{ api, me, image }}>
        <main className="dinner-main" key={me?.id ?? "signed-out"}>
          {!ready ? (
            <p role="status">Getting Tab ready…</p>
          ) : !authenticated && !publicInvite ? (
            <section className="dinner-welcome">
              <p className="dinner-eyebrow">Bring your people</p>
              <h1>
                Good plans.
                <br />
                One shared tab.
              </h1>
              <p>
                A room for dinner, a weekend away, or whatever comes next. Talk
                it through. Split it fairly. Keep the good company.
              </p>
              <button onClick={() => login({ loginMethods: ["twitter"] })}>
                Start with X <span aria-hidden="true">↗</span>
              </button>
              <p className="dinner-note">
                Free to invite friends. This beta records expenses, not
                payments.
              </p>
            </section>
          ) : error ? (
            <div role="alert" className="dinner-error">
              {error}
              <button onClick={() => window.location.reload()}>
                Try again
              </button>
            </div>
          ) : !me && !publicInvite ? (
            <p role="status">Loading your rooms…</p>
          ) : (
            children
          )}
        </main>
      </DinnerContext.Provider>
      <footer className="dinner-footer">
        Made for your next get-together. <Link href="/">Open legacy Tab</Link>
        <span>No money is held or moved in this beta.</span>
      </footer>
    </div>
  );
}
