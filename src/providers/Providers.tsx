"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// import { AuthedPrefetchesProvider } from './AuthedPrefetchesProvider';
import { FrameContextProvider } from "./FrameContextProvider";
import { FrameSplashProvider } from "./FrameSplashProvider";
import { WalletProvider } from "./WalletProvider";
import { SendDrawerProvider } from "./SendDrawerProvider";
import { GlobalSendDrawer } from "@/components/app/sendDrawer";
import { ScanDrawerProvider } from "./ScanDrawerProvider";
import { QRCodeScannerDrawerWrapper } from "@/components/app/QRCodeScannerDrawerWrapper";
import { Toaster } from "sonner";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1e3 * 60 * 60,
    },
  },
});

function Providers({ children }: React.PropsWithChildren) {
  return (
    <FrameSplashProvider>
      <FrameContextProvider>
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
      </FrameContextProvider>
    </FrameSplashProvider>
  );
}

export { Providers };
