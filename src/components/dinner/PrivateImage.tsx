"use client";
import { useEffect, useState } from "react";
import { useDinner } from "./DinnerShell";
export function PrivateImage({ roomId, id }: { roomId: string; id: string }) {
  const { image } = useDinner();
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void image(`/rooms/${roomId}/attachments/${id}`)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image, roomId, id]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img
        className="dinner-image"
        src={url}
        alt="Private image or receipt shared in this room"
      />
    </a>
  ) : (
    <span className="dinner-note">
      {failed
        ? "Image unavailable. Refresh to retry."
        : "Loading private image…"}
    </span>
  );
}
