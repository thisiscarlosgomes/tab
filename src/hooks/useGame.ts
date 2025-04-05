import { useEffect, useState } from "react";

interface Player {
  name: string;
  address: string;
  pfp?: string;
}
interface Paid {
  address: string;
  name: string;
  txHash: string;
}

interface GameState {
  gameId: string;
  participants: Player[];
  admin: string;
  recipient: string;
  amount: number;
  chosen: Player | null;
  adminOnlySpin: boolean;
  paid?: Paid[];
  createdAt?: string; // ✅ Add this line to capture timestamp
}


export function useGame(roomId: string, pollInterval = 3000) {
  const [game, setGame] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchGame = async () => {
    try {
      const res = await fetch(`/api/game/${roomId}`);
      const data = await res.json();
      setGame(data);
    } catch {
      // silently fail
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchGame();
    const interval = setInterval(fetchGame, pollInterval);
    return () => clearInterval(interval);
  }, [roomId, pollInterval]);

  return { game, isLoading, refresh: fetchGame };
}
