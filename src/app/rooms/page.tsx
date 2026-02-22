"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/user-avatar";

export default function RoomsPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();

  const [userRooms, setUserRooms] = useState<
    {
      gameId: string;
      members: { name: string; pfp: string }[];
      admin?: string;
    }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);

  // ✅ Move fetch logic out so it's reusable
  const fetchUserRooms = useCallback(async () => {
    if (!address) return;

    setIsLoading(true);
    const res = await fetch(`/api/user-rooms?address=${address}`);
    const data = await res.json();
    setUserRooms(data.rooms || []);
    setIsLoading(false);
  }, [address]);

  // 🔄 Initial fetch on mount
  useEffect(() => {
    if (isConnected) {
      fetchUserRooms();
    }
  }, [isConnected, fetchUserRooms]);

  // 🔁 Refetch when user comes back to the tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isConnected) {
        fetchUserRooms();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isConnected, fetchUserRooms]);

  return (
    <main className="w-full min-h-screen flex flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-bold mb-2">Spin Groups</h1>

      {isLoading ? (
        <ul className="w-full max-w-md space-y-4 mt-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <li
              key={idx}
              className="w-full p-3 border rounded-lg border-white/10 flex flex-col items-center"
            >
              <Skeleton className="h-5 w-40 mb-3" />
              <div className="flex -space-x-2 mt-1 mb-2">
                {Array.from({ length: 4 }).map((__, avatarIdx) => (
                  <Skeleton key={avatarIdx} className="w-8 h-8 rounded-full" />
                ))}
              </div>
              <Skeleton className="h-4 w-24" />
            </li>
          ))}
        </ul>
      ) : userRooms.length === 0 ? (
        <p className="text-white/30">No groups found. Join or create one!</p>
      ) : (
        userRooms.map(({ gameId, members, admin }) => {
          const isUserAdmin = address?.toLowerCase() === admin?.toLowerCase();

          return (
            <li
              key={gameId}
              className="mb-4 w-full max-w-md p-3 border rounded-lg flex flex-col items-center cursor-pointer hover:bg-white/5"
              onClick={() => router.push(`/game/${gameId}`)}
            >
              <div className="flex items-center gap-2">
                <p className="text-lg font-medium">#{gameId}</p>
                {isUserAdmin && (
                  <span className="text-xs text-violet-400 bg-violet-900/30 px-2 py-0.5 rounded-md">
                    Host
                  </span>
                )}
              </div>

              <div className="flex -space-x-2 mt-2 mb-1">
                {members.slice(0, 5).map((member, index) => (
                  <UserAvatar
                    key={index}
                    src={member.pfp}
                    seed={member.name}
                    width={32}
                    alt={member.name}
                    className="w-8 h-8 rounded-full border-2 border-white object-cover"
                  />
                ))}
                {members.length > 5 && (
                  <span className="w-8 h-8 flex items-center justify-center rounded-full bg-muted text-xs text-foreground border-2 border-white">
                    +{members.length - 5}
                  </span>
                )}
              </div>

              <p className="text-sm text-white/30">{members.length} members</p>
            </li>
          );
        })
      )}
    </main>
  );
}
