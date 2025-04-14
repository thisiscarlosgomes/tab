"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import sdk from "@farcaster/frame-sdk";
import { SendToAddressDrawer } from "@/components/app/SendToAddressDrawer";

interface Participant {
  address: string;
  name: string;
  pfp?: string;
  fid?: string;
}

interface SplitBill {
  description: string;
  token?: string; // optional if not guaranteed
}

export default function JoinSplitPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const splitId = searchParams.get("splitId");
  const payTo = searchParams.get("payTo") as `0x${string}` | null;
  const amount = searchParams.get("amount");

  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const [status, setStatus] = useState("Connecting...");
  const [showPay, setShowPay] = useState(false);
  const [billName, setBillName] = useState<string>("");
  const parsedAmount = amount ? parseFloat(amount) : 0;
  const [token, setToken] = useState("ETH");

  useEffect(() => {
    const joinSplit = async () => {
      if (!splitId) {
        setStatus("Missing split ID.");
        return;
      }

      try {
        // ✅ Fetch bill name
        const res = await fetch(`/api/split/${splitId}`);
        const bill: SplitBill = await res.json();

        setToken(bill.token ?? searchParams.get("token") ?? "ETH");

        setBillName(bill.description);

        if (!isConnected) {
          await connect({ connector: farcasterFrame() });
        }
        if (!address) return;

        setStatus("Joining tab...");

        const context = await sdk.context;
        const participant: Participant = {
          address,
          name: context.user?.username ?? address.slice(0, 6),
          pfp: context.user?.pfpUrl ?? "",
          fid: context.user?.fid?.toString() ?? "",
        };

        await fetch(`/api/split/${splitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participant }),
        });

        setStatus("Joined! Preparing payment...");

        if (payTo && amount) {
          setShowPay(true);
        } else {
          router.push(`/split/${splitId}`);
        }
      } catch (err) {
        console.error("Error joining split:", err);
        setStatus("Failed to join. Try again.");
      }
    };

    joinSplit();
  }, [splitId, isConnected, address, connect, router, payTo, amount]);

  return (
    <>
      <div className="min-h-screen w-full flex items-center justify-center p-8 text-center">
        <p className="text-lg text-white">{status}</p>
      </div>

      {payTo && amount && (
        <SendToAddressDrawer
          isOpen={showPay}
          onOpenChange={(v) => {
            setShowPay(v);
            if (!v) router.push(`/split/${splitId}`);
          }}
          address={payTo}
          amount={parsedAmount}
          splitId={splitId ?? undefined}
          billName={billName} // ✅ pass it here
          token={token} // ✅ pass this
        />
      )}
    </>
  );
}
