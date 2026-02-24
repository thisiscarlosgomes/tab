"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { QRCode } from "react-qrcode-logo";

const DISMISS_KEY = "tab:install-qr-card:dismissed";

export function InstallQrCard() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      const hidden = localStorage.getItem(DISMISS_KEY) === "1";
      setDismissed(hidden);
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  return (
    <aside className="hidden md:block fixed right-4 bottom-4 z-30 w-fit max-w-[220px] rounded-2xl border border-white/10 bg-[#121218]/95 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.35)] p-4">
      <button
        type="button"
        aria-label="Close add to mobile card"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(DISMISS_KEY, "1");
          } catch {}
        }}
        className="absolute top-2 right-2 text-white/50 hover:text-white transition"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex flex-col items-center text-center">
        <p className="text-xs font-medium text-white leading-tight mb-3">
          Open on mobile
        </p>
        <a
          href="https://usetab.app"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-2xl bg-white p-3"
          aria-label="Open usetab.app"
        >
          <QRCode
            value="https://usetab.app"
            size={90}
            ecLevel="M"
            quietZone={2}
            qrStyle="squares"
            eyeRadius={6}
            removeQrCodeBehindLogo
           
            bgColor="#FFFFFF"
            fgColor="#111111"
          />
        </a>
      </div>
    </aside>
  );
}
