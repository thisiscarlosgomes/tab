"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowUpRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { shortAddress } from "@/lib/shortAddress";
import { useTabIdentity } from "@/lib/useTabIdentity";

type TransferDetails = {
  txHash: string;
  amount: number | null;
  token: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  note: string | null;
  timestamp: string | null;
  recipientUsername?: string | null;
  senderUsername?: string | null;
};

function formatAmount(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function formatTime(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function shortHash(hash: string) {
  if (!/^0x[a-f0-9]{64}$/i.test(hash)) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

export default function ActivityTransferDetailPage() {
  const params = useParams<{ txHash: string }>();
  const txHash = typeof params?.txHash === "string" ? params.txHash : "";
  const { address: viewerAddress } = useTabIdentity();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<TransferDetails | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      if (!txHash) {
        setError("Missing transaction hash");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/activity/tx/${txHash}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data?.tx) {
          setError(data?.error || "Unable to load transfer");
          setTx(null);
          setLoading(false);
          return;
        }
        setTx(data.tx as TransferDetails);
      } catch {
        if (!cancelled) {
          setError("Unable to load transfer");
          setTx(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [txHash]);

  const explorerUrl = useMemo(
    () => (tx?.txHash ? `https://basescan.org/tx/${tx.txHash}` : null),
    [tx?.txHash]
  );

  const pageUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    return window.location.href;
  }, []);

  const normalizedViewer = viewerAddress?.toLowerCase() ?? null;
  const isOutgoing =
    Boolean(tx?.fromAddress && normalizedViewer) &&
    tx!.fromAddress!.toLowerCase() === normalizedViewer;

  const incomingSenderLabel = tx?.senderUsername
    ? tx.senderUsername.startsWith("0x")
      ? shortAddress(tx.senderUsername)
      : `@${tx.senderUsername.replace(/^@/, "")}`
    : tx?.fromAddress
      ? shortAddress(tx.fromAddress)
      : "Someone";

  const title = tx
    ? tx.amount !== null && tx.token
      ? isOutgoing
        ? `You transfered ${formatAmount(tx.amount)} ${tx.token}`
        : `${incomingSenderLabel} transfered ${formatAmount(tx.amount)} ${tx.token}`
      : "Transfer"
    : "Transfer";

  return (
    <div className="min-h-screen p-4 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(8rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-md pt-6">
        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
            <Skeleton className="h-14 w-14 rounded-xl" />
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : error || !tx ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center text-white/60">
            {error ?? "Transfer not found"}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-white/5 text-white">
              <ArrowUpRight className="h-7 w-7" />
            </div>

            <h1 className="text-xl font-semibold text-white leading-tight">
              {title}
            </h1>

            {tx.note && (
              <div className="mt-4 inline-block max-w-full rounded-md bg-white/5 px-3 py-2 text-sm text-white/80">
                {tx.note}
              </div>
            )}

            <div className="mt-5 space-y-3 rounded-xl bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-white/50 text-sm">From</span>
                <span className="text-white text-sm break-all text-right">
                  {tx.fromAddress ? shortAddress(tx.fromAddress) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-white/50 text-sm">To</span>
                <span className="text-white text-sm break-all text-right">
                  {tx.toAddress ? shortAddress(tx.toAddress) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-white/50 text-sm">Tx hash</span>
                <span className="text-white text-sm break-all text-right">
                  {shortHash(tx.txHash)}
                </span>
              </div>
              {tx.timestamp && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-white/50 text-sm">Time</span>
                  <span className="text-white text-sm text-right">
                    {formatTime(tx.timestamp)}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                onClick={async () => {
                  const link = pageUrl ?? window.location.href;
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1200);
                }}
              >
                {copied ? (
                  <>
                    Copied link
                  </>
                ) : (
                  <>Copy link</>
                )}
              </Button>

              <Button
                className="bg-primary text-black"
                onClick={() => {
                  if (!explorerUrl) return;
                  window.open(explorerUrl, "_blank", "noopener,noreferrer");
                }}
                disabled={!explorerUrl}
              >
                Open BaseScan
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
