"use client";
import { WalletProvider } from "./WalletProvider";
import { SendDrawerProvider } from "./SendDrawerProvider";
import { ScanDrawerProvider } from "./ScanDrawerProvider";
import { GlobalSendDrawer } from "@/components/app/sendDrawer";
import { QRCodeScannerDrawerWrapper } from "@/components/app/QRCodeScannerDrawerWrapper";

export function LegacyProviders({ children }: React.PropsWithChildren) {
  return (
    <WalletProvider>
      <ScanDrawerProvider>
        <SendDrawerProvider>
          {children}
          <GlobalSendDrawer />
          <QRCodeScannerDrawerWrapper />
        </SendDrawerProvider>
      </ScanDrawerProvider>
    </WalletProvider>
  );
}
