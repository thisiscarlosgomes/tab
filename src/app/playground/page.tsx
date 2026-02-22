"use client";

import { useEffect, useState } from "react";
import sdk from "@farcaster/frame-sdk";
import { Loader } from "lucide-react";

export default function HapticsPlaygroundPage() {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const checkSupport = async () => {
      try {
        const context = await sdk.context;

        const hasHaptics =
          typeof sdk?.haptics?.impactOccurred === "function" &&
          typeof sdk?.haptics?.notificationOccurred === "function" &&
          typeof sdk?.haptics?.selectionChanged === "function";

        setSupported(hasHaptics);
      } catch (e) {
        console.error("Haptic check failed:", e);
        setSupported(false);
      }
    };

    checkSupport();
  }, []);

  if (supported === null) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-white/40">
        <Loader className="w-6 h-6 animate-spin" />
        <p className="mt-2 text-sm">Checking haptic support…</p>
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-white/40 text-center px-4">
        <p className="text-sm">
          Haptics are only supported inside the Farcaster app. <br />
          Try this page from a mobile cast.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-6 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(8rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-white text-center">
          Haptics Playground
        </h1>

        <div className="space-y-4">
          {/* Impact buttons */}
          <div>
            <h2 className="text-white font-medium mb-2">Impact</h2>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => sdk.haptics.impactOccurred("light")}
                className="bg-white/10 text-white px-4 py-2 rounded-md text-sm hover:bg-white/20 transition"
              >
                light
              </button>
              <button
                onClick={() => sdk.haptics.impactOccurred("medium")}
                className="bg-white/10 text-white px-4 py-2 rounded-md text-sm hover:bg-white/20 transition"
              >
                medium
              </button>
              <button
                onClick={() => sdk.haptics.impactOccurred("heavy")}
                className="bg-white/10 text-white px-4 py-2 rounded-md text-sm hover:bg-white/20 transition"
              >
                heavy
              </button>
              <button
                onClick={() => sdk.haptics.impactOccurred("soft")}
                className="bg-white/10 text-white px-4 py-2 rounded-md text-sm hover:bg-white/20 transition"
              >
                soft
              </button>
              <button
                onClick={() => sdk.haptics.impactOccurred("rigid")}
                className="bg-white/10 text-white px-4 py-2 rounded-md text-sm hover:bg-white/20 transition"
              >
                rigid
              </button>
            </div>
          </div>

          {/* Notification buttons */}
          <div>
            <h2 className="text-white font-medium mb-2">Notification</h2>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => sdk.haptics.notificationOccurred("success")}
                className="bg-green-600/20 text-white px-4 py-2 rounded-md text-sm hover:bg-green-600/30 transition"
              >
                success
              </button>
              <button
                onClick={() => sdk.haptics.notificationOccurred("warning")}
                className="bg-yellow-500/20 text-white px-4 py-2 rounded-md text-sm hover:bg-yellow-500/30 transition"
              >
                warning
              </button>
              <button
                onClick={() => sdk.haptics.notificationOccurred("error")}
                className="bg-red-600/20 text-white px-4 py-2 rounded-md text-sm hover:bg-red-600/30 transition"
              >
                error
              </button>
            </div>
          </div>

          {/* Selection button */}
          <div>
            <h2 className="text-white font-medium mb-2">Selection</h2>
            <button
              onClick={() => sdk.haptics.selectionChanged()}
              className="bg-white/10 text-white px-4 py-2 rounded-md text-sm hover:bg-white/20 transition w-full"
            >
              selectionChanged
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
