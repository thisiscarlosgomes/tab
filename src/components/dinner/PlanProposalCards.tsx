"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usd, type RoomView } from "@/lib/dinner/model";
import {
  missingPlanDetails,
  proposalPresentation,
  planProposalSchema,
  type PlanProposal,
} from "@/lib/dinner/agent/plan-proposals";
import { useDinner } from "./DinnerShell";
import { CreatePlan } from "./Plans";

export function PlanProposalCards({
  proposals,
  allProposals = proposals,
  members = [],
}: {
  proposals: PlanProposal[];
  allProposals?: PlanProposal[];
  members?: RoomView["members"];
}) {
  return (
    <>
      {proposals.map((proposal) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          all={allProposals}
          members={members}
        />
      ))}
    </>
  );
}
function ProposalCard({
  proposal: p,
  all,
  members,
}: {
  proposal: PlanProposal;
  all: PlanProposal[];
  members: RoomView["members"];
}) {
  const { me } = useDinner();
  const { earlier, latest, previous, changed } = proposalPresentation(p, all);
  const missing = missingPlanDetails(p.fields);
  if (p.appliedPlanId)
    return (
      <p
        className="dinner-note"
        id={`plan-proposal-${p.id}`}
        aria-label={`Saved plan: ${p.fields.title ?? "Plan"}`}
      >
        {p.fields.title ?? "This plan"} was saved to Plans.{" "}
        <Link
          className="dinner-inline-link"
          href={`/app/rooms/${p.roomId}?view=plan&plan=${p.appliedPlanId}`}
        >
          Open saved plan ↗
        </Link>
      </p>
    );
  const status = p.appliedPlanId
    ? "Saved to Plans"
    : missing.length
      ? "Needs details"
      : "Ready for your review";
  const body = (
    <>
      <p className="dinner-note">
        {p.appliedPlanId
          ? "Original suggestion shown below. Open the saved plan for reviewed details and current status."
          : p.idea}
      </p>
      <dl className="plan-proposal-facts">
        <dt>Place</dt>
        <dd>{p.fields.location ?? "Not decided"}</dd>
        <dt>Budget</dt>
        <dd>
          {p.fields.budgetCents === null
            ? "Not decided"
            : `${usd(p.fields.budgetCents)} per person`}
        </dd>
        <dt>Time options</dt>
        <dd>
          {p.fields.slots?.map((slot, i) => (
            <div key={i}>
              {slot.localStart.replace("T", " ")} –{" "}
              {slot.localEnd.replace("T", " ")}
            </div>
          )) ?? "Date and time not decided"}
          {p.fields.slots && (
            <div>{p.fields.timeZone ?? "Time zone not decided"}</div>
          )}
        </dd>
        <dt>Participants</dt>
        <dd>
          {p.fields.participantIds
            ? p.fields.participantIds
                .map((id) => members.find((m) => m.userId === id)?.name)
                .filter(Boolean)
                .join(", ") ||
              `${p.fields.participantIds.length} selected members`
            : "Not selected"}
        </dd>
      </dl>
      {previous && (
        <p className="dinner-note">
          {changed.length
            ? `Changed from the previous suggestion: ${changed.join(", ")}.`
            : "Same plan details as the previous suggestion."}
        </p>
      )}
      {!p.appliedPlanId && (
        <p className="dinner-note">
          {missing.length
            ? `Still needed: ${missing.join(", ")}.`
            : "Details filled in; review before saving."}{" "}
          This is a suggestion, not a published or confirmed plan.
        </p>
      )}
      {p.appliedPlanId ? (
        <Link
          className="dinner-inline-link"
          href={`/app/rooms/${p.roomId}?view=plan&plan=${p.appliedPlanId}`}
        >
          Open saved plan ↗
        </Link>
      ) : p.userId === me?.id ? (
        <Link
          className="dinner-inline-link"
          href={`/app/rooms/${p.roomId}?view=plan&proposal=${p.id}`}
        >
          Review and complete plan ↗
        </Link>
      ) : (
        <p className="dinner-note">
          The requesting member must review and save this idea.
        </p>
      )}
      {earlier && (
        <p>
          <a
            className="dinner-inline-link"
            href={`#plan-proposal-${latest.id}`}
          >
            Jump to latest suggestion ↓
          </a>
        </p>
      )}
    </>
  );
  return (
    <article
      id={`plan-proposal-${p.id}`}
      className="dinner-card dinner-agent-proposal plan-proposal-context"
      aria-label={`Plan idea: ${p.fields.title ?? "Untitled"}`}
    >
      <div className="dinner-actions">
        <span className="dinner-chip">{status}</span>
        <span className="dinner-note">
          {earlier
            ? "Earlier suggestion with this title"
            : "Latest suggestion with this title"}
        </span>
      </div>
      <h3>{p.fields.title ?? "A plan idea"}</h3>
      <p className="dinner-note">
        Proposal {p.id.slice(0, 6)} ·{" "}
        <time dateTime={p.createdAt}>
          {new Date(p.createdAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
      </p>
      {earlier ? (
        <details>
          <summary>Compare earlier suggestion</summary>
          {body}
        </details>
      ) : (
        body
      )}
    </article>
  );
}

export function PlanProposalReview({
  room,
  id,
}: {
  room: RoomView;
  id: string;
}) {
  const { api } = useDinner();
  const router = useRouter();
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setProposal(null);
    setError("");
    void api(`/agent/plan-proposals/${id}`, {}, planProposalSchema)
      .then((p) => {
        if (!current) return;
        if (p.roomId !== room.id) {
          setError("This idea belongs to another room.");
          return;
        }
        setProposal(p);
      })
      .catch((e) => {
        if (current)
          setError(e instanceof Error ? e.message : "Could not open plan idea");
      });
    return () => {
      current = false;
    };
  }, [api, id, room.id, attempt]);
  return (
    <section className="dinner-stack">
      <Link href={`/app/rooms/${room.id}?view=plan`}>← All plans</Link>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      ) : !proposal ? (
        <p role="status">Opening plan idea…</p>
      ) : proposal.appliedPlanId ? (
        <Link
          href={`/app/rooms/${room.id}?view=plan&plan=${proposal.appliedPlanId}`}
        >
          Open saved plan ↗
        </Link>
      ) : (
        <>
          <p>{proposal.idea}</p>
          <CreatePlan
            key={proposal.id}
            room={room}
            proposal={proposal}
            saved={(plan) =>
              router.replace(`/app/rooms/${room.id}?view=plan&plan=${plan.id}`)
            }
          />
        </>
      )}
    </section>
  );
}
