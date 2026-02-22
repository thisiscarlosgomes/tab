// src/components/SendToUserForm.tsx
"use client";

import { useState } from "react";
import { useAccount, useConnect, useSendTransaction } from "wagmi";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/shortAddress";
import { getPreferredConnector } from "@/lib/wallet";
import { UserAvatar } from "@/components/ui/user-avatar";

type FarcasterUser = {
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  verified_addresses?: {
    primary?: {
      eth_address?: string | null;
    };
  };
};

type Props = {
  user: FarcasterUser;
  onSuccess: (txHash: string) => void;
  onCancel: () => void;
};

export default function SendToUserForm({ user, onSuccess, onCancel }: Props) {
  const [amount, setAmount] = useState("0.01");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();

  const ethAddress = user?.verified_addresses?.primary?.eth_address;

  const handleSend = async () => {
    const parsed = parseFloat(amount);
    if (!ethAddress || isNaN(parsed) || parsed <= 0) return;

    try {
      setIsLoading(true);
      if (!isConnected) {
        const preferred = getPreferredConnector(connectors);
        if (!preferred) return;
        await connect({ connector: preferred });
      }

      const txHash = await sendTransactionAsync({
        to: ethAddress as `0x${string}`,
        value: BigInt(parsed * 1e18),
        chainId: 8453,
      });

      onSuccess(txHash);
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full items-center justify-center px-4 space-y-6">
      <div className="flex flex-col items-center">
        <UserAvatar
          src={user.pfp_url}
          seed={user.username}
          width={64}
          alt={user.username}
          className="w-16 h-16 rounded-full mb-2 object-cover"
        />
        <div className="text-lg font-semibold text-primary">@{user.username}</div>
        <div className="text-sm text-white/30">
          {ethAddress ? shortAddress(ethAddress) : "No address"}
        </div>
      </div>

      <input
        type="text"
        inputMode="decimal"
        className="text-4xl text-center bg-transparent text-primary font-medium outline-none w-full"
        value={amount}
        onChange={(e) => {
          const v = e.target.value;
          if (/^[0-9]*[.]?[0-9]*$/.test(v)) setAmount(v);
        }}
      />

      <textarea
        className="w-full rounded-xl bg-white/5 p-3 text-white placeholder-white/30 resize-none"
        rows={3}
        placeholder="Message (optional)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />

      <div className="w-full space-y-3">
        <Button
          onClick={handleSend}
          disabled={isLoading}
          className="w-full bg-primary"
        >
          {isLoading ? "Sending..." : `Send ${amount} ETH`}
        </Button>

        <Button
          variant="ghost"
          className="w-full text-white/50 hover:text-white"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
