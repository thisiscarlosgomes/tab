"use client";
import { AccountAvatar } from "./AccountAvatar";
import Link from "next/link";
import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  House,
  Users,
  Wallet,
  Clock3,
  MessageCircle,
  Menu,
  X,
} from "lucide-react";

const navigation = [
  { href: "/app", label: "Today", icon: House },
  { href: "/app/rooms", label: "Rooms", icon: Users },
  { href: "/app/agent", label: "Ask Tab", icon: MessageCircle },
  { href: "/app/wallet", label: "Wallet", icon: Wallet },
  { href: "/app/activity", label: "Activity", icon: Clock3 },
];
export function DinnerFrame({
  pathname,
  landing = false,
  name,
  avatarUrl,
  children,
}: {
  pathname: string;
  landing?: boolean;
  name: string;
  avatarUrl?: string | null;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  useEffect(() => {
    workspace.current?.toggleAttribute("inert", menuOpen);
    if (menuOpen)
      sidebar.current?.querySelector<HTMLAnchorElement>("nav a")?.focus();
  }, [menuOpen]);
  useEffect(() => {
    const resize = () => {
      if (window.innerWidth > 720) setMenuOpen(false);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  if (landing) return (
    <div className="dinner-app dinner-landing">
      <header className="dinner-landing-header">
        <Link href="/app" className="dinner-wordmark" aria-label="Tab home">tab</Link>
      </header>
      <main id="tab-content" className="dinner-landing-main">{children}</main>
      <footer className="dinner-landing-footer">
        <span>© {new Date().getFullYear()} Tab.</span>
        <a href="https://x.com/usetabapp" target="_blank" rel="noopener noreferrer">@usetabapp</a>
      </footer>
    </div>
  );
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          setMenuOpen(false);
          menuButton.current?.focus();
        }
      }}
      className={`dinner-app${/^\/app\/rooms\/[^/]+$/.test(pathname) || pathname === "/app/agent" ? " dinner-full-page" : ""}`}
    >
      <a href="#tab-content" className="dinner-skip">
        Skip to content
      </a>
      <header className="dinner-mobile-header">
        <Link href="/app" className="dinner-wordmark">
          tab
        </Link>
        <button
          className="dinner-quiet"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          ref={menuButton}
          aria-controls="tab-sidebar"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>
      {menuOpen && (
        <button
          className="dinner-menu-backdrop"
          aria-label="Dismiss navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        ref={sidebar}
        id="tab-sidebar"
        className={`dinner-sidebar${menuOpen ? " is-open" : ""}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") setMenuOpen(false);
        }}
      >
        <Link
          className="dinner-wordmark"
          href="/app"
          aria-label="Tab home"
          onClick={() => setMenuOpen(false)}
        >
          tab
        </Link>
        <nav className="dinner-nav" aria-label="Main navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={
                (
                  href === "/app"
                    ? pathname === href
                    : pathname.startsWith(href)
                )
                  ? "page"
                  : undefined
              }
              onClick={() => setMenuOpen(false)}
            >
              <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <Link
          className="dinner-profile-link"
          href="/app/settings"
          aria-label={`${name} — account settings`}
          title={name}
          aria-current={pathname === "/app/settings" ? "page" : undefined}
          onClick={() => setMenuOpen(false)}
        >
          <AccountAvatar src={avatarUrl} />
          <span>{name}</span>
        </Link>
      </aside>
      <div className="dinner-workspace" ref={workspace}>
        <main id="tab-content" className="dinner-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
