"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Drawer } from "vaul";
import sdk from "@farcaster/frame-sdk";
import { NumericFormat } from "react-number-format";
import { parseUnits } from "viem";
import { Button } from "@/components/ui/button";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import { useSendDrawer } from "@/providers/SendDrawerProvider";
import { tokenList } from "@/lib/tokens";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import Image from "next/image";
import Link from "next/link";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useHeadlessDelegatedActions } from "@privy-io/react-auth";
import { QRCode } from "react-qrcode-logo";
import Tilt from "react-parallax-tilt";

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

export default function Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { dismiss } = useFrameSplash();
  const { connect } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { logout, authenticated, ready, login } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets?.[0];
  const { isConnected: wagmiConnected, address: wagmiAddress } = useAccount();
  const { revokeWallets } = useHeadlessDelegatedActions();
  const { open: openSendDrawer, openPreset, setQuery } = useSendDrawer();

  const [recipient, setRecipient] = useState("");
  const [recipientFromContext, setRecipientFromContext] = useState(false);
  const [amount, setAmount] = useState("");
  const [tokenType, setTokenType] = useState(tokenList[2]?.name ?? "ETH");
  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);
  const [insideFrame, setInsideFrame] = useState(true);
  const [hasMounted, setHasMounted] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [triggeredByQuery, setTriggeredByQuery] = useState(false);

  const address = useMemo(() => {
    if (insideFrame && wagmiConnected && wagmiAddress) return wagmiAddress;
    if (!insideFrame && wallets.length > 0) return wallets[0].address;
    return null;
  }, [insideFrame, wagmiConnected, wagmiAddress, wallets]);

  const connected = !!address;
  const shortAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  useEffect(() => {
    setHasMounted(true);
    sdk.context.then((ctx) => {
      setInsideFrame(!!ctx?.user?.fid);
      if (ctx?.user?.username) {
        setRecipient((prev) => prev.trim() || ctx.user?.username || "");
        setRecipientFromContext(true);
      }
    });
  }, []);

  useEffect(() => {
    if (
      connected &&
      address &&
      !recipientFromContext &&
      recipient.trim() === ""
    ) {
      setRecipient(address);
    }
  }, [connected, address, recipientFromContext, recipient]);

  useEffect(() => {
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    const resolve = async () => {
      const cleaned = recipient.trim().replace(/^@/, "");
      if (!cleaned) return setResolvedAddress(null);

      if (cleaned.startsWith("0x") && cleaned.length === 42) {
        return setResolvedAddress(cleaned);
      }

      if (cleaned.endsWith(".eth")) {
        try {
          const { normalize } = await import("viem/ens");
          const { createPublicClient, http } = await import("viem");
          const { mainnet } = await import("viem/chains");
          const client = createPublicClient({
            chain: mainnet,
            transport: http(),
          });
          const ens = await client.getEnsAddress({ name: normalize(cleaned) });
          return setResolvedAddress(ens || null);
        } catch {
          return setResolvedAddress(null);
        }
      }

      try {
        const res = await fetch(
          `/api/neynar/user/by-username?username=${cleaned}`
        );
        const data = await res.json();
        return setResolvedAddress(
          data?.verified_addresses?.primary?.eth_address || null
        );
      } catch {
        return setResolvedAddress(null);
      }
    };

    resolve();
  }, [recipient]);

  useEffect(() => {
    const payTo = searchParams.get("payTo");
    const urlAmount = searchParams.get("amount");
    const token = searchParams.get("token") ?? "ETH";

    if (payTo && urlAmount && !triggeredByQuery) {
      openPreset({
        recipientAddress: payTo as `0x${string}`,
        amount: urlAmount,
        token,
        splitId: undefined,
        billName: undefined,
        lockRecipient: true,
        lockAmount: true,
        lockToken: true,
      });
      setTriggeredByQuery(true);
      router.replace("/r", { scroll: false });
    }
  }, [searchParams, triggeredByQuery, router, openPreset]);

  useEffect(() => {
    const payTo = searchParams.get("payTo");
    const urlAmount = searchParams.get("amount");

    if (!payTo || triggeredByQuery || urlAmount) return;

    setQuery(payTo);
    openSendDrawer();
    setTriggeredByQuery(true);
    router.replace("/r", { scroll: false });
  }, [searchParams, triggeredByQuery, openSendDrawer, router, setQuery]);

  const handleLogout = async () => {
    try {
      if (ready && authenticated) {
        await logout(); // ends Privy session
        await wallet?.disconnect(); // ends wallet session
        console.log("Logged out successfully.");
      }
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const fullUrl = resolvedAddress
    ? `https://usetab.app/r?payTo=${resolvedAddress}&token=${tokenType}${amount ? `&amount=${amount}` : ""}`
    : "";
  const qrValue = (() => {
    if (!resolvedAddress) return "";

    const token = tokenList.find((t) => t.name === tokenType);
    if (!token) return `ethereum:${resolvedAddress}@8453`;

    try {
      if (token.name === "ETH") {
        if (!amount) return `ethereum:${resolvedAddress}@8453`;
        const wei = parseUnits(amount, token.decimals ?? 18);
        return `ethereum:${resolvedAddress}@8453?value=${wei.toString()}`;
      }

      if (!token.address) return `ethereum:${resolvedAddress}@8453`;
      if (!amount) {
        return `ethereum:${token.address}@8453/transfer?address=${resolvedAddress}`;
      }

      const rawAmount = parseUnits(amount, token.decimals ?? 18);
      return `ethereum:${token.address}@8453/transfer?address=${resolvedAddress}&uint256=${rawAmount.toString()}`;
    } catch {
      return token.name === "ETH"
        ? `ethereum:${resolvedAddress}@8453`
        : token.address
          ? `ethereum:${token.address}@8453/transfer?address=${resolvedAddress}`
          : `ethereum:${resolvedAddress}@8453`;
    }
  })();

  return (
    <div className="p-4 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-12 mt-[calc(4rem+env(safe-area-inset-top))] relative">
      <div className="max-w-sm w-full mx-auto space-y-6">
        <div className="text-center">
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
            className={`text-5xl text-center font-medium bg-transparent outline-none placeholder-white/20 w-full ${amount === "" || amount === "0" ? "text-white/20" : "text-primary"
              }`}
          />
          <p className="text-sm text-white/30 mt-2">
            {tokenType}
            <span
              className="ml-1 text-primary cursor-pointer"
              onClick={() => setTokenDrawerOpen(true)}
            >
              Change
            </span>
          </p>
        </div>

        {!recipientFromContext && (
          <div className="relative w-full hidden">
            <label className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 pointer-events-none">
              Recipient Address
            </label>
            <input
              type="text"
              placeholder="address, ENS, or FC name"
              value={
                /^0x[a-fA-F0-9]{40}$/.test(recipient)
                  ? shortAddress(recipient)
                  : recipient
              }
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full p-4 pr-4 pl-28 rounded-lg bg-white/5 text-white text-right placeholder-white/20"
            />
          </div>
        )}

        {resolvedAddress && (
          <div className="w-full rounded-3xl flex flex-col items-center">
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
                value={qrValue}
                size={240}
                logoImage="/newnewnewapp.png"
                logoWidth={36}
                logoHeight={36}
                logoOpacity={1}
                removeQrCodeBehindLogo
              />
            </Tilt>
          </div>
        )}

        {!connected ? (
          <Button
            onClick={() =>
              insideFrame ? connect({ connector: injected() }) : login()
            }
            className="w-full bg-white text-black"
          >
            Connect Wallet
          </Button>
        ) : (
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
            {copied ? "Address copied!" : "Copy Address"}
          </Button>
        )}

      </div>

      <Drawer.Root open={tokenDrawerOpen} onOpenChange={setTokenDrawerOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-20" />
          <Drawer.Content className="scroll-smooth z-50 fixed top-[80px] left-0 right-0 bottom-0 bg-background p-0 rounded-t-3xl flex flex-col">
            <div
              aria-hidden
              className="mx-auto w-12 h-1.5 rounded-full bg-white/10 my-4"
            />
            <div className="px-4 sticky top-[80px] bg-background z-10">
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
            href="https://warpcast.com/~/channel/tab"
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
