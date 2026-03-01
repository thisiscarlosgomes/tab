"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createPublicClient, http, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { QRCode } from "react-qrcode-logo";
import { Loader, QrCode, Share, Copy, CopyCheck } from "lucide-react";
import Image from "next/image";
import { shortAddress } from "@/lib/shortAddress";
import Link from "next/link";
import Tilt from "react-parallax-tilt";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import { getShareUrl } from "@/lib/share";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "next/navigation";

export default function ReceivePageClient() {
  const { slug } = useParams();
  const [address, setAddress] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [pfpUrl, setPfpUrl] = useState<string | null>(null);
  const [valid, setValid] = useState(false);
  const { dismiss } = useFrameSplash();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "ETH";
  const amount = searchParams.get("amount");

  useEffect(() => {
    dismiss();
  }, [dismiss]);

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
      ? `${window.location.origin}/r?payTo=${address}&token=${token}${amount ? `&amount=${amount}` : ""}`
      : "";

  const handleShare = async () => {
    const shareText = "I’m on Tab. Send me coins if you’re feeling generous 💸";
    const fullUrl = `https://usetab.app/receive/${username}`; // or however `fullUrl` is defined

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Pay with Tab",
          text: shareText,
          url: fullUrl,
        });
      } else {
        await navigator.clipboard.writeText(`${shareText} ${fullUrl}`);
      }
    } catch (err) {
      console.warn("Share failed or cancelled", err);
    }
  };

  const handleCopy = (fullUrl: string) => {
    navigator.clipboard.writeText(fullUrl);
    setCopiedCode(fullUrl);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const fullUrl = username
    ? `https://usetab.app/r/?payTo=${username}?token=${token}${amount ? `&amount=${amount}` : ""}`
    : `https://usetab.app/r/?payTo=${address}?token=${token}${amount ? `&amount=${amount}` : ""}`;

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-[calc(6rem+env(safe-area-inset-top))] pb-[calc(8rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
      {valid && address ? (
        <div className="w-full bg-card rounded-3xl p-4 py-8 flex flex-col items-center">
          {amount && (
            <div className="text-5xl  text-primary mb-6">
              {amount}
              {token}
            </div>
          )}

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
                logoImage={pfpUrl || "/newnewnewapp.png"}
                logoWidth={40}
                logoHeight={40}
                logoOpacity={1}
                removeQrCodeBehindLogo={true}
              />
            </div>
          </Tilt>

          {username && (
            <a
              href={`https://warpcast.com/${username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-primary text-center text-lg"
            >
              Scan to pay @{username}
            </a>
          )}

          <div className="flex flex-row space-x-2 w-full mt-4 px-8">
            <Button
              onClick={handleShare}
              className="w-full bg-card text-white/30 border-2"
            >
              <Share className="w-12 h-12" />
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                handleCopy(fullUrl);
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
              }}
              className="w-full bg-card text-white/30 border-2"
            >
              {copiedCode === fullUrl ? (
                <CopyCheck className="w-16 h-16" />
              ) : (
                <Copy className="w-12 h-12" />
              )}
            </Button>
          </div>
          <div className="text-center opacity-30 text-sm mt-4">
            1. Open tab app on Base or Farcaster
            <br />
            2. Scan or tap Pay to complete payment
            <br />
          </div>
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
            src="/newnewnewapp.png"
            alt="logo"
            width={40}
            height={40}
            className="object-cover animate-pulse"
            priority
          />
        </Link>
      </div>

      <div className="flex flex-col bg-background text-center fixed bottom-0 inset-x-0 p-4 pb-6 z-1">
        <div className="max-w-sm w-full mx-auto">
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
    </div>
  );
}
