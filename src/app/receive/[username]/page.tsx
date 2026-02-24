"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { QRCode } from "react-qrcode-logo";
import { Loader, QrCode } from "lucide-react";
import { shortAddress } from "@/lib/shortAddress";

export default function ReceivePage() {
  const { username } = useParams();
  const [valid, setValid] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [pfpUrl, setPfpUrl] = useState<string | null>(null);

  useEffect(() => {
    if (username) {
      setValid(true); // optional initial flag
    }
  }, [username]);

  useEffect(() => {
    const fetchAddress = async () => {
      if (!username) return;

      try {
        const res = await fetch(
          `/api/neynar/user/by-username?username=${username}`
        );
        const data = await res.json();
        const eth = data?.verified_addresses?.primary?.eth_address ?? null;
        const pfp = data?.pfp_url ?? null;
        setAddress(eth);
        setPfpUrl(pfp);
        setValid(!!eth);
      } catch {
        setValid(false);
      }
    };

    fetchAddress();
  }, [username]);

  const url =
    typeof window !== "undefined" && username
      ? `${window.location.origin}/receive?username=${username}`
      : "";

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-6 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(8rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
      <h1 className="text-xl font-medium mb-4 text-center">Request ETH</h1>

      {valid ? (
        <div className="w-full bg-card rounded-3xl p-4 py-8 flex flex-col items-center">
          {/* <p className="text-lg text-center max-w-xs mb-3">
            Scan this QR using Tab
          </p> */}
          {/* <div className="p-2 bg-white rounded-xl mb-2">
            <QRCode
              value={url}
              size={200}
              logoImage={pfpUrl || "/newnewnewapp.png"}
              logoWidth={32}
              logoHeight={32}
              logoOpacity={1}
              removeQrCodeBehindLogo={true}
            />
          </div> */}

          <div className="p-2 bg-white rounded-xl mb-4">
            <QRCode
              value={url}
              size={200}
              logoImage={pfpUrl || "/newnewnewapp.png"}
              logoWidth={32}
              logoHeight={32}
              logoOpacity={1}
              removeQrCodeBehindLogo={true}
            />
            <div className="hidden flex items-center justify-center font-medium p-4 text-black rounded-2xl w-full bg-primary hover:opacity-80 transition-all">
              <QrCode className="w-5 h-5 mr-2" />
              Scan using Tab
            </div>
          </div>

          <a
            href={`https://warpcast.com/${username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-primary text-center text-lg"
          >
            @{username}
          </a>

          {/* <p className="text-xl text-primary font-medium text-center max-w-xs">
            @{username}
          </p> */}
          <p className="text-lg font-medium text-center">
            {address ? shortAddress(address) : "Loading address..."}
          </p>
        </div>
      ) : (
        <Loader className="animate-spin opacity-30" />
      )}

      <div className="text-center fixed bottom-0 inset-x-0 p-2 pb-6 flex justify-around z-1">
        <a
          href={`https://warpcast.com/~/channel/tab`}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-white text-center text-sm"
        >
          2025 ©tab
          <br />
          Social payments on Base and Farcaster
        </a>
      </div>
    </div>
  );
}
