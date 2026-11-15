"use client";
import Link from "next/link";
import { EditableNote } from "./Coordination";
export function AgentSettings() {
  return (
    <section className="dinner-settings">
      <Link href="/app/settings" className="dinner-back">
        ← Settings
      </Link>
      <h1>Agent settings</h1>
      <p><Link href="/app/settings/agent/tests" className="dinner-back">View conversation tests →</Link></p>
      <EditableNote
        path="/agent/memory"
        title="Your preferences"
        description="Saved preferences for Ask Tab. These are private and aren't used in room chats."
      />
      <p className="dinner-note">
        In rooms, mention Tab or reply to its messages. Smart assistance can also
        recognize relevant follow-ups. Bills require your confirmation.
      </p>
    </section>
  );
}
