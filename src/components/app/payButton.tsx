"use client";

import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { Button } from "@/components/ui/button";
import { tokenList } from "@/lib/tokens";
import { erc20Abi, parseUnits, isAddress } from "viem";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { getPreferredConnector } from "@/lib/wallet";

interface PayButtonProps {
  recipient: string; // ENS or 0x
  amount: number;
  onlyIf: boolean;
  onPay: () => void;

  payer: {
    address: string;
    name: string;
    fid: number;
  };

  roomId: string;
  token?: string;
  disabled?: boolean;

  /** ✅ NEW — lifted success handler */
  onSuccess?: (data: { txHash?: `0x${string}` }) => void;
}

export function PayButton({
  recipient,
  amount,
  onlyIf,
  onPay,
  payer,
  roomId,
  token = "ETH",
  disabled = false,
  onSuccess,
}: PayButtonProps) {
  const { isConnected, address } = useAccount();
  const { connect, connectors } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const [hash, setHash] = useState<`0x${string}`>();
  const [hasPaid, setHasPaid] = useState(false);
  const [isPaying, setIsPaying] = useState(false);

  const { isSuccess } = useWaitForTransactionReceipt({ hash });
  const successHandled = useRef(false);

  const tokenInfo = tokenList.find((t) => t.name === token);
  const decimals = tokenInfo?.decimals ?? 18;

  function formatAmount(amount: number): string {
    return amount < 0.01 ? amount.toFixed(6) : amount.toFixed(2);
  }

  /* =========================
     HANDLE TX SUCCESS
  ========================= */
  useEffect(() => {
    if (!isSuccess || successHandled.current || !hash) return;

    successHandled.current = true;

    (async () => {
      try {
        // 1. Mark paid in backend
        await fetch(`/api/split/${roomId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment: {
              fid: payer.fid, // ✅ REQUIRED
              address: payer.address,
              name: payer.name,
              txHash: hash,
              token,
              amount,
            },
          }),
        });

        // 2. Local state
        setHasPaid(true);
        setIsPaying(false);
        if (typeof window !== "undefined") {
          if (token === "USDC") {
            window.dispatchEvent(
              new CustomEvent("tab:balance-updated", {
                detail: { deltaUsdc: -amount },
              })
            );
          } else {
            window.dispatchEvent(new Event("tab:balance-updated"));
          }
        }

        // 3. Notify parent (drawer / confetti / copy)
        onSuccess?.({
          txHash: hash,
        });

        // 4. Refresh room state
        onPay();
      } catch (err) {
        console.error("Post-payment handling failed", err);
        setIsPaying(false);
      }
    })();
  }, [isSuccess, hash, roomId, payer, token, onPay, onSuccess]);

  /* =========================
     HANDLE CLICK
  ========================= */
  const handleClick = async () => {
    if (disabled || hasPaid || isPaying || !!hash) return;

    if (!isConnected || !address) {
      const preferred = getPreferredConnector(connectors);
      if (!preferred) return;
      await connect({ connector: preferred });
      return;
    }

    if (!tokenInfo) {
      console.error(`Invalid token: ${token}`);
      return;
    }

    setIsPaying(true);

    const client = createPublicClient({
      chain: mainnet,
      transport: http(),
    });

    let resolvedAddress: `0x${string}`;

    try {
      if (isAddress(recipient)) {
        resolvedAddress = recipient as `0x${string}`;
      } else if (recipient.endsWith(".eth")) {
        const ens = await client.getEnsAddress({
          name: normalize(recipient),
        });
        if (!ens || !isAddress(ens)) throw new Error("ENS resolve failed");
        resolvedAddress = ens as `0x${string}`;
      } else {
        throw new Error("Invalid recipient");
      }
    } catch (err) {
      console.error("Recipient resolution failed", err);
      setIsPaying(false);
      return;
    }

    const value = parseUnits(amount.toString(), decimals);

    try {
      let txHash: `0x${string}`;

      if (!tokenInfo.address) {
        // ETH
        txHash = await sendTransactionAsync({
          to: resolvedAddress,
          value,
          chainId: 8453,
        });
      } else {
        // ERC-20
        txHash = await writeContractAsync({
          address: tokenInfo.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "transfer",
          args: [resolvedAddress, value],
          chainId: 8453,
        });
      }

      setHash(txHash);
    } catch (err) {
      console.error("Transaction failed", err);
      setIsPaying(false);
    }
  };

  if (!onlyIf) return null;

  return (
    <Button
      onClick={handleClick}
      disabled={disabled || hasPaid || !!hash || isPaying}
      className="w-full"
    >
      {hasPaid
        ? "✅ Paid"
        : isPaying
          ? "Confirming…"
          : `Pay ${formatAmount(amount)} ${token}`}
    </Button>
  );
}
