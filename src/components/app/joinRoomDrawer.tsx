"use client";

import { Drawer } from "vaul";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

export function JoinRoomDrawer({
  open,
  onClose,
  roomToJoin,
  setRoomToJoin,
  onJoin,
  joining,

  error,
}: {
  open: boolean;
  onClose: () => void;
  roomToJoin: string;
  setRoomToJoin: (v: string) => void;
  onJoin: () => void;
  error: string;
  joining: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // ✅ Auto-focus input when drawer opens
  useEffect(() => {
    if (open && inputRef.current) {
      // slight delay helps with mobile keyboard pop
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [open]);

  return (
    <Drawer.Root open={open} onClose={onClose} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-[7.5px] z-20" />
        <Drawer.Content className="z-30 bg-background flex flex-col rounded-t-[32px] mt-24 h-fit fixed bottom-0 left-0 right-0 outline-none">
          <Drawer.Title className="text-lg font-normal text-center mt-6">
            Table Name
            <p className="text-base mt-1 text-white/50">Same as shared by table creator</p>
          </Drawer.Title>

          <div className="p-6 space-y-4 rounded-t-[10px] flex-1 space-y-4">
            <div className="max-w-md mx-auto text-sm space-y-4">
              <input
                ref={inputRef}
                type="text"
                placeholder="name"
                value={roomToJoin}
                onChange={(e) => setRoomToJoin(e.target.value)}
                className="placeholder-white/20 w-full p-4 rounded-lg text-white bg-white/5 text-base"
              />

              <Button
                onClick={onJoin}
                disabled={!roomToJoin || joining}
                className="w-full bg-primary text-primary-foreground"
              >
                {joining ? "Joining..." : "Join"}
              </Button>

              {error && (
                <p className="text-sm text-red-500 text-center">{error}</p>
              )}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
