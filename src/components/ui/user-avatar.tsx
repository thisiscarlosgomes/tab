"use client";

import { ImgHTMLAttributes, useEffect, useMemo, useState } from "react";
import { getDicebearAvatar, getOptimizedAvatarUrl } from "@/lib/avatar";

type UserAvatarProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string | null;
  seed?: string | number | null;
  width?: number;
};

export function UserAvatar({
  src,
  seed,
  width,
  alt = "User avatar",
  onError,
  ...props
}: UserAvatarProps) {
  const fallbackSrc = useMemo(() => getDicebearAvatar(seed), [seed]);
  const optimizedSrc = useMemo(
    () => getOptimizedAvatarUrl(src, width) ?? fallbackSrc,
    [src, width, fallbackSrc]
  );
  const sourceChain = useMemo(() => {
    const rawSrc = src?.trim() || "";
    return [optimizedSrc, rawSrc, fallbackSrc].filter(
      (value, index, all) => Boolean(value) && all.indexOf(value) === index
    );
  }, [optimizedSrc, src, fallbackSrc]);

  const [sourceIndex, setSourceIndex] = useState(0);
  const resolvedSrc = sourceChain[sourceIndex] ?? fallbackSrc;

  useEffect(() => {
    setSourceIndex(0);
  }, [sourceChain]);

  return (
    <img
      {...props}
      src={resolvedSrc}
      alt={alt}
      onError={(event) => {
        if (sourceIndex < sourceChain.length - 1) {
          setSourceIndex(sourceIndex + 1);
        }
        onError?.(event);
      }}
    />
  );
}
