"use client";

import { QRCodeScannerDrawer } from "@/components/app/QRCodeScannerDrawer";
import { useScanDrawer } from "@/providers/ScanDrawerProvider";

export function QRCodeScannerDrawerWrapper() {
  const { isOpen, close } = useScanDrawer();

  return <QRCodeScannerDrawer isOpen={isOpen} setIsOpen={close} />;
}
