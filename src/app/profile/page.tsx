"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";
import { ScrollText, BadgeDollarSign, Rows, Banknote } from "lucide-react";
import sdk from "@farcaster/frame-sdk";
import { Loader } from "lucide-react";
// import { Button } from "@/components/ui/button";

interface SplitBill {
  splitId: string;
  code: string;
  description: string;
  participants: { name: string; pfp?: string }[];
  creator: string;
  amount: number;
  people: number;
  createdAt: string;
  token?: string; // ✅ add this
}

interface Room {
  roomId: string;
  members: { name: string; pfp: string }[];
  admin?: string;
  created: string;
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();

  const [userRooms, setUserRooms] = useState<Room[]>([]);
  const [bills, setBills] = useState<SplitBill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  // const [copied, setCopied] = useState(false);

  const [summary, setSummary] = useState<{
    billsCreated: number;
    billsJoined: number;
    billsPaid: number;
    roomsCreated: number;
    roomsJoined: number;
    roomsPaid: number;
  }>({
    billsCreated: 0,
    billsJoined: 0,
    billsPaid: 0,
    roomsCreated: 0,
    roomsJoined: 0,
    roomsPaid: 0,
  });

  // Fetch user rooms
  const fetchUserRooms = useCallback(async () => {
    if (!address) return;
    setIsLoading(true);
    const res = await fetch(`/api/user-rooms?address=${address}`);
    const data = await res.json();
    setUserRooms(data.rooms || []);
  }, [address]);

  // Fetch user bills
  const fetchUserBills = useCallback(async () => {
    if (!address) return;
    const res = await fetch(`/api/user-bills?address=${address}`);
    const data = await res.json();
    setBills(data.bills || []);
    setIsLoading(false);
  }, [address]);

  useEffect(() => {
    if (isConnected) {
      fetchUserRooms();
      fetchUserBills();
      fetchActivity();
    }
  }, [isConnected, fetchUserRooms, fetchUserBills]);

  useEffect(() => {
    if (!username) {
      sdk.context.then((ctx) => {
        setUsername(ctx.user?.username ?? null);
      });
    }
  }, [username]);

  const fetchActivity = useCallback(async () => {
    if (!address) return;
    setIsLoading(true);
    const res = await fetch(`/api/activity?address=${address}`);
    const data = await res.json();
    setSummary(data.summary || {});

    setIsLoading(false);
  }, [address]);

  // Handle visibility change for refetching data
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

  // Handle copying the bill code
  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-16 pb-32 overflow-y-auto scrollbar-hide">
      <div className="mt-4 w-full max-w-md">
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="p-4 rounded-xl bg-blue-300 text-blue-800 flex items-center space-x-3 shadow-sm">
            <ScrollText className="w-7 h-7" />
            <div>
              <p className="text-sm text-blue-600">Splits Created</p>
              <p className="text-xl font-semibold">{summary.billsCreated}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-green-100 text-green-800 flex items-center space-x-3 shadow-sm">
            <BadgeDollarSign className="w-7 h-7" />
            <div>
              <p className="text-sm text-green-600">Splits Paid</p>
              <p className="text-xl font-semibold">{summary.billsPaid}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-purple-100 text-purple-800 flex items-center space-x-3 shadow-sm">
            <Rows className="w-7 h-7" />
            <div>
              <p className="text-sm text-purple-600">Tables Created</p>
              <p className="text-xl font-semibold">{summary.roomsCreated}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-pink-100 text-pink-800 flex items-center space-x-3 shadow-sm">
            <Banknote className="w-7 h-7" />
            <div>
              <p className="text-sm text-pink-600">Tables Settled</p>
              <p className="text-xl font-semibold">{summary.roomsPaid}</p>
            </div>
          </div>
        </div>

        {/* Rooms Section */}
        <p className="mb-4 mt-8 text-xl font-medium ml-2">Tables</p>
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center min-h-[10vh]">
            <Loader className="w-8 h-8 animate-spin text-white/30" />
          </div>
        ) : userRooms.length === 0 ? (
          <p className="text-white/30 text-center">
            No tables found. Join or create one!
          </p>
        ) : (
          <ul>
            {userRooms.map(({ roomId, members, admin, created }) => {
              const isUserAdmin =
                address?.toLowerCase() === admin?.toLowerCase();

              return (
                <li
                  key={roomId}
                  className="mb-4 w-full p-4 border rounded-xl flex justify-between items-center cursor-pointer hover:bg-white/5 transition"
                  onClick={() => router.push(`/game/${roomId}`)}
                >
                  {/* Left side – Room info */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-medium text-white">
                        #{roomId}
                      </p>
                      {isUserAdmin && (
                        <span className="text-xs text-violet-400 bg-violet-900/30 px-2 py-0.5 rounded-md">
                          admin
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-white/20">
                      {new Date(created).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center">
                    <div className="flex -space-x-2">
                      {members.slice(0, 5).map((member, index) => (
                        <img
                          key={index}
                          src={
                            member.pfp ||
                            `https://api.dicebear.com/9.x/glass/svg?seed=${member.name}`
                          }
                          alt={member.name}
                          className="w-6 h-6 rounded-full border-2 border-background object-cover"
                        />
                      ))}
                      {members.length > 5 && (
                        <span className="w-6 h-6 flex items-center justify-center rounded-full bg-card text-xs text-white/30 border-2 border-card">
                          +{members.length - 5}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Bills Section */}
        <p className="mb-4 mt-8 text-xl font-medium ml-2">Splits</p>
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center min-h-[10vh]">
            <Loader className="w-8 h-8 animate-spin text-white/30" />
          </div>
        ) : bills.length === 0 ? (
          <p className="text-white/30 text-center">No bills yet.</p>
        ) : (
          <ul>
            {bills.map(
              ({
                splitId,
                code,
                description,
                creator,
                amount,
                people,
                createdAt,
                token,
              }) => {
                const isOwner =
                  creator.toLowerCase() === address?.toLowerCase();
                return (
                  <li
                    key={splitId}
                    className="mb-4 w-full p-4 border rounded-xl flex flex-col gap-2 cursor-pointer hover:bg-white/5 transition"
                    onClick={() => router.push(`/split/${splitId}`)}
                  >
                    {/* Top row: left and right aligned */}
                    <div className="flex justify-between w-full items-start">
                      {/* Left: name + date */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-lg font-medium capitalize text-white truncate overflow-hidden whitespace-nowrap max-w-[100px]">
                            {description || "No description"}
                          </p>

                          {isOwner && (
                            <span className="text-xs text-violet-400 bg-violet-900/30 px-2 py-0.5 rounded-md">
                              admin
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-white/30">
                          {new Date(createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      </div>

                      {/* Right: amount + people */}
                      <div className="text-right space-y-1">
                        <p className="text-lg text-primary font-medium">
                          {amount} {token ?? "ETH"}
                        </p>
                        <p className="text-sm text-white/30">
                          Split by {people} people
                        </p>
                      </div>
                    </div>

                    {/* Copy code button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.nativeEvent.stopImmediatePropagation(); // prevents hover styles
                        handleCopy(code);
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                      }}
                      className="hidden text-base text-primary bg-white/5 p-4 w-full rounded-lg hover:bg-white/10 transition"
                    >
                      {copiedCode === code ? "Copied!" : `Copy Code`}
                    </button>
                  </li>
                );
              }
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
