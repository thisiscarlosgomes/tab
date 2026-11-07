"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { roomSchema } from "@/lib/dinner/client-schema";
import { RoomView } from "@/lib/dinner/model";
import { useDinner } from "./DinnerShell";
import { Chat } from "./Chat";
import { Money } from "./Money";
import { Members } from "./Members";

export function Room({ id }: { id: string }) {
  const { api, me } = useDinner();
  const [room, setRoom] = useState<RoomView | null>(null);
  const [view, setView] = useState("conversation");
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState("");
  const refresh = useCallback(async () => {
    try {
      const value = await api(`/rooms/${id}`, {}, roomSchema);
      setRoom((current) =>
        current && current.revision > value.revision ? current : value,
      );
      setError("");
      setLastSync(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh room");
    }
  }, [api, id]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "money")
      setView("money");
  }, []);
  useEffect(() => {
    if (!me) return;
    void refresh();
    const sync = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(sync, 3000);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [me, refresh]);
  return (
    <>
      <Link className="dinner-back" href="/app/rooms">
        ← All rooms
      </Link>
      {error && (
        <div className="dinner-error" role="alert">
          {error}
          {room
            ? " Your last saved conversation is still here. Reconnecting…"
            : ""}
          <button className="dinner-small" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      {!room ? (
        !error && <p role="status">Opening your room…</p>
      ) : (
        <>
          <div className="dinner-heading">
            <div>
              <p className="dinner-eyebrow">
                Your room · {room.members.length}{" "}
                {room.members.length === 1 ? "person" : "people"}
              </p>
              <h1>{room.name}</h1>
              <p className="dinner-muted">{room.purpose}</p>
            </div>
            <div className="dinner-note">
              {lastSync && !error
                ? "Saved conversation · checks every 3 seconds"
                : "Reconnecting"}
            </div>
          </div>
          <div className="dinner-tabs" role="tablist" aria-label="Room views">
            {["conversation", "money", "members"].map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={view === tab}
                aria-controls={`panel-${tab}`}
                id={`tab-${tab}`}
                onClick={() => setView(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`panel-${view}`}
            aria-labelledby={`tab-${view}`}
          >
            {view === "conversation" ? (
              <div className="dinner-grid">
                <Chat key={room.id} room={room} refresh={refresh} />
                <aside className="dinner-stack">
                  <section className="dinner-card soft">
                    <p className="dinner-eyebrow">From the plan to the split</p>
                    <h2>Keep it simple.</h2>
                    <p className="dinner-note">
                      Talk here. Add your dinner expense in Money. Bring the
                      same people back next time.
                    </p>
                    <button
                      className="dinner-quiet"
                      onClick={() => setView("money")}
                    >
                      Open shared expenses ↗
                    </button>
                  </section>
                  <section className="dinner-card">
                    <h3>Good company. Clear boundaries.</h3>
                    <p className="dinner-note">
                      No money is held or moved here. Expense records are
                      obligations, never payment approvals. Ordinary chat stays
                      ordinary chat.
                    </p>
                    <button
                      className="dinner-small dinner-quiet"
                      onClick={() => setView("members")}
                    >
                      Invite a friend
                    </button>
                  </section>
                </aside>
              </div>
            ) : view === "money" ? (
              <Money room={room} refresh={refresh} />
            ) : (
              <Members room={room} refresh={refresh} />
            )}
          </div>
        </>
      )}
    </>
  );
}
