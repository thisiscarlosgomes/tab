"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { JoinRoomDrawer } from "@/components/app/joinRoomDrawer";
import sdk from "@farcaster/frame-sdk";
import { useAddPoints } from "@/lib/useAddPoints"; // make sure the import is correct

export default function SplitPage() {
  const { address, isConnected } = useAccount();
  const [roomToCreate, setRoomToCreate] = useState("");
  const [roomToJoin, setRoomToJoin] = useState("");
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [showJoinDrawer, setShowJoinDrawer] = useState(false);
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

  const buildPlayer = async () => {
    const context = await sdk.context;
    const name = context.user?.username ?? address?.slice(0, 6);
    const pfp = context.user?.pfpUrl;
    const fid = context.user?.fid;
    return { name, address, pfp, fid };
  };

  const handleCreateRoom = async () => {
    if (!roomToCreate || !isConnected || !address) return;
    setCreating(true); // ⏳ start loading

    const normalizedRoom = roomToCreate.toLowerCase();
    const res = await fetch(`/api/game/${normalizedRoom}`, { method: "GET" });

    if (res.ok) {
      setCreateError("Room with this name already exists.");
      setCreating(false); // ❌ stop loading if error
      return;
    }

    const player = await buildPlayer();

    await fetch(`/api/game/${normalizedRoom}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player }),
    });

    // 🪙 Give points for creating a room
    await useAddPoints(address, "create_tab", normalizedRoom);

    router.push(`/game/${normalizedRoom}`);
  };

  // const handleJoinRoom = async () => {
  //   if (!roomToJoin || !isConnected || !address) return;
  //   const player = await buildPlayer();
  //   const normalizedRoom = roomToJoin.toLowerCase();
  //   const res = await fetch(`/api/game/${normalizedRoom}`, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ player }),
  //   });

  //   await useAddPoints(address, "invite", normalizedRoom);

  //   if (res.ok) {
  //     router.push(`/game/${normalizedRoom}`);
  //   } else {
  //     const data = await res.json();
  //     setJoinError(data?.error || "Failed to join room");
  //   }
  // };

  const handleJoinRoom = async () => {
    if (!roomToJoin || !isConnected || !address) return;
    setJoining(true); // ⏳ start loading

    const player = await buildPlayer();
    const normalizedRoom = roomToJoin.toLowerCase();
    const res = await fetch(`/api/game/${normalizedRoom}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player }),
    });

    // await useAddPoints(address, "invite", normalizedRoom);

    if (res.ok) {
      router.push(`/game/${normalizedRoom}`);
    } else {
      const data = await res.json();
      setJoinError(data?.error || "Failed to join room");
      setJoining(false); // ❌ stop loading only if error
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center pb-24">
      <div className="w-full max-w-md p-6 flex flex-col space-y-4 rounded-lg">
        <div className="flex flex-col items-center mb-4 mt-2 text-center">
          <img
            src="/pl.png"
            alt="cover"
            className="w-24 h-24 animate-slowSpin"
          />
          <h1 className="text-2xl font-bold mb-2">New Pay Roulette</h1>
          <p className="text-white/40 px-2">
            Spin the table. One person pays. <br />
            It’s random and fun.
          </p>
        </div>

        {/* Create Room */}
        <div className="w-full max-w-md space-y-4 mb-6">
          <input
            type="text"
            placeholder="table name"
            value={roomToCreate}
            onChange={(e) => setRoomToCreate(e.target.value)}
            className="placeholder-white/20 w-full p-4 rounded-lg text-white bg-white/5"
          />
          <Button
            onClick={handleCreateRoom}
            disabled={!isConnected || !roomToCreate || creating}
            className="w-full bg-primary"
          >
            {creating ? "Creating..." : "Create"}
          </Button>

          {createError && <p className="text-sm text-red-500">{createError}</p>}
        </div>

        {/* Join Room */}
        <div className="w-full max-w-md space-y-4">
          <Button
            onClick={() => setShowJoinDrawer(true)}
            className="w-full bg-secondary text-white"
          >
            Join with code
          </Button>
        </div>

        <JoinRoomDrawer
          open={showJoinDrawer}
          onClose={() => setShowJoinDrawer(false)}
          roomToJoin={roomToJoin}
          setRoomToJoin={setRoomToJoin}
          onJoin={handleJoinRoom}
          error={joinError}
          joining={joining} // ✅ pass state
        />
      </div>
    </div>
  );
}
