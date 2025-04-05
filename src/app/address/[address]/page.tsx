"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { QRCode } from "react-qrcode-logo";
import { Loader } from "lucide-react";
import { shortAddress } from "@/lib/shortAddress";
import { SendToAddressDrawer } from "@/components/app/SendToAddressDrawer";

export default function ReceiveByAddressPage() {
  const { address } = useParams();
  const [valid, setValid] = useState(false);
  const [pfpUrl, setPfpUrl] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!address || typeof address !== "string") return;
    const isValid = /^0x[a-fA-F0-9]{40}$/.test(address);
    setValid(isValid);
  }, [address]);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!address || typeof address !== "string") return;

      try {
        const res = await fetch(`/api/neynar/user/by-address/${address}`);
        const data = await res.json();
        if (data?.username) {
          setUsername(data.username);
          setPfpUrl(data.pfp_url || null);
        }
      } catch {
        setUsername(null);
        setPfpUrl(null);
      }
    };

    fetchProfile();
  }, [address]);

  const url = `${window.location.origin}/r?payTo=${address}`;


  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-6 pt-20 pb-32 overflow-y-auto hide-scrollbar">
      <h1 className="text-xl font-medium mb-4 text-center">Request ETH</h1>

      {valid ? (
       <div className="w-full bg-card rounded-3xl p-4 py-8 flex flex-col items-center">
          <div className="p-2 bg-white rounded-xl mb-4">
            <QRCode
              value={url}
              size={200}
              logoImage={pfpUrl || "/splash.png"}
              logoWidth={32}
              logoHeight={32}
              logoOpacity={1}
              removeQrCodeBehindLogo={true}
            />
            <div className="font-medium p-4 text-center bg-primary text-black rounded-2xl w-full hover:opacity-80 transition-all">
              Scan using tab
            </div>
          </div>

          {username && (
            <a
              href={`https://warpcast.com/${username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-primary text-center text-lg"
            >
              @{username}
            </a>
          )}

          <p className="lowercase text-lg font-medium text-center">
            {shortAddress(address as string)}
          </p>
        </div>
      ) : (
        <Loader className="animate-spin opacity-30 mt-20" />
      )}

      <SendToAddressDrawer
        isOpen={drawerOpen}
        onOpenChange={setDrawerOpen}
        address={address as `0x${string}`}
        amount={0.01} // default, could be user-editable
      />

      <div className="text-center fixed bottom-0 inset-x-0 p-2 pb-6 flex justify-around z-1">
        <a
          href={`https://warpcast.com/~/channel/tab`}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-white text-center text-sm"
        >
          2025 ©tab
          <br />
          Social payments on Farcaster
        </a>
      </div>
    </div>
  );
}
