"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
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

export type SendDrawerPreset = {
  recipientAddress: `0x${string}`;
  amount: string;
  token: string;
  splitId?: string;
  billName?: string;
  returnPath?: string | null;
  lockRecipient?: boolean;
  lockAmount?: boolean;
  lockToken?: boolean;
};

const SendDrawerContext = createContext<{
  open: () => void;
  openPreset: (preset: SendDrawerPreset) => void;
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

  preset: SendDrawerPreset | null;
  clearPreset: () => void;
}>({
  open: () => {},
  openPreset: () => {},
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

  preset: null,
  clearPreset: () => {},
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
  const [preset, setPreset] = useState<SendDrawerPreset | null>(null);

  const open = useCallback(() => setIsOpen(true), []);
  const openPreset = useCallback((nextPreset: SendDrawerPreset) => {
    setPreset(nextPreset);
    setIsOpen(true);
  }, []);
  const clearPreset = useCallback(() => setPreset(null), []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setScannedUsername(null);
    setSharedCast(null);

    // auto-reset on close
    setSelectedUser(null);
    setSelectedToken(null);
    setTokenType("USDC");
    setPreset(null);
  }, []);

  return (
    <SendDrawerContext.Provider
      value={{
        open,
        openPreset,
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

        preset,
        clearPreset,
      }}
    >
      {children}
    </SendDrawerContext.Provider>
  );
}

export const useSendDrawer = () => useContext(SendDrawerContext);
