"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeScannerState } from "html5-qrcode";
import { Drawer } from "vaul";
import { SendToUserDrawer } from "@/components/app/SendToUserDrawer";
import { SendToAddressDrawer } from "@/components/app/SendToAddressDrawer";
import { SendToRawAddressDrawer } from "@/components/app/SendToRawAddressDrawer";

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
    billName?: string; // ✅ allow billName
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

  const handleSuccess = useCallback(
    async (decodedText: string) => {
      console.log("📸 Scanned:", decodedText);

      try {
        const parsedUrl = new URL(decodedText);
        const splitId = parsedUrl.searchParams.get("splitId");
        const payTo = parsedUrl.searchParams.get("payTo");
        const amount = parsedUrl.searchParams.get("amount");






        // ✅ Handle split QR
        if (splitId && payTo && amount) {
          await stopScanner();
          setIsOpen(false);

          // ✅ Fetch the split to get the bill name
          const res = await fetch(`/api/split/${splitId}`);
          const data = await res.json();
          const billName = data?.description ?? "";

          // ✅ Store it in scannedSplit state
          setScannedSplit({
            splitId,
            payTo: payTo as `0x${string}`,
            amount,
            billName, // ✅ added
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

  return (
    <>
      <Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20" />
          <Drawer.Content className="p-4 z-30 fixed inset-0 bg-background flex flex-col items-center">
            <div
              aria-hidden
              className="absolute top-6 mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-1"
            />
            <h2 className="text-white text-lg font-medium mb-4"></h2>

            <div className="relative w-full flex-1 mt-4">
              <div
                id={videoContainerId}
                className="rounded-xl overflow-hidden w-full h-full bg-black"
              />
              <div className="mx-4 my-8 absolute inset-0 pointer-events-none z-10">
                <div
                  className="animate-scan-line absolute top-0 left-0 w-full h-0.5 
                       bg-primary opacity-90 rounded-full 
                       shadow-[0_-8px_12px_2px_rgba(139,92,246,0.6)]"
                />
              </div>

              <div className="absolute bottom-6 left-0 right-0 flex justify-center z-20">
                <button
                  onClick={() => setIsOpen(false)}
                  className="bg-white/20 text-white text-sm px-6 py-3 rounded-full hover:bg-white/20 transition"
                >
                  Close
                </button>
              </div>
            </div>

            <p className="text-white text-base mb-6 mt-4">Scan with Tab</p>
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

      {/* {scannedSplit && (
        <SendToAddressDrawer
          isOpen={showSplitDrawer}
          onOpenChange={(v) => {
            setShowSplitDrawer(v);
            if (!v) setScannedSplit(null);
          }}
          address={scannedSplit.payTo}
          amount={parseFloat(scannedSplit.amount)}
          splitId={scannedSplit.splitId}
          billName={scannedSplit.billName} // ✅ pass it
        />
      )} */}

{scannedSplit && (
  <SendToAddressDrawer
    isOpen={showSplitDrawer}
    onOpenChange={(v) => {
      setShowSplitDrawer(v);
      if (!v) setScannedSplit(null);
    }}
    address={scannedSplit.payTo}
    amount={parseFloat(scannedSplit.amount)}
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
