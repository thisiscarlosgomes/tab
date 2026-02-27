"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

export function InlineTabAssistant() {
  const router = useRouter();
  const pathname = usePathname();

  if (pathname?.startsWith("/assistant")) return null;

  return (
    <button
      type="button"
      onClick={() => router.push("/assistant")}
      className={cn(
        "fixed z-40 bottom-24 right-4 md:bottom-6 md:right-6",
        "h-12 pl-2 pe-4 rounded-full border border-black/10 bg-white/90 backdrop-blur",
        "shadow-[0_12px_30px_rgba(0,0,0,0.35)] inline-flex items-center"
      )}
      aria-label="Open Tab Assistant"
    >
      <img
        src="/ping.svg"
        alt=""
        aria-hidden="true"
        className="h-10 w-10 animate-pulse"
      />
      <span className="text-sm font-medium text-black">Ask Ping</span>
    </button>
  );
}
