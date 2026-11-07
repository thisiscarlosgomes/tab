"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { applyDocumentTheme, isDinnerPath } from "@/lib/dinner/theme";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const dinnerMode = isDinnerPath(pathname);
  useLayoutEffect(() => {
    applyDocumentTheme(document, dinnerMode);
  }, [dinnerMode]);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) return null;

  const content = (
    <FrameSplashProvider>
      <SkeletonTheme
        baseColor={dinnerMode ? "#E5E7E1" : "#19191E"}
        highlightColor={dinnerMode ? "#FFFFFF" : "#0D0D13"}
      >
        <QueryClientProvider client={client}>
          <WalletProvider>
            <ScanDrawerProvider>
              <SendDrawerProvider>
                <Toaster
                  theme={dinnerMode ? "light" : undefined}
                  richColors
                  expand={false}
                  position="top-center"
                  offset={{ top: "20px" }}
                  mobileOffset={{
                    top: "calc(env(safe-area-inset-top) + 72px)",
                  }}
                  toastOptions={{
                    classNames: {
                      toast:
                        "w-fit max-w-[calc(100vw-32px)] rounded-full px-4 py-3",
                      content: "px-0",
                      title: "text-sm",
                      description: "text-sm",
                    },
                  }}
                />
                <>
                  {children}
                  {!dinnerMode && (
                    <>
                      <GlobalSendDrawer />
                      <QRCodeScannerDrawerWrapper />
                    </>
                  )}
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
        loginMethods: ["email", "farcaster", "twitter"],
        externalWallets: {
          disableAllExternalWallets: true,
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "all-users",
          },
        },
        appearance: {
          accentColor: dinnerMode ? "#2F704D" : "#fff",
          theme: dinnerMode ? "light" : "#19191E",
          landingHeader: "Welcome to tab",
        },
        fundingMethodConfig: {
          moonpay: {
            paymentMethod: "credit_debit_card",
          },
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
