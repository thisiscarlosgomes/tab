"use client";

import { useEffect, useState } from "react";
import { Drawer } from "vaul";
import { QRCode } from "react-qrcode-logo";
import sdk from "@farcaster/frame-sdk";
import { tokenList } from "@/lib/tokens";
import { NumericFormat } from "react-number-format";
import { Button } from "@/components/ui/button";
import Tilt from "react-parallax-tilt";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

const getTokenSuffix = (token: string) => {
  switch (token) {
    case "ETH":
    case "WETH":
      return "Ξ";
    case "EURC":
      return "€";
    case "USDC":
    default:
      return "$";
  }
};

const isFarcasterName = (name: string) => {
  return !name.endsWith(".eth") && !name.startsWith("0x");
};

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
});

export function ReceiveDrawer({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [recipientFromContext, setRecipientFromContext] = useState(false);
  const [amount, setAmount] = useState("");
  const [tokenType, setTokenType] = useState(tokenList[2]?.name ?? "ETH");
  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pfpUrl, setPfpUrl] = useState<string | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);

  useEffect(() => {
    sdk.context.then(async (ctx) => {
      const name = ctx?.user?.username;
      if (!name) return;
      setRecipient((prev) => prev.trim() || name);
      setRecipientFromContext(true);
    });
  }, []);

  useEffect(() => {
    const resolveRecipient = async () => {
      const cleaned = recipient.trim().replace(/^@/, "");
      if (!cleaned) {
        setResolvedAddress(null);
        return;
      }

      if (cleaned.startsWith("0x")) {
        setResolvedAddress(cleaned);
        return;
      }

      if (cleaned.endsWith(".eth")) {
        try {
          const ensAddress = await client.getEnsAddress({
            name: normalize(cleaned),
          });
          if (ensAddress?.startsWith("0x")) {
            setResolvedAddress(ensAddress);
            return;
          }
        } catch {}
        setResolvedAddress(null);
        return;
      }

      try {
        const res = await fetch(
          `/api/neynar/user/by-username?username=${cleaned}`
        );
        const data = await res.json();
        const eth = data?.verified_addresses?.primary?.eth_address;
        if (eth?.startsWith("0x")) {
          setResolvedAddress(eth);
          if (!recipientFromContext) setPfpUrl(data?.pfp_url || null);
        } else {
          setResolvedAddress(null);
        }
      } catch {
        setResolvedAddress(null);
      }
    };

    resolveRecipient();
  }, [recipient, recipientFromContext]);

  const fullUrl = resolvedAddress
    ? `https://usetab.app/r?payTo=${resolvedAddress}&token=${tokenType}${amount ? `&amount=${amount}` : ""}`
    : "";

  return (
    <Drawer.Root open={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-20" />
        <Drawer.Content className="fixed inset-0 top-[80px] bg-background p-4 rounded-t-3xl z-40">
          <div className="mx-auto w-12 h-1.5 rounded-full bg-white/10 mb-4" />
          <Drawer.Title className="text-white text-lg text-center font-medium">
            Get paid
          </Drawer.Title>

          <div className="mt-4 space-y-3 max-w-sm w-full mx-auto">
            <div className="text-center hidden">
              <NumericFormat
                inputMode="decimal"
                value={amount}
                onValueChange={(values) => setAmount(values.value)}
                onFocus={() => amount === "0" && setAmount("")}
                thousandSeparator
                allowNegative={false}
                allowLeadingZeros={false}
                decimalScale={4}
                prefix={getTokenSuffix(tokenType)}
                placeholder={`${getTokenSuffix(tokenType)}0`}
                className={`text-5xl text-center font-medium bg-transparent outline-none placeholder-white/20 w-full ${
                  amount === "" || amount === "0"
                    ? "text-white/20"
                    : "text-primary"
                }`}
              />
              <p className="text-sm text-white/30 mt-2">
                {tokenType} (optional)
                <span
                  className="ml-1 text-primary cursor-pointer"
                  onClick={() => setTokenDrawerOpen(true)}
                >
                  Change
                </span>
              </p>
            </div>

            {!recipientFromContext && (
              <div className="relative w-full">
                <label className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 pointer-events-none">
                  Recipient
                </label>
                <input
                  type="text"
                  placeholder="address, ENS, or FC name"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  className="w-full p-4 pr-4 pl-28 rounded-lg bg-white/5 text-white text-right placeholder-white/20"
                />
              </div>
            )}

            {/* {resolvedAddress && (
              <div className="w-full rounded-3xl p-2 flex flex-col items-center">
                <Tilt
                  glareEnable
                  glareMaxOpacity={0.8}
                  glareColor="#ffffff"
                  glarePosition="all"
                  glareBorderRadius="16px"
                  scale={1.03}
                  tiltMaxAngleX={8}
                  tiltMaxAngleY={8}
                  className="p-2 bg-white rounded-xl"
                >
                  <QRCode
                    value={fullUrl}
                    size={240}
                    logoImage={
                      isFarcasterName(recipient.trim())
                        ? pfpUrl || "/app.png"
                        : "/app.png"
                    }
                    logoWidth={40}
                    logoHeight={40}
                    logoOpacity={1}
                    removeQrCodeBehindLogo
                  />
                </Tilt>
              </div>
            )} */}

            {resolvedAddress && (
              <div className="w-full rounded-3xl p-2 flex flex-col items-center">
                <Tilt
                  glareEnable
                  glareMaxOpacity={0.8}
                  glareColor="#ffffff"
                  glarePosition="all"
                  glareBorderRadius="16px"
                  scale={1.03}
                  tiltMaxAngleX={8}
                  tiltMaxAngleY={8}
                  className="p-2 bg-white rounded-xl"
                >
                  <QRCode
                    value={fullUrl}
                    size={240}
                    logoImage={
                      isFarcasterName(recipient.trim())
                        ? pfpUrl || "/app.png"
                        : "/app.png"
                    }
                    logoWidth={48}
                    logoHeight={48}
                    logoOpacity={1}
                    removeQrCodeBehindLogo
                  />
                </Tilt>

                {/* Username */}
                <p className="text-primary text-md mt-4">
                  usetab.app/r/@{recipient.replace(/^@/, "")}
                </p>

                {/* Wallet Address */}
                <button
                  className="text-white/30 text-md transition"
                  onClick={() => navigator.clipboard.writeText(resolvedAddress)}
                >
                  {resolvedAddress.slice(0, 6)}…{resolvedAddress.slice(-4)}
                </button>
              </div>
            )}

            <Button
              className="w-full"
              onClick={() => {
                if (!resolvedAddress) return;
                navigator.clipboard.writeText(resolvedAddress);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              disabled={!resolvedAddress}
            >
              {copied ? "Copied!" : "Copy Address"}
            </Button>

            <p className="text-center text-white/30 text-sm mb-1">
              Use tab to scan and pay
            </p>
          </div>

          <Drawer.Root open={tokenDrawerOpen} onOpenChange={setTokenDrawerOpen}>
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-30" />
              <Drawer.Content className="scroll-smooth z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background p-0 rounded-t-3xl flex flex-col">
                <div
                  aria-hidden
                  className="mx-auto w-12 h-1.5 rounded-full bg-white/10 my-4"
                />
                <div className="px-4">
                  <Drawer.Title className="text-lg text-center font-medium">
                    Select token
                  </Drawer.Title>
                  <div className="space-y-2 mt-4">
                    {tokenList.map((token) => (
                      <button
                        key={token.name}
                        onClick={() => {
                          setTokenType(token.name);
                          setTokenDrawerOpen(false);
                        }}
                        className="w-full flex items-center p-3 rounded-lg bg-white/5 hover:bg-white/10"
                      >
                        <img
                          src={token.icon}
                          className="w-8 h-8 rounded-full mr-4"
                          alt={token.name}
                        />
                        <div className="text-left">
                          <p className="text-white font-medium">{token.name}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
