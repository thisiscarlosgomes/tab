// providers/ScanDrawerProvider.tsx
"use client";

import { createContext, useContext, useState } from "react";

const ScanDrawerContext = createContext<{
  open: () => void;
  close: () => void;
  isOpen: boolean;
}>({
  open: () => {},
  close: () => {},
  isOpen: false,
});

export function ScanDrawerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);

  return (
    <ScanDrawerContext.Provider value={{ open, close, isOpen }}>
      {children}
    </ScanDrawerContext.Provider>
  );
}

export const useScanDrawer = () => useContext(ScanDrawerContext);
