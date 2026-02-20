"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";
import sdk from "@farcaster/frame-sdk";
import { Loader } from "lucide-react";

/* -------------------------------------- */
/* TYPES                                  */
/* -------------------------------------- */

interface SplitBill {
  splitId: string;
  code: string;
  description: string;
  participants: { name: string; pfp?: string }[];
  creator: string;
  totalAmount: number;
  perPersonAmount: number;
  remaining: number;
  debtors: number;
  paidCount: number;
  isSettled?: boolean;

  createdAt: string;
  token?: string;
  paid?: { address: string; name?: string }[];

  // ✅ NEW — from API
  userStatus?: "creator" | "participant" | "invited" | null;
  hasPaid?: boolean;
}

interface Room {
  gameId: string;
  members: { name: string; pfp: string }[];
  admin?: string;
  createdAt: string; // ✅ correct field
  name: string | null;
}

const getTokenSuffix = (token: string) => {
  switch (token) {
    case "USDC":
      return "$";
    case "EURC":
      return "€";
    case "ETH":
    case "WETH":
      return "Ξ";
    default:
      return "$";
  }
};

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();

  const [userRooms, setUserRooms] = useState<Room[]>([]);
  const [bills, setBills] = useState<SplitBill[]>([]);
  const [summary, setSummary] = useState<any>({
    billsCreated: 0,
    billsJoined: 0,
    billsPaid: 0,
    roomsCreated: 0,
    roomsJoined: 0,
    roomsPaid: 0,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);

  /* -------------------------------------- */
  /* API FETCHES                            */
  /* -------------------------------------- */

  const fetchUserRooms = useCallback(async () => {
    if (!address) return;
    const res = await fetch(`/api/user-rooms?address=${address}`);
    const data = await res.json();
    setUserRooms(data.rooms || []);
  }, [address]);

  const fetchUserBills = useCallback(async () => {
    if (!address) return;
    const res = await fetch(`/api/user-bills?address=${address}`);
    const data = await res.json();
    setBills(data.bills || []);
  }, [address]);

  /* LOAD EVERYTHING */
  useEffect(() => {
    if (!isConnected) return;

    (async () => {
      setIsLoading(true);
      await Promise.all([fetchUserRooms(), fetchUserBills()]);
      setIsLoading(false);
    })();
  }, [isConnected, fetchUserRooms, fetchUserBills]);

  /* LOAD USERNAME FROM FRAME CONTEXT */
  useEffect(() => {
    if (!username) {
      sdk.context.then((ctx) => setUsername(ctx.user?.username ?? null));
    }
  }, [username]);

  /* REFETCH WHEN TAB BECOMES VISIBLE */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && isConnected) {
        fetchUserRooms();
        fetchUserBills();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isConnected, fetchUserRooms, fetchUserBills]);

  /* -------------------------------------- */
  /* COMPUTED VALUES (FIXED)                */
  /* -------------------------------------- */

  // ✅ Correct unpaid logic (no creator, not paid)
  const unpaidCount = bills.filter(
    (b) => b.userStatus !== "creator" && b.hasPaid === false
  ).length;

  const paidCount = bills.filter(
    (b) => b.userStatus !== "creator" && b.hasPaid === true
  ).length;

  /* -------------------------------------- */
  /* CLIENT-SIDE SUMMARY (NEW)              */
  /* -------------------------------------- */

  useEffect(() => {
    if (!address) return;

    const nextSummary = {
      billsCreated: bills.filter((b) => b.userStatus === "creator").length,

      billsJoined: bills.filter((b) => b.userStatus === "participant").length,

      billsPaid: bills.filter((b) => b.hasPaid === true).length,

      roomsCreated: userRooms.filter(
        (r) => r.admin?.toLowerCase() === address.toLowerCase()
      ).length,

      roomsJoined: userRooms.length,

      roomsPaid: userRooms.reduce(
        (acc, r) => acc + (r.members?.length ? 1 : 0),
        0
      ),
    };

    setSummary(nextSummary);
  }, [address, bills, userRooms]);

  /* -------------------------------------- */
  /* RENDER                                 */
  /* -------------------------------------- */

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center">
        <Loader className="w-8 h-8 animate-spin text-white/40" />
      </div>
    );
  }

  const statClass = (value: number) =>
    `bg-white/5 p-4 rounded-xl ${value === 0 ? "opacity-30" : ""}`;

  return (
    <div className="min-h-screen w-full flex flex-col items-center p-4 pt-16 pb-40 overflow-y-auto scrollbar-hide">
      <div className="w-full max-w-md">
        {/* -------------------------------------- */}
        {/* SUMMARY GRID                            */}
        {/* -------------------------------------- */}
        <div className="grid grid-cols-2 gap-3 mb-10 mt-4">
          <div
            className={`${statClass(unpaidCount)} flex items-center justify-between`}
          >
            <p className="text-md text-white">Splits Pending</p>
            <p className="text-xl font-semibold">{unpaidCount}</p>
          </div>

          <div
            className={`${statClass(paidCount)} flex items-center justify-between`}
          >
            <p className="text-md text-white">Splits Paid</p>
            <p className="text-xl font-semibold">{paidCount}</p>
          </div>

          <div
            className={`${statClass(summary.roomsCreated)} flex items-center justify-between`}
          >
            <p className="text-md text-white">Spin Created</p>
            <p className="text-xl font-semibold">{summary.roomsCreated}</p>
          </div>

          <div
            className={`${statClass(summary.roomsPaid)} flex items-center justify-between`}
          >
            <p className="text-md text-white">Spin Paid</p>
            <p className="text-xl font-semibold">{summary.roomsPaid}</p>
          </div>
        </div>

        {/* -------------------------------------- */}
        {/* SPLIT BILLS                             */}
        {/* -------------------------------------- */}
        <p className="text-lg font-medium mb-4">Split Bills ({bills.length})</p>

        {bills.length === 0 ? (
          <div className="flex flex-col items-center text-center text-white/30 py-10">
            <img src="/vpeople.png" className="w-12 h-12 mb-1" />
            <p>No split bills yet…</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {bills.map((bill) => {
              const isCreator = bill.userStatus === "creator";
              const isInvited = bill.userStatus === "invited";
              const hasPaid = bill.hasPaid === true;

              return (
                <li
                  key={bill.splitId}
                  onClick={() => router.push(`/split/${bill.splitId}`)}
                  className="p-4 rounded-xl border border-white/10 hover:bg-white/5 active:scale-[0.98] transition cursor-pointer"
                >
                  <div className="flex justify-between">
                    {/* LEFT SIDE */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-1 w-full">
                        {/* LEFT SIDE: avatars + description */}
                        <div className="flex items-center gap-1 min-w-0">
                          {/* Description */}
                          <p className="text-md font-medium text-white/90 truncate max-w-[30vw] sm:max-w-[100px]">
                            {bill.description || "No description"}
                          </p>

                          {/* Avatars */}
                          <div className="flex -space-x-2 shrink-0">
                            {bill.participants.slice(0, 3).map((p, idx) => (
                              <img
                                key={idx}
                                src={
                                  p.pfp ||
                                  `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(
                                    p.name
                                  )}`
                                }
                                className="w-6 h-6 rounded-full border-2 border-background object-cover"
                              />
                            ))}

                            {bill.participants.length > 3 && (
                              <div className="w-6 h-6 flex items-center justify-center rounded-full bg-white/5 text-xs text-white/40 border-2 border-background">
                                +{bill.participants.length - 3}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* RIGHT SIDE: status */}
                        <div className="shrink-0">
                          {isCreator ? (
                            <span className="px-1.5 py-0.5 text-xs rounded-[6px] bg-yellow-600/20 text-yellow-300 border border-yellow-500/30">
                              Owner
                            </span>
                          ) : isInvited && !hasPaid ? (
                            <span className="px-1.5 py-0.5 text-xs rounded-[6px] bg-white/10 text-white/40 border border-white/20">
                              Invited
                            </span>
                          ) : hasPaid ? (
                            <span className="px-1.5 py-0.5 text-xs rounded-[6px] bg-green-500/20 text-green-300 border border-green-500/30">
                              Paid
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 text-xs rounded-[6px] bg-orange-900/20 text-orange-400 border border-orange-400/30">
                              Unpaid
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-white/30">
                        {new Date(bill.createdAt).toLocaleDateString(
                          undefined,
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }
                        )}
                      </p>
                    </div>

                    {/* RIGHT SIDE */}
                    <div className="text-right space-y-1">
                      <p className="text-lg font-semibold">
                        {getTokenSuffix(bill.token || "ETH")}
                        {bill.totalAmount}
                      </p>

                      <p
                        className={`text-xs ${
                          bill.debtors === 0
                            ? "text-white/40"
                            : bill.paidCount >= bill.debtors
                              ? "text-green-400"
                              : bill.paidCount > 0
                                ? "text-yellow-400"
                                : "text-red-400"
                        }`}
                      >
                        {bill.debtors === 0
                          ? "No payments"
                          : bill.paidCount >= bill.debtors
                            ? "Settled"
                            : `${bill.paidCount} / ${bill.debtors} paid`}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* -------------------------------------- */}
        {/* GROUPS (UNCHANGED)                     */}
        {/* -------------------------------------- */}
        <p className="text-lg font-medium mt-8 mb-4">
          Spins ({userRooms.length})
        </p>

        {userRooms.length === 0 ? (
          <div className="flex flex-col items-center text-center text-white/30 py-10">
            <img src="/vpush.png" className="w-12 h-12 mb-1" />
            <p>No pay spins yet…</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {userRooms.map((room) => {
              const isAdmin =
                address?.toLowerCase() === room.admin?.toLowerCase();

              return (
                <li
                  key={room.gameId}
                  onClick={() => router.push(`/game/${room.gameId}`)}
                  className="p-4 rounded-xl border border-white/10 hover:bg-white/5 transition cursor-pointer flex justify-between items-center"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-medium">{room.name}</p>
                      {isAdmin ? (
                        <span className="px-1.5 py-0.5 text-xs rounded-[6px] bg-yellow-600/20 text-yellow-300 border border-yellow-500/30">
                          Host
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-xs rounded-[6px] bg-white/10 text-white/40 border border-white/20">
                          Invited
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/30 mt-1">
                      {new Date(room.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>

                  <div className="flex -space-x-2">
                    {room.members.slice(0, 5).map((m, i) => (
                      <img
                        key={i}
                        src={
                          m.pfp ||
                          `https://api.dicebear.com/9.x/glass/svg?seed=${m.name}`
                        }
                        className="w-6 h-6 rounded-full"
                      />
                    ))}
                    {room.members.length > 5 && (
                      <div className="w-6 h-6 flex items-center justify-center rounded-full bg-white/5 text-xs text-white/40 border-2 border-background">
                        +{room.members.length - 5}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
