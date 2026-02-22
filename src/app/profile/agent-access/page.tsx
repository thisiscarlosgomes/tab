"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useDelegatedActions,
  useIdentityToken,
  usePrivy,
  useToken,
  useWallets,
} from "@privy-io/react-auth";
import { CircleHelp, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_AGENT_POLICY } from "@/lib/agent-access";
import { shortAddress } from "@/lib/shortAddress";
import { tokenList } from "@/lib/tokens";
import { toast } from "sonner";

type AgentAccessState = {
  address?: string | null;
  walletId?: string | null;
  enabled: boolean;
  delegated: boolean;
  status: "ACTIVE" | "PAUSED" | "REVOKED";
  allowedToken: string;
  maxPerPayment: number;
  dailyCap: number;
  recipientMode: "split_participants";
  expiresAt: string | null;
  dailyUsed: number;
  nextResetAt: string;
};

type WalletLike = {
  id?: string | null;
  type?: string;
  address?: string;
  walletClientType?: string;
  delegated?: boolean;
};

const EXPIRY_PRESETS = [7, 15, 90] as const;

function parseExpiryInDays(expiresAt: string | null) {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
}

function normalizeExpiryPreset(days: number) {
  return EXPIRY_PRESETS.includes(days as (typeof EXPIRY_PRESETS)[number])
    ? String(days)
    : String(EXPIRY_PRESETS[0]);
}

export default function AgentAccessPage() {
  const { user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { getAccessToken } = useToken();
  const { wallets } = useWallets();
  const { delegateWallet, revokeWallets } = useDelegatedActions();

  const [state, setState] = useState<AgentAccessState | null>(null);
  const [allowedToken, setAllowedToken] = useState(
    DEFAULT_AGENT_POLICY.allowedToken
  );
  const [maxPerPayment, setMaxPerPayment] = useState(
    String(DEFAULT_AGENT_POLICY.maxPerPayment)
  );
  const [dailyCap, setDailyCap] = useState(String(DEFAULT_AGENT_POLICY.dailyCap));
  const [expiresInDays, setExpiresInDays] = useState(
    normalizeExpiryPreset(DEFAULT_AGENT_POLICY.expiresInDays)
  );
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<
    "save" | "enable" | "revoke" | "toggle" | null
  >(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const saving = savingAction !== null;

  const hasLinkedFarcaster = Boolean(
    user?.farcaster ||
    user?.linkedAccounts?.some((account) => account.type === "farcaster")
  );

  const privyWallets = useMemo(
    () =>
      (wallets as unknown as WalletLike[]).filter(
        (entry) =>
          entry.type === "ethereum" &&
          typeof entry.address === "string" &&
          (entry.walletClientType ?? "").toLowerCase().includes("privy")
      ),
    [wallets]
  );

  const selectedAgentWallet = useMemo(() => {
    const stateAddress = state?.address?.toLowerCase();
    if (stateAddress) {
      const match = privyWallets.find(
        (entry) => entry.address?.toLowerCase() === stateAddress
      );
      if (match) return match;
    }

    const delegated = privyWallets.find((entry) => entry.delegated);
    return delegated ?? privyWallets[0] ?? null;
  }, [privyWallets, state?.address]);

  const agentWalletAddress = selectedAgentWallet?.address ?? null;
  const normalizedAgentWalletAddress = agentWalletAddress?.toLowerCase() ?? null;
  const allowedTokenOptions = useMemo(() => {
    const values = new Set<string>(
      tokenList.map((token) => String(token.name ?? "").toUpperCase())
    );
    values.add(String(DEFAULT_AGENT_POLICY.allowedToken).toUpperCase());
    if (allowedToken) values.add(String(allowedToken).toUpperCase());
    return Array.from(values);
  }, [allowedToken]);

  const canEnable = Boolean(agentWalletAddress && authToken);

  const canManagePolicy = Boolean(state?.address || normalizedAgentWalletAddress);
  const isRevoked = state?.status === "REVOKED";
  const hasDelegation = Boolean(
    (state?.delegated ?? selectedAgentWallet?.delegated ?? false) && !isRevoked
  );
  const isAgentLive = Boolean(state?.status === "ACTIVE" && hasDelegation);

  const authHeaders = useMemo(
    () =>
      authToken
        ? {
          Authorization: `Bearer ${authToken}`,
        }
        : {},
    [authToken]
  );

  useEffect(() => {
    let cancelled = false;
    setAuthResolved(false);
    const resolveAuthToken = async () => {
      if (identityToken) {
        if (!cancelled) {
          setAuthToken(identityToken);
          setAuthResolved(true);
        }
        return;
      }

      const accessToken = await getAccessToken().catch(() => null);
      if (!cancelled) {
        setAuthToken(accessToken);
        setAuthResolved(true);
      }
    };

    void resolveAuthToken();
    return () => {
      cancelled = true;
    };
  }, [identityToken, getAccessToken]);

  const loadAgentAccess = async () => {
    if (!authResolved) {
      return;
    }
    if (!authToken) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/agent-access/me", {
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load Agent Access");

      setState(data as AgentAccessState);
      setAllowedToken(data.allowedToken ?? DEFAULT_AGENT_POLICY.allowedToken);
      setMaxPerPayment(
        String(Number(data.maxPerPayment ?? DEFAULT_AGENT_POLICY.maxPerPayment))
      );
      setDailyCap(String(Number(data.dailyCap ?? DEFAULT_AGENT_POLICY.dailyCap)));
      setExpiresInDays(
        normalizeExpiryPreset(
          parseExpiryInDays(data.expiresAt ?? getDefaultExpiryIsoString())
        )
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authResolved) return;
    void loadAgentAccess();
  }, [authToken, authResolved]);

  const getValidatedGuardrails = () => {
    const parsedMaxPerPayment = Number(maxPerPayment);
    const parsedDailyCap = Number(dailyCap);
    const parsedExpiresInDays = Math.max(0, Math.floor(Number(expiresInDays)));

    if (!Number.isFinite(parsedMaxPerPayment) || parsedMaxPerPayment <= 0) {
      toast.error("Max per payment must be greater than 0.");
      return null;
    }
    if (!Number.isFinite(parsedDailyCap) || parsedDailyCap <= 0) {
      toast.error("Daily cap must be greater than 0.");
      return null;
    }
    if (!Number.isFinite(parsedExpiresInDays)) {
      toast.error("Permission expiry must be a valid number of days.");
      return null;
    }
    if (
      !EXPIRY_PRESETS.includes(
        parsedExpiresInDays as (typeof EXPIRY_PRESETS)[number]
      )
    ) {
      toast.error("Permission expiry must be 7d, 15d, or 90d.");
      return null;
    }

    return {
      maxPerPayment: parsedMaxPerPayment,
      dailyCap: parsedDailyCap,
      expiresInDays: parsedExpiresInDays,
    };
  };

  const savePolicy = async (
    nextStatus?: "ACTIVE" | "PAUSED" | "REVOKED",
    action: "save" | "toggle" = "save"
  ) => {
    const targetAddress = state?.address ?? normalizedAgentWalletAddress;
    if (!targetAddress) {
      toast.error("No delegated wallet detected");
      return;
    }
    if (!authToken) {
      toast.error("Missing Privy auth token. Re-authenticate and try again.");
      return;
    }
    const guardrails = getValidatedGuardrails();
    if (!guardrails) return;

    setSavingAction(action);
    try {
      const res = await fetch(`/api/agent-access/${targetAddress}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          status: nextStatus ?? state?.status ?? "PAUSED",
          allowedToken,
          maxPerPayment: guardrails.maxPerPayment,
          dailyCap: guardrails.dailyCap,
          expiresInDays: guardrails.expiresInDays,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to save policy");
      toast.success("Agent policy updated");
      await loadAgentAccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSavingAction(null);
    }
  };

  const enableAgentAccess = async () => {
    if (!agentWalletAddress || !normalizedAgentWalletAddress) {
      toast.error("No Privy embedded wallet found");
      return;
    }
    if (!authToken) {
      toast.error("Missing Privy auth token. Re-authenticate and try again.");
      return;
    }
    const guardrails = getValidatedGuardrails();
    if (!guardrails) return;
    if (!canEnable) return;

    setSavingAction("enable");
    try {
      await delegateWallet({ address: agentWalletAddress, chainType: "ethereum" });

      const delegateRes = await fetch(
        `/api/agent-access/${normalizedAgentWalletAddress}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({ action: "delegate" }),
        }
      );
      const delegateJson = await delegateRes.json();
      if (!delegateRes.ok) {
        throw new Error(delegateJson?.error ?? "Delegation setup failed");
      }

      const policyRes = await fetch(
        `/api/agent-access/${normalizedAgentWalletAddress}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({
            status: "ACTIVE",
            allowedToken,
            maxPerPayment: guardrails.maxPerPayment,
            dailyCap: guardrails.dailyCap,
            expiresInDays: guardrails.expiresInDays,
          }),
        }
      );
      const policyJson = await policyRes.json();
      if (!policyRes.ok) {
        throw new Error(policyJson?.error ?? "Policy update failed");
      }

      toast.success("Agent Access enabled");
      await loadAgentAccess();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Enable failed";
      if (message.toLowerCase().includes("session signers are not enabled")) {
        toast.error(
          "Privy server-side access is disabled for this app. Enable it in Privy Dashboard -> User management -> Authentication -> Advanced, then retry."
        );
      } else {
        toast.error(message);
      }
    } finally {
      setSavingAction(null);
    }
  };

  const pauseOrResume = async () => {
    if (!state) return;
    const next = state.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    await savePolicy(next, "toggle");
  };

  const revokeAgentAccess = async () => {
    const targetAddress = state?.address ?? normalizedAgentWalletAddress;
    if (!targetAddress) {
      toast.error("No delegated wallet detected");
      return;
    }

    setSavingAction("revoke");
    try {
      await revokeWallets();
      const res = await fetch(`/api/agent-access/${targetAddress}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ action: "revoke" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to revoke");
      toast.success("Agent Access revoked");
      await loadAgentAccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revoke failed");
    } finally {
      setSavingAction(null);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen p-4 pt-[calc(5rem+env(safe-area-inset-top))]">
        <div className="max-w-md mx-auto text-white/70">
          Sign in to manage Agent Access.
        </div>
      </div>
    );
  }

  const statusPending = loading || !authResolved;

  if (statusPending) {
    return (
      <div className="min-h-screen p-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(8rem+env(safe-area-inset-bottom))]">
        <div className="max-w-md mx-auto space-y-4">
          <div className="border border-white/10 rounded-xl p-4 space-y-3">
            <Skeleton className="h-6 w-20 border-0 bg-white/10" />
            <Skeleton className="h-4 w-4/5 border-0 bg-white/10" />
            <Skeleton className="h-4 w-3/5 border-0 bg-white/10" />
          </div>

          <div className="border border-white/10 rounded-xl p-4 space-y-3">
            <Skeleton className="h-6 w-28 border-0 bg-white/10" />
            <Skeleton className="h-4 w-4/5 border-0 bg-white/10" />
            <Skeleton className="h-4 w-3/5 border-0 bg-white/10" />
            <Skeleton className="h-4 w-2/5 border-0 bg-white/10" />
          </div>

          <div className="border border-white/10 rounded-xl p-4 space-y-3">
            <Skeleton className="h-4 w-20 border-0 bg-white/10" />
            <Skeleton className="h-14 w-full rounded-lg border-0 bg-white/10" />
            <Skeleton className="h-14 w-full rounded-lg border-0 bg-white/10" />
            <Skeleton className="h-14 w-full rounded-lg border-0 bg-white/10" />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-10 w-full rounded-lg border-0 bg-white/10" />
              <Skeleton className="h-10 w-full rounded-lg border-0 bg-white/10" />
              <Skeleton className="h-10 w-full rounded-lg border-0 bg-white/10" />
            </div>
            <Skeleton className="h-3 w-1/2 border-0 bg-white/10" />
          </div>

          <div className="space-y-2">
            <Skeleton className="h-11 w-full rounded-lg border-0 bg-white/10" />
            <Skeleton className="h-11 w-full rounded-lg border-0 bg-white/10" />
            <Skeleton className="h-11 w-full rounded-lg border-0 bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(8rem+env(safe-area-inset-bottom))]">
      <div className="max-w-md mx-auto space-y-3">
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          className="w-full border border-white/10 rounded-xl p-4 text-left bg-white/[0.02]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-white/80 flex items-center gap-2">
                <CircleHelp className="h-4 w-4 text-white/60" />
                Setup instructions
              </p>
              <p className="text-xs text-white/50 mt-1">
                Use your AI agent with tab
              </p>
            </div>
          </div>
        </button>

        <div className="border border-white/10 rounded-xl p-4 space-y-1">
          <h1 className="text-lg font-medium flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              {isAgentLive && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-80" />
              )}
              <span
                className={[
                  "relative inline-flex h-2.5 w-2.5 rounded-full",
                  isAgentLive ? "bg-emerald-400" : "bg-white/40",
                ].join(" ")}
              />
            </span>
            Agent Access
          </h1>
          <p className="text-white/50 text-sm">
            Your AI agent executes from this delegated wallet with strict limits.
          </p>
          <p className="text-white/40 text-sm">
            Delegated wallet:{" "}
            <span className="text-white/80">
              {state?.address
                ? shortAddress(state.address as `0x${string}`)
                : agentWalletAddress
                  ? shortAddress(agentWalletAddress as `0x${string}`)
                  : "No Privy wallet found"}
            </span>
          </p>

          <p className="hidden text-white/40 text-sm">
            Status:{" "}
            <span className="text-white/80">
              {loading ? "Loading..." : (state?.status ?? "PAUSED")}
            </span>
          </p>
          {!hasLinkedFarcaster && (
            <p className="text-yellow-300/80 text-sm">
              Link Farcaster first. Agent settlement requires social identity.
            </p>
          )}
        </div>

        <div className="border border-white/10 rounded-xl p-4 space-y-3">
          <p className="text-sm text-white/60">Guardrails</p>

          <label className="block text-sm text-white/70">
            Allowed token
            <select
              value={allowedToken}
              onChange={(e) => setAllowedToken(e.target.value.toUpperCase())}
              className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2"
            >
              {allowedTokenOptions.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-white/70">
            Max per payment (USD)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={maxPerPayment}
              onChange={(e) => setMaxPerPayment(e.target.value)}
              className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2"
            />
          </label>

          <label className="block text-sm text-white/70">
            Daily cap (USD)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
              className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2"
            />
          </label>

          <label className="block text-sm text-white/70">
            Permission expiry (days)
            <div className="mt-1 grid grid-cols-3 gap-2">
              {EXPIRY_PRESETS.map((days) => {
                const selected = Number(expiresInDays) === days;
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setExpiresInDays(String(days))}
                    className={[
                      "rounded-lg border px-3 py-2 text-sm",
                      selected
                        ? "border-primary bg-primary/20 text-white"
                        : "border-white/10 bg-white/5 text-white/70",
                    ].join(" ")}
                  >
                    {days}d
                  </button>
                );
              })}
            </div>
          </label>

          {state && (
            <p className="text-xs text-white/40">
              Used today: ${Number(state.dailyUsed ?? 0).toFixed(2)} / $
              {Number(state.dailyCap ?? dailyCap).toFixed(2)}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Button
            onClick={hasDelegation ? revokeAgentAccess : enableAgentAccess}
            disabled={
              loading ||
              saving ||
              (hasDelegation ? !canManagePolicy : !canEnable)
            }
            className={hasDelegation ? "w-full bg-red-500/90 text-white" : "w-full bg-primary"}
          >
            {(hasDelegation && savingAction === "revoke") ||
              (!hasDelegation && savingAction === "enable") ? (
              <>
                <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                {hasDelegation ? "Revoking..." : "Enabling..."}
              </>
            ) : hasDelegation ? (
              "Revoke delegation"
            ) : (
              "Enable Agent Access"
            )}
          </Button>
          {!hasDelegation && !canEnable && (
            <p className="text-xs text-white/40 px-1">
              {!agentWalletAddress
                ? "No Privy embedded wallet available on this account."
                : !authToken
                  ? "Auth token unavailable. Log out/in to refresh session."
                  : "Agent Access unavailable."}
            </p>
          )}
          {!hasLinkedFarcaster && (
            <p className="text-xs text-yellow-300/80 px-1">
              Link Farcaster to allow autonomous agent settlement.
            </p>
          )}

          {hasDelegation && (
            <Button
              onClick={pauseOrResume}
              disabled={loading || saving || !state || !canManagePolicy}
              className="w-full bg-white/10 text-white"
            >
              {savingAction === "toggle" ? (
                <>
                  <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : state?.status === "ACTIVE" ? (
                "Pause Agent Access"
              ) : (
                "Resume Agent Access"
              )}
            </Button>
          )}

          <Button
            onClick={() => savePolicy(undefined, "save")}
            disabled={loading || saving || !canManagePolicy}
            className="w-full bg-white/10 text-white"
          >
            {savingAction === "save" ? (
              <>
                <LoaderCircle className="w-4 h-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              "Save guardrails"
            )}
          </Button>
        </div>
      </div>

      <ResponsiveDialog open={infoOpen} onOpenChange={setInfoOpen}>
        <ResponsiveDialogContent className="p-4 pb-8 md:w-[min(92vw,560px)] md:max-w-none">
          <div className="max-w-md mx-auto space-y-4">
            <ResponsiveDialogHeader className="pt-0">
              <ResponsiveDialogTitle className="text-lg font-medium text-center">
                How to use your agent
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="sr-only">
                Human instructions for asking your Tab agent to send payments and settle split bills.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
              <p className="text-sm text-white/90">
                <span className="text-white/50">1.</span> Send your agent{" "}
                <span className="text-primary">usetab.app/skill.md</span>
              </p>
              <p className="text-sm text-white/90">
                <span className="text-white/50">2.</span> Approve the link it returns
              </p>
              <p className="text-sm text-white/90">
                <span className="text-white/50">3.</span> Share your{" "}
                <span className="text-white">did:privy:...</span> and enable Agent Access
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-white/40 px-1">
                Try asking
              </p>
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90">
                Pay $0.50 USDC to @alice
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90">
                Pay my share for split lunch-ab12
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90">
                Pay my share: usetab.app/split/abcd1234
              </div>
            </div>

            <p className="text-xs text-white/45">
              Agent spends only from your delegated wallet and only within your guardrails.
            </p>

            <Button
              type="button"
              onClick={() => setInfoOpen(false)}
              className="w-full bg-primary text-black"
            >
              Got it
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}

function getDefaultExpiryIsoString() {
  const now = Date.now();
  return new Date(
    now + DEFAULT_AGENT_POLICY.expiresInDays * 24 * 60 * 60 * 1000
  ).toISOString();
}
