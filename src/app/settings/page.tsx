"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

const SETTINGS_NOTIFICATIONS_KEY = "tab:settings:notifications-enabled";

function readNotificationsPref() {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(SETTINGS_NOTIFICATIONS_KEY);
  if (raw === null) return true;
  return raw === "1";
}

export default function SettingsPage() {
  const router = useRouter();
  const { logout, ready, authenticated, user } = usePrivy();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setNotificationsEnabled(readNotificationsPref());
  }, []);

  const hasLinkedFarcaster = Boolean(
    user?.farcaster ||
    user?.linkedAccounts?.some((account) => account.type === "farcaster")
  );

  const toggleNotifications = useCallback(() => {
    setNotificationsEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SETTINGS_NOTIFICATIONS_KEY, next ? "1" : "0");
      } catch { }
      return next;
    });
  }, []);

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
      console.error("Settings logout failed", error);
    } finally {
      setLoggingOut(false);
    }
  }, [authenticated, loggingOut, logout, ready, router]);

  const rowClass =
    "w-full border-b p-4 flex items-center justify-between gap-3";

  return (
    <div className="min-h-screen w-full p-4 pt-[calc(4.5rem+env(safe-area-inset-top))] pb-[calc(8rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-md space-y-2">
      
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          className={`${rowClass} text-left disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          <div>
            <p className="text-white text-sm font-medium">Log out</p>
          </div>
         
        </button>

        <div className={rowClass}>
          <div>
            <p className="text-white text-sm font-medium">Enable notifications</p>

          </div>
          <button
            type="button"
            onClick={toggleNotifications}
            aria-pressed={notificationsEnabled}
            className={[
              "relative inline-flex h-7 w-12 items-center rounded-lg transition",
              notificationsEnabled ? "bg-green-500/80" : "bg-white/5",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-5 w-5 transform rounded-lg bg-white transition",
                notificationsEnabled ? "translate-x-6" : "translate-x-1",
              ].join(" ")}
            />
          </button>
        </div>

        <div className={rowClass}>
          <div>
            <p className="text-white text-sm font-medium">Linked to Farcaster</p>

          </div>
          <span
            className={[
              "text-sm font-medium",
              hasLinkedFarcaster ? "text-green-300" : "text-white/50",
            ].join(" ")}
          >
            {hasLinkedFarcaster ? "Yes" : "No"}
          </span>
        </div>

        <div className="py-3">
          <p className="text-sm text-white/30 text-center">Tab tech 2006 version 2.0</p>
        </div>
      </div>
    </div>
  );
}
