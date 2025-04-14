"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";

export default function RoomsPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();

  const [userRooms, setUserRooms] = useState<
    {
      roomId: string;
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
      <h1 className="text-2xl font-bold mb-4">Your Tables</h1>

      {isLoading ? (
        <p className="text-white/30">Loading tables...</p>
      ) : userRooms.length === 0 ? (
        <p className="text-white/30">No tables found. Join or create one!</p>
      ) : (
        userRooms.map(({ roomId, members, admin }) => {
          const isUserAdmin = address?.toLowerCase() === admin?.toLowerCase();

          return (
            <li
              key={roomId}
              className="mb-4 w-full max-w-md p-3 border rounded-lg flex flex-col items-center cursor-pointer hover:bg-white/5"
              onClick={() => router.push(`/game/${roomId}`)}
            >
              <div className="flex items-center gap-2">
                <p className="text-lg font-medium">#{roomId}</p>
                {isUserAdmin && (
                  <span className="text-xs text-violet-400 bg-violet-900/30 px-2 py-0.5 rounded-md">
                    admin
                  </span>
                )}
              </div>

              <div className="flex -space-x-2 mt-2 mb-1">
                {members.slice(0, 5).map((member, index) => (
                  <img
                    key={index}
                    src={
                      member.pfp ||
                      `https://api.dicebear.com/9.x/glass/svg?seed=${member.name}`
                    }
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
