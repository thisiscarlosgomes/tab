"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useFrameSplash } from "@/providers/FrameSplashProvider";
import sdk from "@farcaster/frame-sdk";
import { useAccount } from "wagmi";

import { useScanDrawer } from "@/providers/ScanDrawerProvider";
import { useSendDrawer } from "@/providers/SendDrawerProvider";

import { ReceiveDrawer } from "@/components/app/ReceiveDrawer";
import { MorphoDepositDrawer } from "@/components/app/LendingMorpho";
import TabGuideAnimation from "@/components/app/introAnimation";

import { baseClient } from "@/lib/baseClient";

import Skeleton from "react-loading-skeleton";
import { createPublicClient, http, formatUnits, erc20Abi } from "viem";
import { base } from "viem/chains";
import clsx from "clsx";

import { useConnect, useDisconnect } from "wagmi";

import { Bot, Dice5 } from "lucide-react";

import { useTicketCountForRound } from "@/lib/BaseJackpotQueries";

const ALCHEMY_URL = process.env.ALCHEMY_URL!;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;
const VAULT_ADDRESS = "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca";

const CHAINS = [{ key: "base", chain: base, icon: "/base.png" }];

async function loadBalances(address: `0x${string}`) {
  const results: Record<string, number | undefined> = {};

  for (const entry of CHAINS) {
    try {
      const raw = await baseClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });

      results[entry.key] = parseFloat(formatUnits(raw, USDC_DECIMALS));
    } catch {
      results[entry.key] = undefined; // 👈 important
    }
  }

  return results;
}

function FriendSkeleton() {
  return (
    <div className="opacity-60 flex flex-col items-center w-[22%] min-w-[64px]">
      <Skeleton circle width={56} height={56} />
    </div>
  );
}

function ActiveCardSkeleton() {
  return (
    <div className="ml-1 flex-1">
      <Skeleton width={80} height={12} className="mb-2" />
      <Skeleton width={160} height={18} />
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const { dismiss } = useFrameSplash();

  const [insideFrame, setInsideFrame] = useState(false);
  const [hasCheckedFrame, setHasCheckedFrame] = useState(false);

  const { address, isConnected } = useAccount();
  const { connect, status } = useConnect();
  const { disconnect } = useDisconnect();

  const isConnecting = status === "pending";

  const shouldShowConnect = hasCheckedFrame && !insideFrame && !isConnected;

  const [username, setUsername] = useState<string | null>(null);

  const { open: openScanDrawer } = useScanDrawer();
  const { open, setQuery, setSelectedUser, setSelectedToken, setTokenType } =
    useSendDrawer();

  const [showMorphoDrawer, setShowMorphoDrawer] = useState(false);
  const [showReceiveDrawer, setShowReceiveDrawer] = useState(false);
  const [showGiftDrawer, setShowGiftDrawer] = useState(false);

  const [friends, setFriends] = useState<any[]>([]);
  const [multiBalances, setMultiBalances] = useState<any>(null);

  const [shake, setShake] = useState(false);
  const [shakeBalance, setShakeBalance] = useState(false);

  const shakeClass = shake ? "animate-shake" : "";

  const totalUSDC = multiBalances
    ? Object.values(multiBalances).reduce((acc: number, v: any) => acc + v, 0)
    : 0;

  const tap = "active:scale-95 transition-transform duration-100";

  const [earnBalance, setEarnBalance] = useState<number | null>(null);
  const [monthlyEarn, setMonthlyEarn] = useState<number | null>(null);
  const [jackpotTickets, setJackpotTickets] = useState<number | null>(null);

  const { data: ticketCount, isLoading: loadingTickets } =
    useTicketCountForRound(address);

  const hasEarn = typeof earnBalance === "number" && earnBalance > 0;

  const hasJackpot = typeof jackpotTickets === "number" && jackpotTickets > 0;

  const showActiveCards = hasEarn || hasJackpot;

  const [netApy, setNetApy] = useState<number | null>(null);

  useEffect(() => {
    if (typeof ticketCount === "number") {
      setJackpotTickets(ticketCount);
    }
  }, [ticketCount]);

  useEffect(() => {
    const cached = localStorage.getItem("tab_actives");
    if (!cached) return;

    try {
      const parsed = JSON.parse(cached);
      if (typeof parsed.earnBalance === "number")
        setEarnBalance(parsed.earnBalance);
      if (typeof parsed.monthlyEarn === "number")
        setMonthlyEarn(parsed.monthlyEarn);
      if (typeof parsed.jackpotTickets === "number")
        setJackpotTickets(parsed.jackpotTickets);
      if (typeof parsed.netApy === "number") setNetApy(parsed.netApy);
    } catch {}
  }, []);

  useEffect(() => {
    if (
      earnBalance === null &&
      monthlyEarn === null &&
      jackpotTickets === null &&
      netApy === null
    )
      return;

    localStorage.setItem(
      "tab_actives",
      JSON.stringify({
        earnBalance,
        monthlyEarn,
        jackpotTickets,
        netApy,
      })
    );
  }, [earnBalance, monthlyEarn, jackpotTickets, netApy]);

  useEffect(() => {
    const fetchApy = async () => {
      try {
        const res = await fetch("https://blue-api.morpho.org/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `
            query VaultByAddress($address: String!, $chainId: Int) {
              vaultByAddress(address: $address, chainId: $chainId) {
                state {
                  netApy
                }
              }
            }
          `,
            variables: {
              address: VAULT_ADDRESS,
              chainId: 8453,
            },
          }),
        });

        const json = await res.json();
        const apy = json?.data?.vaultByAddress?.state?.netApy;

        if (typeof apy === "number") {
          setNetApy(apy);
        }
      } catch (err) {
        console.error("Failed to fetch Morpho APY", err);
      }
    };

    fetchApy();
  }, []);

  useEffect(() => {
    if (!address) return;

    const fetchEarnFromMorpho = async () => {
      try {
        const res = await fetch("https://blue-api.morpho.org/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `
            query GetUserVaultPositions($address: String!, $chainId: Int!) {
              userByAddress(address: $address, chainId: $chainId) {
                vaultPositions {
                  state {
                    assetsUsd
                  }
                  vault {
                    address
                  }
                }
              }
            }
          `,
            variables: {
              address,
              chainId: 8453,
            },
          }),
        });

        const json = await res.json();

        const positions = json?.data?.userByAddress?.vaultPositions ?? [];

        const vaultPosition = positions.find(
          (p: any) =>
            p.vault?.address?.toLowerCase() === VAULT_ADDRESS.toLowerCase()
        );

        const assetsUsd = Number(vaultPosition?.state?.assetsUsd ?? 0);

        setEarnBalance(assetsUsd);
      } catch (e) {
        console.error("Failed to fetch Morpho earnings", e);
      }
    };

    fetchEarnFromMorpho();
  }, [address]);

  useEffect(() => {
    if (
      typeof earnBalance !== "number" ||
      typeof netApy !== "number" ||
      earnBalance <= 0
    ) {
      return; // 👈 do NOTHING, don’t zero it
    }

    setMonthlyEarn((earnBalance * netApy) / 12);
  }, [earnBalance, netApy]);

  const isLoadingActives =
    earnBalance === null &&
    netApy === null &&
    monthlyEarn === null &&
    jackpotTickets === null;

  useEffect(() => {
    if (!username) return;

    const cached = localStorage.getItem(`tab_friends_${username}`);
    if (!cached) return;

    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setFriends(parsed);
      }
    } catch {}
  }, [username]);

  /* LOAD FRIENDS */
  useEffect(() => {
    if (!username) return;

    const fetchFriends = async () => {
      try {
        const res = await fetch(
          `/api/neynar/user/following?username=${username}`
        );
        const data = await res.json();

        if (Array.isArray(data) && data.length > 0) {
          const next = data.slice(0, 10).map((entry) => entry.user);
          setFriends(next);
          localStorage.setItem(`tab_friends_${username}`, JSON.stringify(next));
        }
      } catch {
        // ❌ do nothing — keep cached friends
      }
    };

    fetchFriends();
  }, [username]);

  useEffect(() => {
    if (!address) return;

    const refetchBalances = async () => {
      const data = await loadBalances(address);
      setMultiBalances((prev: any) => {
        const merged = { ...(prev ?? {}) };

        for (const key in data) {
          if (typeof data[key] === "number") {
            merged[key] = data[key]; // only overwrite on success
          }
        }

        localStorage.setItem("tab_balances", JSON.stringify(merged));
        return merged;
      });
    };

    const onBalanceUpdate = () => {
      refetchBalances();
    };

    window.addEventListener("tab:balance-updated", onBalanceUpdate);

    return () => {
      window.removeEventListener("tab:balance-updated", onBalanceUpdate);
    };
  }, [address]);

  /* CHECK FRAME */
  useEffect(() => {
    const checkFrame = async () => {
      const context = await sdk.context;
      setInsideFrame(!!context);
      setHasCheckedFrame(true);
    };
    checkFrame();
    dismiss();
  }, [dismiss]);

  /* GET USERNAME */
  useEffect(() => {
    let mounted = true;

    sdk.context.then((ctx) => {
      if (!mounted) return;
      setUsername(ctx.user?.username ?? null);
    });

    return () => {
      mounted = false;
    };
  }, []);

  // Restore cached balances fast (prevents flicker to 0)
  useEffect(() => {
    const cached = localStorage.getItem("tab_balances");
    if (cached) setMultiBalances(JSON.parse(cached));
  }, []);

  // Fetch fresh balances, update cache
  useEffect(() => {
    if (!address) return;

    (async () => {
      const data = await loadBalances(address);
      setMultiBalances((prev: any) => {
        const merged = { ...(prev ?? {}) };

        for (const key in data) {
          if (typeof data[key] === "number") {
            merged[key] = data[key]; // only overwrite on success
          }
        }

        localStorage.setItem("tab_balances", JSON.stringify(merged));
        return merged;
      });
    })();
  }, [address]);

  /* SIMPLE HAPTICS */
  const triggerClickHaptics = async () => {
    try {
      await sdk.haptics.impactOccurred("medium");
    } catch {}
  };

  /* ------------------------------------------ */
  /* LANDING PAGE (OUTSIDE BASE / NOT IN FRAME) */
  /* ------------------------------------------ */
  const isDev = process.env.NODE_ENV === "development";
  const hasFriends = friends.length > 0;

  if (hasCheckedFrame && !insideFrame && !isDev) {
    return (
      <main className="bg-background min-h-screen w-full flex flex-col items-center justify-center p-6 text-center">
        <img src="/app.png" alt="Tab App Icon" className="w-16 h-16 mb-4" />

        <h1 className="text-2xl font-semibold leading-tight">meet tab</h1>

        <p className="text-white/40 mb-8 text-base">
          Split, send, and get paid in seconds.
        </p>

        <div className="w-full max-w-xs mb-12">
          <TabGuideAnimation />
        </div>

        <div className="fixed bottom-0 inset-x-0 p-5 pb-8">
          <a
            href="https://warpcast.com/~/frames/launch?domain=usetab.app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button className="w-full bg-primary text-black font-semibold">
              Open Tab
            </Button>
          </a>

          <p className="text-xs text-white/20 mt-3 py-4">2025 © tab tech</p>
        </div>
      </main>
    );
  }

  /* ------------------------------- */
  /* MINI-APP EXPERIENCE (INSIDE FC) */
  /* ------------------------------- */
  return (
    <main className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-16 pb-40 overflow-y-auto scrollbar-hide">
      <div className="w-full max-w-sm space-y-8">
        {/* BALANCE CARD */}
        <div
          onClick={() => router.push("/profile")}
          className="w-full bg-white/5 rounded-xl p-3 text-left mt-2 cursor-pointer transition-colors"
        >
          <h2 className="ml-2 text-white font-2xl font-medium mb-2 flex items-center gap-1 mt-1">
            My USDC
            <img src="/base.png" className="w-4 h-4 opacity-90" />
          </h2>

          <p
            className={clsx(
              "ml-2 text-4xl text-white font-semibold mb-2",
              shakeBalance && "animate-balance-shake"
            )}
          >
            {!multiBalances ? "$0.00" : `$${totalUSDC.toFixed(2)}`}
          </p>

          {/* CONNECT WALLET */}
          {/* <Button
            onClick={(e) => {
              e.stopPropagation();
              connect({ connector: injected() });
            }}
            disabled={isConnecting}
            className="w-full bg-primary text-black font-semibold"
          >
            {isConnecting ? "Connecting…" : "Connect wallet"}
          </Button> */}

          <div className="grid grid-cols-2 gap-2 mt-3">
            {/* SEND */}
            <button
              onClick={async (e) => {
                e.stopPropagation();

                if (totalUSDC === 0) {
                  setShakeBalance(true);
                  setTimeout(() => setShakeBalance(false), 500);
                  await triggerClickHaptics();
                  return;
                }

                await triggerClickHaptics();
                open();
              }}
              className="bg-white/5 text-white py-3 rounded-lg text-base font-semibold active:scale-95 transition duration-100"
            >
              Send
            </button>

            {/* REQUEST */}
            <button
              onClick={async (e) => {
                e.stopPropagation();
                await triggerClickHaptics();
                setShowReceiveDrawer(true);
              }}
              className={`bg-white/5 text-white  py-3 rounded-lg text-base font-semibold ${tap}`}
            >
              Request
            </button>

            {/* SPLIT */}
            <button
              onClick={async (e) => {
                e.stopPropagation();
                await triggerClickHaptics();
                router.push("/split/new");
              }}
              className={`bg-white active:bg-white/90 transition-colors text-black py-3 rounded-lg text-base font-semibold col-span-2 ${tap}`}
            >
              Create a split
            </button>
          </div>

          <div className="text-xs text-yellow-400 text-center mt-4 mb-1">
            This is an early version of Tab v2. Use with care.
          </div>
        </div>

        {/* FRIENDS */}
        <div className="w-full">
          <div className="text-lg ml-2 font-medium mb-2">
            Pay friends quickly
          </div>

          <div className="flex gap-1 overflow-x-auto scrollbar-hide py-1 ml-1">
            {!hasFriends
              ? Array.from({ length: 6 }).map((_, i) => (
                  <FriendSkeleton key={i} />
                ))
              : friends.slice(0, 16).map((f) => (
                  <button
                    key={f.fid}
                    onClick={() => {
                      const user = {
                        fid: f.fid,
                        username: f.username,
                        display_name: f.display_name,
                        pfp_url: f.pfp_url,
                        verified_addresses: f.verified_addresses,
                      };

                      setQuery("");
                      setSelectedUser(user);
                      setSelectedToken("USDC");
                      setTokenType("USDC");

                      setTimeout(() => open(), 0);
                    }}
                    className="flex flex-col items-center w-[22%] min-w-[64px]"
                  >
                    <img
                      src={f.pfp_url}
                      className="w-14 h-14 rounded-full object-cover"
                    />
                    <span className="text-xs text-white/70 mt-1 truncate max-w-[60px]">
                      @{f.username ?? "user"}
                    </span>
                  </button>
                ))}
          </div>
        </div>

        {/* FEATURE CARDS */}
        <div className="mt-6 space-y-3">
          {/* PAY ROULETTE */}
          <button
            onClick={() => router.push("/table")}
            className="w-full flex items-center gap-3 bg-white/5 rounded-xl p-4 text-left active:scale-[0.98] transition"
          >
            <div className="w-10 h-10 rounded-full bg-purple-500/15 flex items-center justify-center">
              <Dice5 className="w-5 h-5 text-purple-400" />
            </div>

            <div>
              <p className="text-base font-medium text-white">Spin the tab</p>
              <p className="text-md text-white/40 mt-0.5">
                Spin to randomly decide who pays
              </p>
            </div>
          </button>

          {/* TAB AGENT */}
          <button
            onClick={() => router.push("/faq")}
            className="w-full flex items-center gap-3 bg-white/5 rounded-xl p-4 text-left active:scale-[0.98] transition"
          >
            <div className="w-10 h-10 rounded-full bg-blue-500/15 flex items-center justify-center">
              <Bot className="w-5 h-5 text-blue-400" />
            </div>

            <div>
              <p className="text-base font-medium text-white">
                Tab Agent <span className="text-blue-400"></span>
              </p>
              <p className="text-md text-white/40 mt-0.5">
                Split, pay and airdrop on Base chat
              </p>
            </div>
          </button>
        </div>

        {(showActiveCards || isLoadingActives) && (
          <div className="mt-4">
            <div className="text-lg ml-2 font-medium mb-2">Active</div>

            <div className="mt-3 flex gap-2">
              {isLoadingActives ? (
                <>
                  <ActiveCardSkeleton />
                  <ActiveCardSkeleton />
                </>
              ) : (
                <>
                  {hasEarn && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMorphoDrawer(true);
                      }}
                      className="flex-1 bg-white/5 rounded-xl px-4 py-3 text-left active:scale-95 transition"
                    >
                      <p className="text-sm text-white/40">Earning</p>
                      <p className="text-md text-white font-medium">
                        ${earnBalance!.toFixed(2)}
                        {typeof monthlyEarn === "number" && monthlyEarn > 0 && (
                          <span className="text-green-400 ml-1 whitespace-nowrap">
                            +${monthlyEarn.toFixed(2)}/mo
                          </span>
                        )}
                      </p>
                    </button>
                  )}

                  {hasJackpot && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push("/jackpot");
                      }}
                      className="flex-1 bg-white/5 rounded-xl px-4 py-3 text-left active:scale-95 transition"
                    >
                      <p className="text-sm text-white/40">Jackpot</p>
                      <p className="text-md text-white font-medium">
                        {jackpotTickets} ticket{jackpotTickets! > 1 ? "s" : ""}
                      </p>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* MORE WAYS TO USE TAB */}
        <div className="mt-6">
          <div className="text-lg ml-2 font-medium mb-2">
            More ways to use Tab
          </div>

          <div className="grid grid-cols-2 gap-1.5 mb-4">
            <button
              onClick={() => router.push("/table")}
              className={`hidden bg-white/5 rounded-xl px-2 py-3 text-left ${tap}`}
            >
              <div className="flex items-center gap-1">
                <img src="/vpush.png" className="w-9 h-9 rounded-md" />
                <span className="text-white text-md font-medium">
                  Spin the tab
                </span>
              </div>
            </button>

            <button
              onClick={() => router.push("/jackpot")}
              className={`bg-white/5 rounded-xl px-2 py-3 text-left ${tap}`}
            >
              <div className="flex items-center gap-1">
                <img src="/vticket.png" className="w-9 h-9 rounded-md" />
                <span className="text-white text-md font-medium">
                  $1M Jackpot
                </span>
              </div>
            </button>

            <button
              onClick={() => router.push("/drop/new")}
              className={`hidden bg-white/5 rounded-xl px-2 py-3 text-left ${tap}`}
            >
              <div className="flex items-center gap-1">
                <img src="/vcash.png" className="w-9 h-9 rounded-md" />
                <span className="text-white text-md font-medium">
                  Cash Links
                </span>
              </div>
            </button>

            <button
              onClick={() => setShowMorphoDrawer(true)}
              className={`bg-white/5 rounded-xl px-2 py-3 text-left ${tap}`}
            >
              <div className="flex items-center gap-1">
                <img src="/vcash.png" className="w-9 h-9 rounded-md" />
                <span className="text-white text-md font-medium">
                  Earn USDC
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* DRAWERS */}
      <ReceiveDrawer
        isOpen={showReceiveDrawer}
        onOpenChange={setShowReceiveDrawer}
      />

      <MorphoDepositDrawer
        isOpen={showMorphoDrawer}
        onOpenChange={setShowMorphoDrawer}
      />
    </main>
  );
}
