"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useExportWallet,
  useModalStatus,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";

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
  const { wallets } = useWallets();
  const { exportWallet } = useExportWallet();
  const { isOpen: isPrivyModalOpen } = useModalStatus();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [isExportingWallet, setIsExportingWallet] = useState(false);
  const [walletExportRequested, setWalletExportRequested] = useState(false);
  const [sawExportModalOpen, setSawExportModalOpen] = useState(false);

  useEffect(() => {
    setNotificationsEnabled(readNotificationsPref());
  }, []);

  const hasLinkedFarcaster = Boolean(
    user?.farcaster ||
    user?.linkedAccounts?.some((account) => account.type === "farcaster")
  );
  const embeddedPrivyWalletAddress = useMemo(
    () =>
      wallets.find(
        (wallet) =>
          wallet.walletClientType === "privy" && typeof wallet.address === "string"
      )?.address ?? null,
    [wallets]
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

  const handleExportWallet = useCallback(async () => {
    if (!embeddedPrivyWalletAddress || isExportingWallet) return;
    setIsExportingWallet(true);
    setWalletExportRequested(true);
    setSawExportModalOpen(false);
    try {
      await exportWallet({ address: embeddedPrivyWalletAddress });
    } catch (error) {
      console.error("Wallet export failed", error);
    } finally {
      setIsExportingWallet(false);
      setWalletExportRequested(false);
      setSawExportModalOpen(false);
    }
  }, [embeddedPrivyWalletAddress, exportWallet, isExportingWallet]);

  useEffect(() => {
    if (!walletExportRequested) return;
    if (isPrivyModalOpen) {
      setSawExportModalOpen(true);
      return;
    }

    if (sawExportModalOpen) {
      setIsExportingWallet(false);
      setWalletExportRequested(false);
      setSawExportModalOpen(false);
    }
  }, [isPrivyModalOpen, sawExportModalOpen, walletExportRequested]);

  useEffect(() => {
    if (!walletExportRequested) return;
    const timeout = window.setTimeout(() => {
      setIsExportingWallet(false);
      setWalletExportRequested(false);
      setSawExportModalOpen(false);
    }, 15000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [walletExportRequested]);

  const rowClass =
    "w-full border-b p-4 flex items-center justify-between gap-3";

  return (
    <div className="min-h-screen w-full p-4 pt-[calc(4.5rem+env(safe-area-inset-top))] pb-[calc(8rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-md space-y-2">
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

        <button
          type="button"
          onClick={() => void handleExportWallet()}
          disabled={!embeddedPrivyWalletAddress || isExportingWallet}
          className={`${rowClass} text-left disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          <div>
            <p className="text-white text-sm font-medium">Export wallet</p>
          </div>
          <span
            className={[
              "text-sm font-medium",
              embeddedPrivyWalletAddress ? "text-green-300" : "text-white/50",
            ].join(" ")}
          >
            {isExportingWallet
              ? "Opening..."
              : embeddedPrivyWalletAddress
                ? "Export"
                : "Unavailable"}
          </span>
        </button>

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

        <div className="py-3">
          <p className="text-sm text-white/30 text-center">Tab tech 2006 version 2.0</p>
        </div>
      </div>
    </div>
  );
}
