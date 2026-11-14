"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DinnerContext } from "@/components/dinner/DinnerShell";
import { DinnerFrame } from "@/components/dinner/DinnerFrame";
import { Actor } from "@/lib/dinner/model";
export function Fixture({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const logout = async () => { await fetch("/api/test/session", { method: "DELETE" }); setMe(null); };
  const [me, setMe] = useState<Actor | null>(null);
  const [ready, setReady] = useState(false);
  const [lab, setLab] = useState({
    enabled: false,
    automatic: true,
    scenario: "",
    roomId: "",
    busy: false,
    stopped: false,
    rounds: 0,
    speaker: "",
    error: "",
  });
  const [labError, setLabError] = useState("");
  useEffect(() => {
    let active = true;
    const sync = () =>
      fetch("/api/test/lab", { cache: "no-store" })
        .then((r) => r.json())
        .then((value) => {
          if (active) setLab(value);
        })
        .catch(() => {});
    void sync();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function control(action: "round" | "stop" | "resume") {
    setLabError("");
    if (action === "round") setLab((value) => ({ ...value, busy: true }));
    try {
      const response = await fetch("/api/test/lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error("Could not run the test agents");
      setLab(await response.json());
    } catch {
      setLabError(
        "Could not reach the test agents. Your room messages are saved.",
      );
    }
  }
  useEffect(() => {
    void fetch("/api/test/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        setMe(value);
        setReady(true);
      });
  }, []);
  const api = useCallback(
    async <T,>(path: string, init: RequestInit, schema: z.ZodType<T>) => {
      const response = await fetch(`/api/dinner${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...init.headers },
        cache: "no-store",
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      return schema.parse(value);
    },
    [],
  );
  const image = useCallback(async (path: string) => {
    const response = await fetch(`/api/dinner${path}`);
    if (!response.ok) throw new Error("Image unavailable");
    return response.blob();
  }, []);
  return (
    <DinnerFrame pathname={pathname} name={me?.name ?? "Local test"} landing={!me}>
        {!ready ? (
          <p>Loading test session…</p>
        ) : !me ? (
          <section className="dinner-card">
            <h1>
              {lab.enabled
                ? "Join the live test room"
                : "Choose a test identity"}
            </h1>
            <p>
              {lab.enabled
                ? "Join as Carlos alongside four labeled AI test participants. Local disposable room; real model responses."
                : "Disposable database. No Privy, payment or messaging services."}
            </p>
            {(lab.enabled ? ["Carlos"] : ["Alice", "Bob", "Carol"]).map(
              (name) => (
                <button
                  key={name}
                  onClick={async () => {
                    await fetch("/api/test/session", {
                      method: "POST",
                      body: JSON.stringify({ name }),
                    });
                    window.location.href = lab.enabled
                      ? `/app/rooms/${lab.roomId}`
                      : "/app";
                  }}
                >
                  Continue as {name}
                </button>
              ),
            )}
          </section>
        ) : (
          <DinnerContext.Provider value={{ api, me, image, account: { logout, test: true } }}>
            {lab.enabled && (
              <details
                className="dinner-card soft lab-controls"
                style={{ marginBottom: 20 }}
                aria-label="Live agent controls"
              >
                <summary>Local test · controls and agents</summary>
                <p className="dinner-note">
                  Agents reply automatically after you send a message. Address
                  Nina by name or use @Nina for a direct reply; use @Tab for the
                  coordinator. Group messages invite all four. Real model
                  requests use your configured API account.
                </p>
                <div className="dinner-actions">
                  <Link href={`/app/rooms/${lab.roomId}`}>Open live room</Link>
                  <button
                    disabled={lab.busy || lab.rounds >= 20}
                    onClick={() => void control("round")}
                  >
                    {lab.busy
                      ? `${lab.speaker || "Agents"} thinking…`
                      : "Run a round"}
                  </button>
                  {lab.automatic ? (
                    <button
                      className="dinner-quiet"
                      onClick={() => void control("stop")}
                    >
                      Pause automatic replies
                    </button>
                  ) : (
                    <button onClick={() => void control("resume")}>
                      Resume automatic replies
                    </button>
                  )}
                </div>
                <p role="status" className="dinner-note">
                  {lab.scenario && <span>{lab.scenario} · </span>}
                  {lab.rounds} of 20 rounds used.{" "}
                  {lab.automatic
                    ? "Automatic replies on."
                    : "Automatic replies paused."}{" "}
                  {lab.error || labError}
                </p>
              </details>
            )}
            {children}
          </DinnerContext.Provider>
        )}
    </DinnerFrame>
  );
}
