import { applyCloudflarePath } from "@/lib/images";

export function getDicebearAvatar(seed?: string | number | null) {
  const safeSeed =
    typeof seed === "number" ? String(seed) : (seed?.trim() ?? "anon");
  return `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(safeSeed || "anon")}`;
}

export function getOptimizedAvatarUrl(
  src: string | null | undefined,
  width?: number
) {
  if (!src) return null;
  if (!width) return src;
  return applyCloudflarePath({ url: src, width }) ?? src;
}

