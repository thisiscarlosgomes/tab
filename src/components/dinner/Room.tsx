"use client";
import { PlanProposalReview } from "./PlanProposalCards";
import { Plans } from "./Plans";
import { PageSkeleton } from "./PageSkeleton";
import { RoomPlan } from "./Coordination";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { roomSchema } from "@/lib/dinner/client-schema";
import { RoomView, DinnerError } from "@/lib/dinner/model";
import { useDinner } from "./DinnerShell";
import { Chat } from "./Chat";
import { Money, OutingMoney } from "./Money";
import { Members } from "./Members";

export function Room({ id }: { id: string }) {
  const { api, me } = useDinner();
  const [room, setRoom] = useState<RoomView | null>(null);
  const router = useRouter();
  const search = useSearchParams();
  const requestedView = search.get("view") ?? "conversation";
  const view = ["conversation", "money", "members", "plan"].includes(
    requestedView,
  )
    ? requestedView
    : "conversation";
  const setView = (next: string) =>
    router.push(`/app/rooms/${id}?view=${next}`);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const value = await api(`/rooms/${id}`, {}, roomSchema);
      setRoom((current) =>
        current && current.revision > value.revision ? current : value,
      );
      setError("");
    } catch (e) {
      if (e instanceof DinnerError && [401, 403, 404].includes(e.status))
        setRoom(null);
      setError(e instanceof Error ? e.message : "Could not refresh room");
    }
  }, [api, id]);
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
    <div className="dinner-room-page">
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
        !error && <PageSkeleton chat />
      ) : (
        <>
          <header className="dinner-room-header">
            <div className="dinner-room-title">
              <h1>{room.name}</h1>
              <p className="dinner-note" title={room.purpose}>
                {room.members.length} people · {room.purpose}
              </p>
            </div>
            <div className="dinner-tabs" role="tablist" aria-label="Room views">
              {["conversation", "money", "members", "plan"].map(
                (tab, index, tabs) => (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={view === tab}
                    tabIndex={view === tab ? 0 : -1}
                    aria-controls={`panel-${tab}`}
                    id={`tab-${tab}`}
                    onClick={() => setView(tab)}
                    onKeyDown={(event) => {
                      const next =
                        event.key === "ArrowRight"
                          ? (index + 1) % tabs.length
                          : event.key === "ArrowLeft"
                            ? (index + tabs.length - 1) % tabs.length
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? tabs.length - 1
                                : null;
                      if (next !== null) {
                        event.preventDefault();
                        setView(tabs[next]);
                        document.getElementById(`tab-${tabs[next]}`)?.focus();
                      }
                    }}
                  >
                    {tab === "conversation"
                      ? "Chat"
                      : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ),
              )}
            </div>
          </header>
          <div
            className={`dinner-room-panel${view === "conversation" ? " is-chat" : ""}`}
            role="tabpanel"
            id={`panel-${view}`}
            aria-labelledby={`tab-${view}`}
          >
            {view === "conversation" ? (
              <Chat key={room.id} room={room} refresh={refresh} />
            ) : view === "money" ? (
              search.get("fromPlan") ? (
                <OutingMoney
                  key={search.get("fromPlan")}
                  room={room}
                  refresh={refresh}
                  planId={search.get("fromPlan")!}
                />
              ) : (
                <Money room={room} refresh={refresh} />
              )
            ) : view === "plan" ? (
              <div className="dinner-stack">
                {search.get("proposal") ? (
                  <PlanProposalReview
                    room={room}
                    id={search.get("proposal")!}
                  />
                ) : (
                  <Plans
                    key={`${room.id}-${search.get("plan") ?? "all"}`}
                    room={room}
                  />
                )}
                <RoomPlan roomId={room.id} />
              </div>
            ) : (
              <Members room={room} refresh={refresh} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
