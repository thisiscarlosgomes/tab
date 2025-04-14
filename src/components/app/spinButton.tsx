"use client";

import { Button } from "@/components/ui/button";
import React, { useState, useEffect } from "react";
import { LoaderPinwheel } from "lucide-react";

interface Player {
  name: string;
  address: string;
  pfp?: string;
}

interface SpinButtonProps {
  participants: Player[];
  roomId: string;
  onPick: () => void;
  userAddress: string | undefined;
  canSpin?: boolean;
  adminOnly?: boolean;
  isAdmin?: boolean;
}

const SPIN_COOLDOWN = 60 * 1000; // 1 minute

export function SpinButton({
  participants,
  roomId,
  onPick,
  userAddress,
  canSpin = true,
  adminOnly = false,
  isAdmin = false,
}: SpinButtonProps) {
  const [isSpinning, setIsSpinning] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const localStorageKey = `lastSpinTime-${roomId}`;

  // ⏱️ Load previous spin timestamp
  useEffect(() => {
    const lastSpin = localStorage.getItem(localStorageKey);
    if (lastSpin) {
      const diff = Date.now() - parseInt(lastSpin, 10);
      if (diff < SPIN_COOLDOWN) {
        setCooldown(SPIN_COOLDOWN - diff);
      }
    }
  }, [roomId]);

  // ⏳ Decrease countdown every second
  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1000) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldown]);

  const handleSpin = async () => {
    if (!roomId) return;
    setIsSpinning(true);

    try {
      const res = await fetch(`/api/game/${roomId}`, {
        method: "PUT",
      });

      const data = await res.json();

      // Save timestamp
      localStorage.setItem(localStorageKey, Date.now().toString());
      setCooldown(SPIN_COOLDOWN);

      // Record recent spin
      const currentUser = userAddress || "unknown";
      // const picked = data?.chosen?.name || "someone";

      const picked = data?.chosen;

      if (picked?.address && picked?.name && picked?.fid) {
        try {
          const cleanRoomName = roomId.replace(/_/g, " "); // or decodeURIComponent(roomId)
          await fetch("/api/send-notif", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fid: picked.fid,
              amount: 0,
              token: "ETH",
              senderUsername: "usetab",
              title: "🎲 You've been picked",
              message: `You've been picked to pay in table ${cleanRoomName}`,
              targetUrl: `https://tab.castfriends.com/game/${encodeURIComponent(roomId)}`,
            }),
          });
        } catch (err) {
          console.warn("Notification failed:", err);
        }
      }

      const spinRecord = {
        by: currentUser,
        picked,
        timestamp: Date.now(),
      };

      const key = `recent-spins-${roomId}`;
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      const updated = [spinRecord, ...existing].slice(0, 5);
      localStorage.setItem(key, JSON.stringify(updated));

      onPick();
    } catch {
      // fail silently
    } finally {
      setIsSpinning(false);
    }
  };

  const disabledForSetup = !canSpin;
  const disabledForCooldown = cooldown > 0;
  const disabledForAdminOnly = adminOnly && !isAdmin;

  const fullyDisabled =
    participants.length === 0 ||
    isSpinning ||
    disabledForCooldown ||
    disabledForSetup ||
    disabledForAdminOnly;

  return (
    <div className="w-full mt-3">
      <Button
        onClick={handleSpin}
        disabled={fullyDisabled}
        className="w-full flex items-center justify-center gap-2"
      >
        {isSpinning ? (
          <>
            <LoaderPinwheel className="w-6 h-6 animate-spin text-black" />
            Spinning...
          </>
        ) : disabledForCooldown ? (
          `Spin again in ${Math.ceil(cooldown / 1000)}s`
        ) : (
          "Spin 🎲"
        )}
      </Button>

      {disabledForAdminOnly && !disabledForCooldown && (
        <p className="text-sm text-muted text-center">Only admin can spin.</p>
      )}
    </div>
  );
}