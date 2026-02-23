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
    <aside className="hidden md:block fixed right-4 bottom-4 z-30 w-[380px] rounded-2xl border border-white/10 bg-[#121218]/95 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.35)] p-3">
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

      <div className="flex items-center gap-3">
        <a
          href="https://usetab.app"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-xl bg-white p-2"
          aria-label="Open usetab.app"
        >
          <QRCode
            value="https://usetab.app"
            size={84}
            ecLevel="M"
            quietZone={4}
            qrStyle="squares"
            eyeRadius={6}
            removeQrCodeBehindLogo
            logoImage="/newnewapp.png"
            logoWidth={16}
            logoHeight={16}
            logoOpacity={1}
            bgColor="#FFFFFF"
            fgColor="#111111"
          />
        </a>

        <div className="min-w-0 flex-1 pr-5">
          <p className="text-sm font-medium text-white leading-tight">Add to mobile</p>
          <p className="text-xs text-white/50 mt-1 leading-tight">
            Scan this QR code to open Tab on your phone.
          </p>
          <a
            href="https://usetab.app"
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-2 text-[12px] text-primary hover:text-white transition"
          >
            usetab.app
          </a>
        </div>
      </div>
    </aside>
  );
}
