"use client";

import { Button } from "@/components/ui/button";
import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import clsx from "clsx";

interface Player {
  name: string;
  address: string;
  pfp?: string;
  fid?: number;
}

interface SpinButtonProps {
  participants: Player[];
  roomId: string;
  onPick: () => void;
  onSpinStart: () => void;
  userAddress?: string;
  canSpin?: boolean;
  adminOnly?: boolean;
  isAdmin?: boolean;
  isSpinning: boolean;
  className?: string; // ✅ NEW
}

const SPIN_COOLDOWN = 60 * 1000; // 1 minute

export function SpinButton({
  participants,
  roomId,
  onPick,
  onSpinStart,
  userAddress,
  canSpin = true,
  adminOnly = false,
  isAdmin = false,
  isSpinning,
  className,
}: SpinButtonProps) {
  const [cooldown, setCooldown] = useState(0);
  const localStorageKey = `lastSpinTime-${roomId}`;

  /* ----------------------------------
     Load previous cooldown
  ---------------------------------- */
  useEffect(() => {
    const lastSpin = localStorage.getItem(localStorageKey);
    if (!lastSpin) return;

    const diff = Date.now() - Number(lastSpin);
    if (diff < SPIN_COOLDOWN) {
      setCooldown(SPIN_COOLDOWN - diff);
    }
  }, [roomId]);

  /* ----------------------------------
     Cooldown ticker
  ---------------------------------- */
  useEffect(() => {
    if (cooldown <= 0) return;

    const interval = setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldown]);

  /* ----------------------------------
     Spin handler
  ---------------------------------- */
  const handleSpin = async () => {
    if (!roomId) return;

    onSpinStart();

    try {
      const res = await fetch(`/api/game/${roomId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: userAddress }),
      });

      if (!res.ok) throw new Error("Spin failed");

      const data = await res.json();
      const picked = data?.chosen;

      if (!picked?.address || !picked?.name) {
        throw new Error("Invalid spin result");
      }

      localStorage.setItem(localStorageKey, Date.now().toString());
      setCooldown(SPIN_COOLDOWN);

      if (picked.fid) {
        try {
          await fetch("/api/send-notif", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fid: picked.fid,
              title: "Spin to pay",
              message: "You got the tab for this group",
              targetUrl: `https://usetab.app/game/${encodeURIComponent(roomId)}`,
            }),
          });
        } catch {
          console.warn("Failed to notify selected user");
        }
      }

      onPick();
    } catch (err) {
      console.error(err);
      toast.error("Could not spin. Try again.");
    }
  };

  /* ----------------------------------
     Disabled logic
  ---------------------------------- */
  const fullyDisabled =
    participants.length === 0 ||
    isSpinning ||
    cooldown > 0 ||
    !canSpin ||
    (adminOnly && !isAdmin);

  /* ----------------------------------
     Render
  ---------------------------------- */
  return canSpin ? (
    <Button
      onClick={handleSpin}
      disabled={fullyDisabled}
      className={clsx(
        "w-full h-[44px] flex items-center justify-center",
        className
      )}
    >
      {isSpinning ? "Spinning…" : "Spin"}
    </Button>
  ) : (
    <Button
      disabled
      className={clsx(
        "bg-white/70 w-full h-[44px] flex items-center justify-center opacity-60 cursor-not-allowed",
        className
      )}
    >
      🎉 Tab assigned
    </Button>
  );
}
