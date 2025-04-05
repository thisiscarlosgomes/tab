"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createPublicClient, http, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { QRCode } from "react-qrcode-logo";
import { Loader, QrCode } from "lucide-react";
import Image from "next/image";
import { shortAddress } from "@/lib/shortAddress";
import Link from "next/link";
import Tilt from "react-parallax-tilt";

export default function ReceivePageClient() {
  const { slug } = useParams();
  const [address, setAddress] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [pfpUrl, setPfpUrl] = useState<string | null>(null);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    if (!slug || typeof slug !== "string") return;

    const resolve = async () => {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(),
      });

      if (isAddress(slug)) {
        setAddress(slug);
        try {
          const res = await fetch(`/api/neynar/user/by-address/${slug}`);
          const data = await res.json();
          if (data?.username) {
            setUsername(data.username);
            setPfpUrl(data.pfp_url || null);
          }
        } catch {}
        setValid(true);
        return;
      }

      try {
        const res = await fetch(
          `/api/neynar/user/by-username?username=${slug}`
        );
        const data = await res.json();
        const eth = data?.verified_addresses?.primary?.eth_address ?? null;
        if (eth && isAddress(eth)) {
          setAddress(eth);
          setUsername(data.username);
          setPfpUrl(data.pfp_url || null);
          setValid(true);
          return;
        }
      } catch {}

      try {
        const ensAddress = await client.getEnsAddress({
          name: normalize(slug),
        });
        if (ensAddress && isAddress(ensAddress)) {
          setAddress(ensAddress);
          setUsername(slug);
          setValid(true);
          return;
        }
      } catch {}

      setValid(false);
    };

    resolve();
  }, [slug]);

  const url =
    typeof window !== "undefined" && address
      ? `${window.location.origin}/r?payTo=${address}`
      : "";

  return (
    <div className="min-h-screen w-full max-w-sm mx-auto flex flex-col items-center justify-center p-6 pb-32 pt-12 relative">
      <h1 className="text-lg font-medium mb-4 mt-4 pt-2 text-center">
        Request ETH
      </h1>

      {valid && address ? (
        <div className="w-full bg-card rounded-3xl p-4 py-8 flex flex-col items-center">
          <Tilt
            glareEnable={true}
            glareMaxOpacity={0.8}
            glareColor="#ffffff"
            glarePosition="all"
            glareBorderRadius="16px" // same as your Tailwind rounded-xl
            scale={1.03}
            tiltMaxAngleX={8}
            tiltMaxAngleY={8}
            className="p-2 bg-white rounded-xl mb-4"
          >
            <div>
              <QRCode
                value={url}
                size={200}
                logoImage={pfpUrl || "/splash.png"}
                logoWidth={40}
                logoHeight={40}
                logoOpacity={1}
                removeQrCodeBehindLogo={true}
              />
              <a
                href="https://warpcast.com/~/frames/launch?domain=tab.castfriends.com"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full"
              >
                <div className="flex items-center justify-center font-medium p-4 text-black rounded-2xl w-full bg-primary active:transform active:scale-90 transition-all">
                  <QrCode className="w-5 h-5 mr-2" />
                  Scan using Tab
                </div>
              </a>
            </div>
          </Tilt>

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

          <p className="text-lg font-medium text-center lowercase">
            {shortAddress(address)}
          </p>
          <p className="opacity-30 text-xs mt-2 text-center">
            Send this to a friend, hey can scan and pay you instantly with Tab
            mini app on Farcaster.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center w-full">
          <Loader className="animate-spin opacity-30 w-8 h-8" />
        </div>
      )}

      <div className="bg-background text-center fixed top-0 inset-x-0 pt-4 pb-6 flex justify-around z-1">
        <Link
          href="/"
          className="active:transform active:scale-90 transition-all"
        >
          <Image
            src="/splash.png"
            alt="logo"
            width={40}
            height={40}
            className="object-cover animate-pulse"
            priority
          />
        </Link>
      </div>

      {/* <div className="text-center fixed bottom-0 inset-x-0 p-2 pb-6 flex justify-around z-1">
        <a
          href={`https://warpcast.com/~/channel/tab`}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-white text-center text-sm opacity-30"
        >
          2025 ©tab tech
          <br />
          Social payments on Farcaster
        </a>
      </div> */}
      <div className="bg-background text-center fixed bottom-0 inset-x-0 p-2 pb-6 flex justify-around z-1">
        <a
          href={`https://warpcast.com/~/channel/tab`}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-white text-center text-sm opacity-30"
        >
          2025 ©tab tech
        </a>
      </div>
    </div>
  );
}
