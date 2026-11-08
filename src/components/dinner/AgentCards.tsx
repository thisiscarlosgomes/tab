"use client";
import { useState } from "react";
import Link from "next/link";
import { Proposal } from "@/lib/dinner/agent/model";
import { expenseSchema } from "@/lib/dinner/client-schema";
import { usd } from "@/lib/dinner/model";
import { useDinner } from "./DinnerShell";
export function AgentCards({
  proposals,
  refresh,
}: {
  proposals: Proposal[];
  refresh: () => Promise<void>;
}) {
  const { api, me } = useDinner();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function save(proposal: Proposal) {
    setBusy(proposal.id);
    setError("");
    try {
      await api(
        `/agent/proposals/${proposal.id}/apply`,
        { method: "POST", body: JSON.stringify({ clientId: proposal.id }) },
        expenseSchema,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save draft");
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      {error && (
        <p role="alert" className="dinner-error">
          {error}
        </p>
      )}
      {proposals.map((p) => (
        <article className="dinner-card dinner-agent-proposal" key={p.id}>
          <span className="dinner-chip">
            Tab prepared · human review required
            {p.correctionOf ? " · expense correction" : ""}
          </span>
          <h3>
            {p.fields.description} · {usd(p.fields.totalCents)}
          </h3>
          <p className="dinner-note">
            Payer:{" "}
            {p.members.find((member) => member.userId === p.fields.payerId)
              ?.name ?? "Member"}
            . Participants and exact shares are below. Check names and edit in
            Money before confirming.
          </p>
          {p.fields.shares.map((share) => (
            <div className="dinner-pair" key={share.userId}>
              <span>
                {p.members.find((member) => member.userId === share.userId)
                  ?.name ?? "Member"}
              </span>
              <strong>{usd(share.cents)}</strong>
            </div>
          ))}
          <p className="dinner-note">
            {p.correctionOf
              ? "Existing balances are unchanged. Save this correction proposal, then review or edit it in Money. The expense author or room owner must accept it."
              : "No debt or payment yet. Saving makes an editable draft visible to the room. Only a human can confirm it in Money."}
          </p>
          <div className="dinner-actions">
            {p.appliedExpenseId ? (
              <Link
                className="dinner-inline-link"
                href={`/app/rooms/${p.roomId}?view=money`}
              >
                Review saved draft in Money ↗
              </Link>
            ) : p.userId === me?.id ? (
              <button disabled={!!busy} onClick={() => void save(p)}>
                {busy === p.id ? "Saving…" : "Save editable draft"}
              </button>
            ) : (
              <span className="dinner-note">
                The requesting member must review and save this proposal.
              </span>
            )}
            <Link href={`/app/rooms/${p.roomId}?view=money`}>
              Open room Money ↗
            </Link>
          </div>
        </article>
      ))}
    </>
  );
}
