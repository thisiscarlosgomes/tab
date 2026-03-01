"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import sdk from "@farcaster/frame-sdk";
import { useSendDrawer } from "@/providers/SendDrawerProvider";
import { useTabIdentity } from "@/lib/useTabIdentity";

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
  const { connect, connectors } = useConnect();
  const { openPreset } = useSendDrawer();
  const { fid: identityFid, username: identityUsername, pfp: identityPfp } =
    useTabIdentity();
  const [status, setStatus] = useState("Connecting...");
  const [billName, setBillName] = useState<string>("");
  const [token, setToken] = useState("ETH");
  const hasJoinedRef = useRef(false);

  useEffect(() => {
    const joinSplit = async () => {
      if (hasJoinedRef.current) return;
      if (!splitId) {
        setStatus("Missing split ID.");
        return;
      }
      hasJoinedRef.current = true;

      try {
        // ✅ Fetch bill name
        const res = await fetch(`/api/split/${splitId}`);
        const bill: SplitBill = await res.json();

        const nextToken = bill.token ?? searchParams.get("token") ?? "ETH";
        const nextBillName = bill.description;
        setToken(nextToken);
        setBillName(nextBillName);

        if (!isConnected) {
          const connector = connectors[0];
          if (!connector) return;
          await connect({ connector });
        }
        if (!address) return;

        setStatus("Joining tab...");

        let context: Awaited<typeof sdk.context> | null = null;
        if (!identityUsername && !identityPfp && !identityFid) {
          try {
            context = await sdk.context;
          } catch {
            context = null;
          }
        }
        const participant: Participant = {
          address,
          name: context?.user?.username ?? identityUsername ?? address.slice(0, 6),
          pfp: context?.user?.pfpUrl ?? identityPfp ?? "",
          fid:
            context?.user?.fid !== null && context?.user?.fid !== undefined
              ? String(context.user.fid)
              : identityFid !== null && identityFid !== undefined
                ? String(identityFid)
                : "",
        };

        await fetch(`/api/split/${splitId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participant }),
        });

        setStatus("Joined! Preparing payment...");

        if (payTo && amount) {
          openPreset({
            recipientAddress: payTo,
            amount,
            token: nextToken,
            splitId: splitId ?? undefined,
            billName: nextBillName,
            returnPath: splitId ? `/split/${splitId}` : null,
            lockRecipient: true,
            lockAmount: true,
            lockToken: true,
          });
        } else {
          router.push(`/split/${splitId}`);
        }
      } catch (err) {
        hasJoinedRef.current = false;
        console.error("Error joining split:", err);
        setStatus("Failed to join. Try again.");
      }
    };

    joinSplit();
  }, [
    splitId,
    isConnected,
    address,
    connect,
    connectors,
    router,
    payTo,
    amount,
    openPreset,
  ]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-8 text-center">
      <p className="text-lg text-white">{status}</p>
    </div>
  );
}
