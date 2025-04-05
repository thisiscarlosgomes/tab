// src/components/QRCodeScanner.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

type FarcasterUser = {
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  verified_addresses?: {
    primary?: {
      eth_address?: string | null;
    };
  };
};

type Props = {
  onValidUser: (user: FarcasterUser) => void;
};

export default function QRCodeScanner({ onValidUser }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = "qr-scanner";
  const [error, setError] = useState("");

  const stopScanner = useCallback(async () => {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      }
    } catch (err) {
      console.error("Failed to stop/clear scanner:", err);
    }
  }, []);

  useEffect(() => {
    const startScanner = async () => {
      try {
        scannerRef.current = new Html5Qrcode(containerId);

        await scannerRef.current.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          async (decodedText) => {
            try {
              const url = new URL(decodedText);
              const username = url.searchParams.get("username");
              if (!username) {
                setError("No username in QR code");
                return;
              }

              const res = await fetch(
                `/api/neynar/user/by-username?username=${username}`
              );
              const data = await res.json();

              if (data?.username && data?.fid) {
                await stopScanner();
                onValidUser({
                  fid: data.fid,
                  username: data.username,
                  display_name: data.display_name,
                  pfp_url: data.pfp_url,
                  verified_addresses: data.verified_addresses,
                });
              } else {
                setError("User not found");
              }
            } catch (err) {
              console.error("Failed to decode QR:", err);
              setError("Invalid QR code");
            }
          },
          (scanError) => {
            console.debug("Scan error", scanError);
          }
        );
      } catch (err) {
        console.error("Failed to start camera:", err);
        setError("Unable to access camera");
      }
    };

    startScanner();

    return () => {
      stopScanner();
    };
  }, [onValidUser, stopScanner]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-4">
      <div
        id={containerId}
        className="w-full max-w-xs aspect-square rounded-lg bg-black overflow-hidden"
      />
      {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
    </div>
  );
}
