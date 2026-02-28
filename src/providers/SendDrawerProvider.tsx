"use client";
import { createContext, useContext, useState, useRef } from "react";
import { SocialUser } from "@/lib/social";

type EnrichedCast = {
  hash: string;
  timestamp: string;
  channelKey?: string;
  author: {
    username: string;
    fid: number;
    pfp_url?: string;
  };
};

const SendDrawerContext = createContext<{
  open: () => void;
  close: () => void;
  isOpen: boolean;

  query: string;
  setQuery: (value: string) => void;

  scannedUsername: string | null;
  setScannedUsername: (v: string | null) => void;

  sharedCast: EnrichedCast | null;
  setSharedCast: (cast: EnrichedCast | null) => void;

  hasTriggeredSendFromCast: React.MutableRefObject<boolean>;

  // 🔥 NEW — needed for Friends Row
  selectedUser: SocialUser | null;
  setSelectedUser: (u: SocialUser | null) => void;

  selectedToken: string | null;
  setSelectedToken: (t: string | null) => void;

  tokenType: string;
  setTokenType: (t: string) => void;
}>({
  open: () => {},
  close: () => {},
  isOpen: false,
  query: "",
  setQuery: () => {},
  scannedUsername: null,
  setScannedUsername: () => {},
  sharedCast: null,
  setSharedCast: () => {},
  hasTriggeredSendFromCast: { current: false },

  selectedUser: null,
  setSelectedUser: () => {},

  selectedToken: null,
  setSelectedToken: () => {},

  tokenType: "USDC",
  setTokenType: () => {},
});

export function SendDrawerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [scannedUsername, setScannedUsername] = useState<string | null>(null);
  const [sharedCast, setSharedCast] = useState<EnrichedCast | null>(null);
  const hasTriggeredSendFromCast = useRef(false);

  // 🔥 NEW GLOBAL SEND STATE
  const [selectedUser, setSelectedUser] = useState<SocialUser | null>(null);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [tokenType, setTokenType] = useState<string>("USDC");

  

  const open = () => setIsOpen(true);

  const close = () => {
    setIsOpen(false);
    setQuery("");
    setScannedUsername(null);
    setSharedCast(null);

    // auto-reset on close
    setSelectedUser(null);
    setSelectedToken(null);
    setTokenType("USDC");
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

        sharedCast,
        setSharedCast,

        hasTriggeredSendFromCast,

        selectedUser,
        setSelectedUser,

        selectedToken,
        setSelectedToken,

        tokenType,
        setTokenType,
      }}
    >
      {children}
    </SendDrawerContext.Provider>
  );
}

export const useSendDrawer = () => useContext(SendDrawerContext);
