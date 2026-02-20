"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeScannerState } from "html5-qrcode";
import { Drawer } from "vaul";
import { SendToUserDrawer } from "@/components/app/SendToUserDrawer";
import { SendToAddressDrawer } from "@/components/app/SendToAddressDrawer";
import { SendToRawAddressDrawer } from "@/components/app/SendToRawAddressDrawer";
import { Image } from "lucide-react";

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

export function QRCodeScannerDrawer({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
}) {
  const videoContainerId = "html5qr-reader";
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const [error, setError] = useState("");
  const [scannedUser, setScannedUser] = useState<FarcasterUser | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [payToAddress, setPayToAddress] = useState<`0x${string}` | null>(null);
  const [showFlexibleDrawer, setShowFlexibleDrawer] = useState(false);

  const [scannedSplit, setScannedSplit] = useState<{
    splitId: string;
    payTo: `0x${string}`;
    amount: string;
    billName?: string;
    token: string; // ✅ Add this line
  } | null>(null);

  const [showSplitDrawer, setShowSplitDrawer] = useState(false);

  const stopScanner = async () => {
    if (!scannerRef.current) return;
    try {
      const state = scannerRef.current.getState();
      if (state === Html5QrcodeScannerState.SCANNING) {
        await scannerRef.current.stop();
      }
      await scannerRef.current.clear();
    } catch (err) {
      console.error("Error stopping scanner:", err);
    }
  };

  const scanSoundRef = useRef<HTMLAudioElement | null>(
    typeof window !== "undefined" ? new Audio("/scanner.mp3") : null
  );

  useEffect(() => {
    if (scanSoundRef.current) {
      scanSoundRef.current.load();
    }
  }, []);

  const handleSuccess = useCallback(
    async (decodedText: string) => {
      console.log("📸 Scanned:", decodedText);

      const sound = scanSoundRef.current;
      if (sound) {
        sound.currentTime = 0;
        sound.play().catch((e) => console.warn("Sound failed", e));
      }

      try {
        const parsedUrl = new URL(decodedText);
        const splitId = parsedUrl.searchParams.get("splitId");
        const payTo = parsedUrl.searchParams.get("payTo");
        const amount = parsedUrl.searchParams.get("amount");

        // ✅ Handle split QR
        if (splitId && payTo && amount) {
          await stopScanner();
          setIsOpen(false);

          const tokenParam = parsedUrl.searchParams.get("token") ?? "ETH";

          // ✅ Fetch the split to get the bill name and token (fallback to scanned param)
          const res = await fetch(`/api/split/${splitId}`);
          const data = await res.json();
          const billName = data?.description ?? "";
          const token = data?.token ?? tokenParam;

          // ✅ Store it in scannedSplit state
          setScannedSplit({
            splitId,
            payTo: payTo as `0x${string}`,
            amount,
            token, // <-- add this
            billName,
          });

          setShowSplitDrawer(true);
          return;
        }

        // ✅ If it's just a pay-to-address with no split
        if (payTo && !splitId && !amount) {
          await stopScanner();
          setIsOpen(false);

          setPayToAddress(payTo as `0x${string}`);
          setShowFlexibleDrawer(true);
          return;
        }

        if (payTo && !splitId && amount) {
          await stopScanner();
          setIsOpen(false);

          // fallback token if missing
          const token = parsedUrl.searchParams.get("token") ?? "ETH";

          setScannedSplit({
            splitId: "", // not relevant here
            payTo: payTo as `0x${string}`,
            amount,
            token,
            billName: undefined,
          });

          setShowSplitDrawer(true);
          return;
        }

        // ✅ Handle Farcaster user QR
        const username = parsedUrl.searchParams.get("username");
        if (!username) {
          setError("Invalid QR code format");
          return;
        }

        await stopScanner();

        const res = await fetch(
          `/api/neynar/user/by-username?username=${username}`
        );
        const data = await res.json();

        if (data?.username && data?.fid) {
          setScannedUser({
            fid: data.fid,
            username: data.username,
            display_name: data.display_name,
            pfp_url: data.pfp_url,
            verified_addresses: data.verified_addresses,
          });

          setSendOpen(true);

          // ✅ slight delay to let drawer mount before closing scanner
          setTimeout(() => {
            setIsOpen(false);
          }, 50);
        } else {
          setError("User not found");
        }
      } catch (err) {
        console.error("Invalid QR Code", err);
        setError("Invalid QR code format");
      }
    },
    [setIsOpen]
  );

  useEffect(() => {
    if (!isOpen) return;

    const initScanner = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (e) {
        console.error("Camera permission denied", e);
        setError("Camera access denied. Please allow camera permissions.");
        return;
      }

      scannerRef.current = new Html5Qrcode(videoContainerId);
      try {
        await scannerRef.current.start(
          { facingMode: "environment" },
          {
            fps: 10,
            disableFlip: true,
            aspectRatio: 1.0,
          },
          handleSuccess,
          (err) => console.debug("Scan error", err)
        );
      } catch (e) {
        console.error("Camera error", e);
        setError("Unable to access camera");
      }
    };

    initScanner();

    return () => {
      stopScanner();
    };
  }, [isOpen, handleSuccess]);

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const scanner = new Html5Qrcode("upload-reader");
      const result = await scanner.scanFile(file, true);
      console.log("📸 Uploaded scan:", result);
      await handleSuccess(result);
      await scanner.clear();
    } catch (err) {
      console.error("Failed to scan image", err);
      setError("Could not scan QR code from image.");
    }
  };

  return (
    <>
      <div id="upload-reader" style={{ display: "none" }} />
      <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-20" />
          <Drawer.Content className="p-4 z-30 fixed inset-0 bg-background flex flex-col items-center">
            <div
              aria-hidden
              className="absolute top-6 mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-1"
            />
            <h2 className="text-white text-lg font-medium mb-4"></h2>

            <div className="relative w-full flex-1 mt-8 mb-4">
              <div
                id={videoContainerId}
                className="rounded-xl overflow-hidden w-full h-full bg-black"
              />
              <div className="mx-4 my-20 absolute inset-0 pointer-events-none z-10">
                <div
                  className="animate-scan-line absolute top-6 left-0 bottom-8 w-full h-0.5 
                       bg-primary opacity-90 rounded-full 
                       shadow-[0_-8px_12px_2px_rgba(139,92,246,0.6)]"
                />
              </div>

              <div className="absolute bottom-6 left-0 right-0 flex justify-between px-6 z-20">
                {/* Upload Button (Left) */}
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadImage}
                    id="qr-image-upload"
                    className="hidden"
                  />
                  <button
                    onClick={() =>
                      document.getElementById("qr-image-upload")?.click()
                    }
                    className="bg-white/20 text-white text-sm px-5 py-3 rounded-full hover:bg-white/20 transition"
                  >
                    <Image className="w-5 h-5" />
                  </button>
                </div>

                {/* Close Button (Center) */}
                <div className="absolute left-1/2 -translate-x-1/2">
                  <button
                    onClick={() => setIsOpen(false)}
                    className="bg-white/20 text-white text-sm px-6 py-3 rounded-full hover:bg-white/20 transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
            <div className="mb-2 text-center">
              <p className="text-white text-sm mb-1 mt-4">Scan with Tab</p>
              <p className="text-white text-sm opacity-60">
                or upload QR image from photos
              </p>
            </div>
            {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {scannedUser && (
        <SendToUserDrawer
          user={scannedUser}
          isOpen={sendOpen}
          onOpenChange={(v) => {
            setSendOpen(v);
            if (!v) setScannedUser(null);
          }}
        />
      )}

      {scannedSplit && (
        <SendToAddressDrawer
          isOpen={showSplitDrawer}
          onOpenChange={(v) => {
            setShowSplitDrawer(v);
            if (!v) setScannedSplit(null);
          }}
          address={scannedSplit.payTo}
          amount={parseFloat(scannedSplit.amount)}
          token={scannedSplit.token}
          splitId={scannedSplit.splitId}
          billName={scannedSplit.billName}
        />
      )}

      {payToAddress && (
        <SendToRawAddressDrawer
          isOpen={showFlexibleDrawer}
          onOpenChange={(v) => {
            setShowFlexibleDrawer(v);
            if (!v) setPayToAddress(null);
          }}
          address={payToAddress}
        />
      )}
    </>
  );
}
