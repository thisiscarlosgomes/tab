"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { usd } from "@/lib/dinner/model";
import { useDinner } from "./DinnerShell";
export const walletSchema = z.object({
  availableUsdCents: z.null(),
  availableLabel: z.string(),
  owe: z.number().int(),
  owed: z.number().int(),
  balances: z.array(
    z.object({
      roomId: z.string(),
      hasRoomAccess: z.boolean().optional(),
      name: z.string(),
      owe: z.number().int(),
      owed: z.number().int(),
    }),
  ),
  pending: z.array(
    z.object({
      roomId: z.string(),
      reportId: z.string(),
      hasRoomAccess: z.boolean().optional(),
      cents: z.number().int(),
      needsConfirmation: z.boolean(),
      recipient: z.string(),
    }),
  ),
});
export function Wallet() {
  const { api, me } = useDinner();
  const [value, setValue] = useState<z.infer<typeof walletSchema> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!me) return;
    let active = true;
    async function refresh() {
      try {
        const next = await api("/wallet", {}, walletSchema);
        if (active) {
          setValue(next);
          setError("");
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load your money home",
          );
      }
    }
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, me]);
  return (
    <>
      <p className="dinner-eyebrow">Your money, clearly</p>
      <h1>Wallet</h1>
      <p className="dinner-muted">
        Manage your shared tab without confusing a promise with cash.
      </p>
      {error && (
        <p className="dinner-error" role="alert">
          {error}
        </p>
      )}
      {value ? (
        <div className="dinner-grid">
          <div className="dinner-stack">
            <section className="dinner-card soft">
              <p className="dinner-eyebrow">Available</p>
              <h2>Not connected</h2>
              <p>
                {value.availableLabel}. This page does not hold money or show a
                spendable USD cash balance.
              </p>
              <div className="dinner-actions">
                <button disabled>Add money · rails not ready</button>
                <button disabled>Withdraw · rails not ready</button>
              </div>
              <p className="dinner-note">
                No deposit, withdrawal, custody or in-app payment is available
                in this beta. Legacy crypto portfolio values are not represented
                as available USD here.
              </p>
            </section>
            <section className="dinner-card">
              <div className="dinner-money-row">
                <div>
                  <p>You owe</p>
                  <strong className="dinner-amount">{usd(value.owe)}</strong>
                </div>
                <div>
                  <p>Owed to you</p>
                  <strong className="dinner-amount">{usd(value.owed)}</strong>
                </div>
              </div>
              <p className="dinner-note">
                Outstanding obligations only. Pending outside reports are
                already included, not additional money.
              </p>
              {value.balances.map((room) =>
                room.hasRoomAccess === false ? (
                  <div className="dinner-room-row" key={room.roomId}>
                    <div>
                      <h3>{room.name} · former room</h3>
                      <p>
                        You owe {usd(room.owe)} · Owed to you {usd(room.owed)}
                      </p>
                      <p className="dinner-note">
                        Room access ended. These obligations remain; contact the
                        room owner to coordinate corrections or outside reports.
                      </p>
                    </div>
                  </div>
                ) : (
                  <Link
                    className="dinner-room-row"
                    href={`/app/rooms/${room.roomId}?view=money`}
                    key={room.roomId}
                  >
                    <div>
                      <h3>{room.name}</h3>
                      <p className="dinner-note">
                        You owe {usd(room.owe)} · Owed to you {usd(room.owed)}
                      </p>
                    </div>
                    <span>Review ↗</span>
                  </Link>
                ),
              )}
            </section>
          </div>
          <aside className="dinner-card">
            <h2>Outside reports</h2>
            {value.pending.length ? (
              value.pending.map((p) =>
                p.hasRoomAccess === false ? (
                  <div className="dinner-event" key={p.reportId}>
                    <p>
                      Reported paid outside Tab · {usd(p.cents)} · awaiting{" "}
                      {p.recipient}. Room access ended; contact the room owner
                      to coordinate review.
                    </p>
                  </div>
                ) : (
                  <Link
                    className="dinner-event"
                    href={`/app/rooms/${p.roomId}?view=money`}
                    key={p.reportId}
                  >
                    <div>
                      <h3>
                        {p.needsConfirmation
                          ? "Review receipt outside Tab"
                          : "Awaiting recipient confirmation"}
                      </h3>
                      <p className="dinner-note">
                        Reported paid outside Tab · {usd(p.cents)}. Still
                        outstanding until {p.recipient} confirms.
                      </p>
                    </div>
                  </Link>
                ),
              )
            ) : (
              <p className="dinner-note">
                No unconfirmed outside reports. Record one in a room’s Money
                view after confirming a shared expense with someone else.
              </p>
            )}
            <p className="dinner-note">
              A report is not a Tab payment receipt. Only the creditor can
              confirm actual receipt outside Tab.
            </p>
            <Link className="dinner-inline-link" href="/app/agent">
              Ask Tab about your obligations ↗
            </Link>
          </aside>
        </div>
      ) : (
        <p role="status">Loading your money home…</p>
      )}
    </>
  );
}
