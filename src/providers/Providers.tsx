"use client";

import { useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

function Providers({ children }: React.PropsWithChildren) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) return null;

  const content = (
    <FrameSplashProvider>
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
    </FrameSplashProvider>
  );

  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email", "farcaster"],
        externalWallets: {
          disableAllExternalWallets: true,
        },
        embeddedWallets: {
          createOnLogin: "all-users",
          ethereum: {
            createOnLogin: "all-users",
          },
        },
        appearance: {
          accentColor: "#fff",
          theme: "#19191E",
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
