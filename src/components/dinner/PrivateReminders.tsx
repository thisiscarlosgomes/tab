"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { reminderSchema, Reminder } from "@/lib/dinner/agent/model";
import { useDinner } from "./DinnerShell";
export function PrivateReminders() {
  const { api, me } = useDinner();
  const [items, setItems] = useState<Reminder[]>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setItems(await api("/agent/reminders", {}, z.array(reminderSchema)));
      setError("");
    } catch {
      setError(
        "Private reminders could not refresh. Your room chat is still available.",
      );
    }
  }, [api]);
  useEffect(() => {
    if (!me) return;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10000);
    return () => clearInterval(timer);
  }, [me, refresh]);
  async function dismiss(id: string) {
    try {
      await api(`/agent/reminders/${id}`, { method: "DELETE" }, reminderSchema);
      await refresh();
    } catch {
      setError("Could not dismiss. Retry safely.");
    }
  }
  return (
    <section className="dinner-card">
      <h2>Just for you</h2>
      <p className="dinner-note">
        Private reminders appear here when you open Tab, in your device’s time
        zone. No push or background money action.
      </p>
      {error && (
        <p role="status" className="dinner-error">
          {error}
        </p>
      )}
      {items.length ? (
        items.map((item) => (
          <div className="dinner-event" key={item.id}>
            <div>
              <h3>
                {Date.parse(item.dueAt) <= Date.now()
                  ? "Due now · "
                  : "Upcoming · "}
                {item.text}
              </h3>
              <p className="dinner-note">
                {new Date(item.dueAt).toLocaleString()}
              </p>
              <div className="dinner-actions">
                <Link href={`/app/rooms/${item.roomId}?view=plan`}>
                  Open room ↗
                </Link>
                <button
                  className="dinner-quiet dinner-small"
                  onClick={() => void dismiss(item.id)}
                >
                  Dismiss reminder
                </button>
              </div>
            </div>
          </div>
        ))
      ) : (
        <p className="dinner-note">
          Create a private reminder in a room’s Plan view.
        </p>
      )}
    </section>
  );
}
