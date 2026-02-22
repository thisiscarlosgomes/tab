"use client";

import { useEffect, useState } from "react";
import { Drawer } from "vaul";
import { QRCode } from "react-qrcode-logo";
import { tokenList } from "@/lib/tokens";
import { NumericFormat } from "react-number-format";
import { Button } from "@/components/ui/button";
import Tilt from "react-parallax-tilt";
import { useAccount } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { shortAddress } from "@/lib/shortAddress";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

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

export function ReceiveDrawer({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { isConnected, address: wagmiAddress } = useAccount();
  const { wallets } = useWallets();
  const address =
    (isConnected && wagmiAddress ? wagmiAddress : wallets[0]?.address) ?? null;
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [tokenType, setTokenType] = useState(tokenList[2]?.name ?? "ETH");
  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setRecipient("");
      setResolvedAddress(null);
      return;
    }
    setRecipient(address);
    setResolvedAddress(address);
  }, [address]);

  const fullUrl = resolvedAddress
    ? `https://usetab.app/r?payTo=${resolvedAddress}&token=${tokenType}${amount ? `&amount=${amount}` : ""}`
    : "";

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="top-[110px] md:top-1/2 p-4 md:w-[min(92vw,560px)] md:max-w-none">
        <div className="bg-background p-4 rounded-t-3xl h-full md:mx-auto md:mt-0 md:h-auto md:max-h-[85vh] md:w-full md:rounded-2xl md:border-0 md:p-6 md:overflow-y-auto">
          <ResponsiveDialogHeader className="pt-0 pb-0">
            <ResponsiveDialogTitle className="text-white text-lg text-center font-medium">
              Get paid
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          <div className="mt-4 space-y-3 max-w-sm w-full mx-auto md:max-w-md">
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

            {!resolvedAddress && (
              <p className="text-center text-white/40 text-sm">
                Connect wallet to generate your payment QR.
              </p>
            )}

            {/* {resolvedAddress && (
              <div className="w-full rounded-3xl p-2 flex flex-col items-center md:pb-1">
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
                    logoImage="/app.png"
                    logoWidth={48}
                    logoHeight={48}
                    logoOpacity={1}
                    removeQrCodeBehindLogo
                  />
                </Tilt>

                {/* Username */}
                <button
                  type="button"
                  onClick={() => {
                    if (!fullUrl) return;
                    navigator.clipboard.writeText(fullUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="text-primary text-md mt-4 hover:underline"
                >
                  {`usetab.app/r?payTo=${shortAddress(resolvedAddress)}`}
                </button>

                {/* Wallet Address */}
                <button
                  className="text-white/30 text-md transition"
                  onClick={() => navigator.clipboard.writeText(resolvedAddress)}
                >
                  {shortAddress(resolvedAddress)}
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
              <Drawer.Content className="scroll-smooth z-50 fixed top-[110px] left-0 right-0 bottom-0 md:top-0 md:bg-transparent md:p-6">
                <div className="bg-background p-0 rounded-t-3xl h-full flex flex-col md:mx-auto md:mt-0 md:h-auto md:max-h-[80vh] md:w-[min(92vw,560px)] md:rounded-3xl md:border md:border-white/10">
                  <div
                    aria-hidden
                    className="mx-auto w-12 h-1.5 rounded-full bg-white/10 my-4 md:hidden"
                  />
                  <div className="px-4 pb-4 md:pb-6 overflow-y-auto">
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
                </div>
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
