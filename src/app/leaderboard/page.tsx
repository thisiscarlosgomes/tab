"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/user-avatar";

interface Spender {
  address: string;
  username: string;
  displayName?: string;
  pfp?: string;
  totalSpent: number;
  fid: number;
}

export default function LeaderboardPage() {
  const { address } = useAccount();
  const [leaders, setLeaders] = useState<Spender[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchLeaders = async () => {
      setIsLoading(true);
      const res = await fetch("/api/spenders");
      const data = await res.json();

      const allLeaders: Spender[] = data.leaders || [];

      if (address) {
        const currentUserIndex = allLeaders.findIndex(
          (u) => u.address.toLowerCase() === address.toLowerCase()
        );

        if (currentUserIndex > -1) {
          const currentUser = allLeaders.splice(currentUserIndex, 1)[0];
          allLeaders.unshift(currentUser); // move to top
        }
      }

      setLeaders(allLeaders);
      setIsLoading(false);
    };

    fetchLeaders();
  }, [address]);

  function getOrdinal(n: number) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start p-4 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(8rem+env(safe-area-inset-bottom))] overflow-y-auto scrollbar-hide">
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold mb-4">Top Spenders</h1>
        {isLoading ? (
          <ul className="space-y-1">
            {Array.from({ length: 8 }).map((_, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between rounded-lg px-4 py-2 bg-white/5"
              >
                <div className="flex items-center space-x-3">
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="w-8 h-8 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-4 w-12" />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-1">
          {leaders.map((user, index) => {
            const isCurrentUser =
              address?.toLowerCase() === user.address.toLowerCase();
        
            const rankColor =
              index === 0
                ? "text-green-400"
                : index === 1
                ? "text-orange-400"
                : index === 2
                ? "text-yellow-400"
                : "text-white/30";
        
            return (
              <li
                key={user.address}
                className={`flex items-center justify-between rounded-lg px-4 py-2 ${
                  isCurrentUser
                    ? "bg-primary/10 border border-primary"
                    : "bg-white/5"
                }`}
              >
                <div className="flex items-center space-x-3">
                  <span className={`font-medium w-8 text-left ${rankColor}`}>
                    {getOrdinal(index + 1)}
                  </span>
                  <UserAvatar
                    src={user.pfp}
                    seed={user.username}
                    width={32}
                    alt={user.username}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                  <span
                    className={`text-white font-medium truncate max-w-[120px] ${
                      isCurrentUser ? "text-primary" : ""
                    }`}
                  >
                    @{user.username}
                  </span>
                </div>
                <div className="hidden text-right text-primary font-semibold">
                  {user.totalSpent.toFixed(2)}
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
