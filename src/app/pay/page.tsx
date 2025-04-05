"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useSendDrawer } from "@/providers/SendDrawerProvider";

export default function PayPage() {
  const searchParams = useSearchParams();
  const username = searchParams.get("username");
  const { open, setQuery } = useSendDrawer();

  useEffect(() => {
    if (username) {
      setQuery(username); // pre-fill input
      open();             // open the drawer
    }
  }, [username, open, setQuery]);

  return (
    <div className="h-screen w-full bg-background flex items-center justify-center text-white/50 text-sm">
      Opening payment drawer for <span className="text-white ml-1 font-medium">@{username}</span>...
    </div>
  );
}
