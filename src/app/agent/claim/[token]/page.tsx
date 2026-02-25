"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { useIdentityToken, usePrivy, useToken } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type ClaimState = {
  status?: string;
  agentId?: string | null;
  agentName?: string | null;
  expiresAt?: string | null;
  claimedAt?: string | null;
  linkedUserId?: string | null;
  isExpired?: boolean;
  error?: string;
};

export default function AgentClaimPage() {
  const params = useParams<{ token: string }>();
  const tokenParam = useMemo(
    () => decodeURIComponent(String(params?.token ?? "")).trim(),
    [params?.token]
  );

  const { user, login } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { getAccessToken } = useToken();

  const [claim, setClaim] = useState<ClaimState | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  const getAuthToken = async () => {
    if (identityToken) return identityToken;
    return await getAccessToken().catch(() => null);
  };

  const loadClaim = async (authToken?: string | null) => {
    if (!tokenParam) {
      setClaim({ error: "Missing claim token." });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
      const res = await fetch(`/api/agent/link/claim/${encodeURIComponent(tokenParam)}`, {
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load claim");
      setClaim(data as ClaimState);
    } catch (error) {
      setClaim({
        error: error instanceof Error ? error.message : "Failed to load claim",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      const authToken = await getAuthToken();
      await loadClaim(authToken);
    };
    void load();
  }, [tokenParam, identityToken, user?.id]);

  const confirmClaim = async () => {
    if (!tokenParam) return;
    if (!user) {
      login();
      return;
    }

    const authToken = await getAuthToken();
    if (!authToken) {
      toast.error("Missing auth token. Re-login and try again.");
      return;
    }

    setConfirming(true);
    try {
      const res = await fetch(`/api/agent/link/claim/${encodeURIComponent(tokenParam)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Claim failed");

      toast.success("Agent linked to your Tab account");
      setClaim((prev) => ({
        ...(prev ?? {}),
        ...(data as ClaimState),
      }));
      await loadClaim(authToken);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Claim failed");
    } finally {
      setConfirming(false);
    }
  };

  const status = claim?.status ?? null;
  const isClaimed = status === "CLAIMED";
  const isExpired = Boolean(claim?.isExpired);
  const agentLabel = claim?.agentName || claim?.agentId || "this agent";

  return (
    <div className="min-h-screen p-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <div className="max-w-md mx-auto space-y-4">
        <Link href="/" className="text-white/50 text-sm inline-block">
          Back
        </Link>

        <div className="border border-white/10 rounded-xl p-4 space-y-2">
          <h1 className="text-lg font-medium">Link Agent</h1>
          {loading ? (
            <p className="text-white/60 text-sm">Loading claim...</p>
          ) : claim?.error ? (
            <p className="text-red-300 text-sm">{claim.error}</p>
          ) : (
            <>
              <p className="text-white/70 text-sm">
                Confirm linking <span className="text-white">{agentLabel}</span> to
                your Tab account.
              </p>
              <p className="text-white/50 text-xs">
                Status: <span className="text-white/80">{status ?? "UNKNOWN"}</span>
              </p>
              {claim?.expiresAt && (
                <p className="text-white/40 text-xs">
                  Expires: {new Date(claim.expiresAt).toLocaleString()}
                </p>
              )}
              {claim?.linkedUserId && (
                <div className="pt-1 space-y-1">
                  <p className="text-white/50 text-xs">Linked userId</p>
                  <div className="flex items-center gap-2">
                    <code className="text-[11px] leading-5 text-white/85 break-all">
                      {claim.linkedUserId}
                    </code>
                    <Button
                      type="button"
                      className="h-7 px-2 text-xs bg-white/10 text-white"
                      onClick={async () => {
                        await navigator.clipboard.writeText(claim.linkedUserId ?? "");
                        toast.success("Copied userId");
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-2">
          <Button
            onClick={confirmClaim}
            disabled={loading || confirming || isClaimed || isExpired || !!claim?.error}
            className="w-full bg-primary"
          >
            {confirming ? (
              <>
                <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                Confirming...
              </>
            ) : isClaimed ? (
              "Already linked"
            ) : isExpired ? (
              "Claim expired"
            ) : !user ? (
              "Sign in to confirm"
            ) : (
              "Confirm link"
            )}
          </Button>

          {isClaimed && (
            <Link href="/profile/agent-access" className="block">
              <Button className="w-full bg-white/10 text-white">
                Open Agent Access
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
