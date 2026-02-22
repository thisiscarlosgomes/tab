import * as React from "react";
import { cn } from "@/lib/cn";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-white/[0.08] border border-white/[0.04]",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
