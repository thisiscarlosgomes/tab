"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import { PaymentSuccessDrawer } from "@/components/app/PaymentSuccessDrawer";
import { useAccount, useConnect, useSendTransaction } from "wagmi";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";

type FarcasterUser = {
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  verified_addresses: {
    primary?: {
      eth_address?: string | null;
    };
  };
};

export default function SendPage() {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FarcasterUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<FarcasterUser | null>(null);
  const [ethAmount, setEthAmount] = useState(0.01);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sendDrawerOpen, setSendDrawerOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [lastRecipient, setLastRecipient] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (drawerOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [drawerOpen]);

  useEffect(() => {
    const delay = setTimeout(async () => {
      if (query.trim() === "") {
        setResults([]);
        return;
      }

      const res = await fetch(
        `/api/neynar/user/search?q=${encodeURIComponent(query)}`
      );
      const data = await res.json();
      setResults(data.users || []);
    }, 300); // slight debounce to avoid spamming API

    return () => clearTimeout(delay);
  }, [query]);

  const handleSend = async () => {
    const ethAddress = selectedUser?.verified_addresses?.primary?.eth_address;

    if (!isConnected) await connect({ connector: farcasterFrame() });
    if (!ethAddress || !ethAddress.startsWith("0x")) return;

    setIsSending(true);

    try {
      const txHash = await sendTransactionAsync({
        to: ethAddress as `0x${string}`,
        value: BigInt(ethAmount * 1e18),
        chainId: 8453,
      });

      setSendDrawerOpen(false);
      setSelectedUser(null);
      setShowSuccess(true);
      setLastTxHash(txHash);
      setLastRecipient(selectedUser?.username || null);
    } catch (err) {
      console.error("Transaction failed", err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <h1 className="text-2xl font-bold text-center">Send ETH</h1>

        <Button
          onClick={() => setDrawerOpen(true)}
          className="w-full bg-primary"
        >
          Send ETH to farcaster user
        </Button>

        {/* 🔍 Fullscreen Search Drawer */}
        <Drawer.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-20" />
            <Drawer.Content className="z-30 fixed inset-0 bg-background p-6 space-y-6 overflow-y-auto">
              <Drawer.Title className="text-lg text-center font-medium">
                Send ETH
              </Drawer.Title>
              <div className="relative w-full">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                  user:
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Enter username"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full p-4 pl-12 pr-20 rounded-lg bg-white/5 text-white placeholder-white/20"
                />
                <button
                  onClick={async () => {
                    const text = await navigator.clipboard.readText();
                    setQuery(text);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-primary font-medium hover:underline"
                >
                  Paste
                </button>
              </div>

              <div className="space-y-2">
                {results.map((user) => (
                  <button
                    key={user.fid}
                    onClick={() => {
                      setSelectedUser(user);
                      setDrawerOpen(false);
                      setSendDrawerOpen(true);
                      setQuery(""); // Clear the input
                      setResults([]); // Clear the result list
                    }}
                    className="flex items-start p-3 rounded-lg bg-white/5 hover:bg-white/10 w-full"
                  >
                    <div className="flex items-center gap-2">
                      <img
                        src={
                          user.pfp_url ||
                          `https://api.dicebear.com/9.x/glass/svg?seed=${user.username}`
                        }
                        alt={user.username}
                        className="w-8 h-8 rounded-full"
                      />
                      <div>
                        <p className="text-primary font-medium text-left">
                          @{user.username}
                        </p>
                        <p className="text-sm text-white/30 break-all">
                          {user.verified_addresses?.primary?.eth_address ||
                            "No address"}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        {/* ✉️ Fullscreen Send Drawer */}
        <Drawer.Root open={sendDrawerOpen} onOpenChange={setSendDrawerOpen}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-sm z-20" />
            <Drawer.Content className="z-30 fixed inset-0 bg-[#121212] p-6 pt-24 space-y-6 overflow-y-auto">
              <Drawer.Title className="text-lg text-center font-medium">
                Pay ETH to{" "}
                <span className="text-primary">@{selectedUser?.username}</span>
              </Drawer.Title>
              <p className="text-sm text-center text-muted break-all">
                {selectedUser?.verified_addresses?.primary?.eth_address}
              </p>

              <input
                type="number"
                step="0.001"
                min="0"
                value={ethAmount}
                onChange={(e) => setEthAmount(parseFloat(e.target.value))}
                className="w-full p-4 rounded-lg bg-input text-white placeholder-white/20"
                placeholder="Amount in ETH"
              />

              <Button
                onClick={handleSend}
                disabled={isSending}
                className="w-full bg-primary"
              >
                {isSending ? "Sending..." : `Send ${ethAmount} ETH`}
              </Button>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        <PaymentSuccessDrawer
          isOpen={showSuccess}
          setIsOpen={(v) => {
            setShowSuccess(v);
            if (!v) {
              setLastTxHash(null);
              setLastRecipient(null);
            }
          }}
          name="Payment Sent"
          recipientUsername={lastRecipient || undefined}
          txHash={lastTxHash || undefined}
        />
      </div>
    </div>
  );
}
