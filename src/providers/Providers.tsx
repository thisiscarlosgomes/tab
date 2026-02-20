"use client";

import { useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FrameContextProvider } from "./FrameContextProvider";
import { FrameSplashProvider } from "./FrameSplashProvider";
import { WalletProvider } from "./WalletProvider";
import { SendDrawerProvider } from "./SendDrawerProvider";
import { ScanDrawerProvider } from "./ScanDrawerProvider";
import { GlobalSendDrawer } from "@/components/app/sendDrawer";
import { QRCodeScannerDrawerWrapper } from "@/components/app/QRCodeScannerDrawerWrapper";
import { Toaster } from "sonner";
import { SkeletonTheme } from "react-loading-skeleton";
import { base } from "viem/chains";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 60,
    },
  },
});

interface FrameContext {
  user?: {
    fid?: number;
    username?: string;
  };
}

declare global {
  interface Window {
    frameContext?: FrameContext;
  }
}

function Providers({ children }: React.PropsWithChildren) {
  const [insideFrame, setInsideFrame] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
    const ctx = typeof window !== "undefined" ? window.frameContext : null;
    setInsideFrame(!!ctx?.user?.fid);
  }, []);

  if (!hasMounted) return null;

  const content = (
    <FrameSplashProvider>
      <FrameContextProvider>
        <SkeletonTheme baseColor="#19191E" highlightColor="#0D0D13">
          <QueryClientProvider client={client}>
            <WalletProvider>
              <ScanDrawerProvider>
                <SendDrawerProvider>
                  <Toaster richColors position="top-center" />
                  <>
                    {children}
                    <GlobalSendDrawer />
                    <QRCodeScannerDrawerWrapper />
                  </>
                </SendDrawerProvider>
              </ScanDrawerProvider>
            </WalletProvider>
          </QueryClientProvider>
        </SkeletonTheme>
      </FrameContextProvider>
    </FrameSplashProvider>
  );

  return insideFrame ? (
    content
  ) : (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["wallet"],
        embeddedWallets: {
          createOnLogin: "off",
        },
        appearance: {
          accentColor: "#fff",
          theme: "#19191E",
          walletList: [
            "detected_wallets",
            "coinbase_wallet",
            "metamask",
            "wallet_connect",
            "rabby_wallet",
            "rainbow",
          ],
          landingHeader: "Welcome to tab",
        },

        defaultChain: base,
        supportedChains: [base],
      }}
    >
      {content}
    </PrivyProvider>
  );
}

export { Providers };
