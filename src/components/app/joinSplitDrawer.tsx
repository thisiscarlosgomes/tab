"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";

export function SplitJoinDrawer() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(""); // ✅ New error state
  const router = useRouter();

  const handleSearch = async () => {
    setIsSearching(true);
    setError(""); // Reset error

    try {
      const res = await fetch(`/api/split/code/${code.trim().toLowerCase()}`);
      const data = await res.json();

      if (res.ok && data.splitId) {
        router.push(`/split/${data.splitId}`);
        setOpen(false); // Close drawer on success
      } else {
        setError("Bill not found. Please double check the code.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="w-full bg-secondary text-white"
      >
       Join with code
      </Button>

      <Drawer.Root open={open} onOpenChange={setOpen} repositionInputs={false}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-[#4E4C52]/60 backdrop-blur-[7.5px] z-20" />
          <Drawer.Content className="z-30 bg-background flex flex-col rounded-t-[32px] mt-24 h-fit fixed bottom-0 left-0 right-0 outline-none">
            <Drawer.Title className="text-lg font-normal text-center mt-6">
              Enter Code
              <p className="text-base mt-1 text-white/50">Need a code? Hit up the split creator</p>
            </Drawer.Title>

            <div className="p-6 space-y-4">
              <div className="max-w-md mx-auto text-sm space-y-4">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. pizza-x3df"
                  className="placeholder-white/20 w-full p-4 rounded-lg text-white bg-white/5 text-base"
                />

                <Button
                  onClick={handleSearch}
                  disabled={isSearching || !code.trim()}
                  className="w-full bg-primary text-primary-foreground"
                >
                  {isSearching ? "Searching..." : "Join"}
                </Button>

                {error && (
                  <p className="text-red-500 text-center text-sm">{error}</p>
                )}
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
