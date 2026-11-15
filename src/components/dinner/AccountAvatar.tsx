"use client";
import { useState } from "react";
import { UserRound } from "lucide-react";
export function AccountAvatar({ src }: { src?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="dinner-profile-avatar" aria-hidden="true">
      {src && failed !== src ? (
        <img src={src} alt="" onError={() => setFailed(src)} />
      ) : (
        <UserRound size={22} />
      )}
    </span>
  );
}
