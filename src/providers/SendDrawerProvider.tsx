// SendDrawerProvider.tsx
"use client";
import { createContext, useContext, useState } from "react";

const SendDrawerContext = createContext<{
  open: () => void;
  close: () => void;
  isOpen: boolean;
  query: string;
  setQuery: (value: string) => void;
  scannedUsername: string | null;
  setScannedUsername: (v: string | null) => void;
}>({
  open: () => {},
  close: () => {},
  isOpen: false,
  query: "",
  setQuery: () => {},
  scannedUsername: null,
  setScannedUsername: () => {},
});

export function SendDrawerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scannedUsername, setScannedUsername] = useState<string | null>(null);

  const open = () => setIsOpen(true);
  const close = () => {
    setIsOpen(false);
    setScannedUsername(null); // clear after closing
  };

  return (
    <SendDrawerContext.Provider
      value={{
        open,
        close,
        isOpen,
        query,
        setQuery,
        scannedUsername,
        setScannedUsername,
      }}
    >
      {children}
    </SendDrawerContext.Provider>
  );
}

export const useSendDrawer = () => useContext(SendDrawerContext);
