"use client";
import { AccountAvatar } from "./AccountAvatar";
import Link from "next/link";
import {
  ChevronRight,
  Moon,
  MessageCircle,
  Users,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";
import { useDinner } from "./DinnerShell";

export function Settings() {
  const { me, account } = useDinner();
  if (!me) return null;
  return (
    <div className="dinner-settings">
      <h1>Settings</h1>
      <div className="dinner-settings-group">
        <div className="dinner-setting-row">
          <AccountAvatar src={account?.avatarUrl} />
          <div className="dinner-grow">
            {me.name}
            <small>{account?.test ? "Local test identity" : "Signed in with your connected X account"}</small>
          </div>
        </div>
      </div>
      <div className="dinner-settings-group">
        <Link className="dinner-setting-row" href="/app/settings/agent">
          <MessageCircle size={23} aria-hidden="true" />
          <div className="dinner-grow">
            Personal assistant
            <small>Agent settings and saved preferences</small>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
        <Link className="dinner-setting-row" href="/app/rooms">
          <Users size={23} aria-hidden="true" />
          <div className="dinner-grow">
            Your rooms<small>People, shared plans and expenses</small>
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </div>
      <div className="dinner-settings-group">
        <div className="dinner-setting-row">
          <Moon size={23} aria-hidden="true" />
          <span>Appearance</span>
          <span className="dinner-setting-value">Dark</span>
        </div>
      </div>
      <div className="dinner-settings-group">
        <details>
          <summary className="dinner-setting-row">
            <ShieldCheck size={23} aria-hidden="true" />
            <span className="dinner-grow">Privacy and room records</span>
            <ChevronRight size={20} aria-hidden="true" />
          </summary>
          <div className="dinner-settings-detail">
            <p className="dinner-note">
              Room conversations are shared with accepted members. Removing a
              member ends their room access while preserving expense history and
              obligations.
            </p>
            <p className="dinner-note">
              Tab responds only when addressed. Shared room context may be
              processed by the configured model provider; receipt requests use
              the existing receipt parser. Personal assistant preferences stay
              private.
            </p>
            <p className="dinner-note">
              Rooms records who owes whom. No money is held or moved, and
              receipt extraction never confirms a payment.
            </p>
          </div>
        </details>
      </div>
      <div className="dinner-settings-group">
        <Link className="dinner-setting-row" href="/">
          <span className="dinner-grow">Open legacy Tab</span>
          <ArrowUpRight size={20} aria-hidden="true" />
        </Link>
      </div>
      <button className="dinner-signout" onClick={() => void account?.logout()}>
        Sign out
      </button>
    </div>
  );
}
