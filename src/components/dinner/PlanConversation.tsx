"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  planFeedSchema,
  planAction,
  eventDescription,
  type PlanFeed,
  type PlanEvent,
  type PlanSummary,
} from "@/lib/dinner/plans/conversation";
import { RoomView, usd } from "@/lib/dinner/model";
import { useDinner } from "./DinnerShell";
const empty: PlanFeed = {
  plans: [],
  morePlans: false,
  events: [],
  nextCursor: null,
};
export function usePlanConversation(roomId: string) {
  const { api } = useDinner();
  const [feed, setFeed] = useState<PlanFeed>(empty);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const load = useCallback(
    async (before?: string) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      try {
        const result = await api(
          `/rooms/${roomId}/plan-feed${before ? `?before=${encodeURIComponent(before)}` : ""}`,
          {},
          planFeedSchema,
        );
        if (!mounted.current) return;
        setFeed((previous) => {
          const old = new Map(previous.plans.map((p) => [p.id, p]));
          const overlap = result.events.some((event) =>
            previous.events.some((e) => e.id === event.id),
          );
          return {
            plans: result.plans.map((p) =>
              (old.get(p.id)?.revision ?? -1) > p.revision ? old.get(p.id)! : p,
            ),
            morePlans: result.morePlans,
            events: [
              ...new Map(
                [...previous.events, ...result.events].map((e) => [e.id, e]),
              ).values(),
            ],
            nextCursor:
              before ||
              !previous.events.length ||
              (result.events.length && !overlap)
                ? result.nextCursor
                : previous.nextCursor,
          };
        });
        setError("");
      } catch {
        if (mounted.current)
          setError(
            "Plan updates could not refresh. Your conversation is still available.",
          );
      } finally {
        busy.current = false;
        if (mounted.current) setLoading(false);
      }
    },
    [api, roomId],
  );
  useEffect(() => {
    mounted.current = true;
    void load();
    const sync = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(sync, 3000);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [load]);
  return {
    feed,
    error,
    loading,
    refresh: () => load(),
    older: () => (feed.nextCursor ? load(feed.nextCursor) : Promise.resolve()),
  };
}
export function planLink(roomId: string, planId?: string) {
  return `/app/rooms/${roomId}?view=plan${planId ? `&plan=${planId}` : ""}`;
}
function slotLabel(plan: PlanSummary) {
  const slot = plan.terms ?? plan.slots[0];
  const zone = plan.terms?.timeZone ?? plan.timeZone;
  return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(slot.startAt))} (${zone})${!plan.terms && plan.slots.length > 1 ? ` · ${plan.slots.length} options` : ""}`;
}
export function ConversationPlans({
  room,
  feed,
  userId,
}: {
  room: RoomView;
  feed: PlanFeed;
  userId: string;
}) {
  return (
    <section
      className="plan-conversation-summary"
      aria-label="Plans in this conversation"
    >
      <div className="plan-actions">
        <h3>Plans together</h3>
        <Link className="dinner-inline-link" href={planLink(room.id)}>
          All plans
        </Link>
      </div>
      {!feed.plans.length && (
        <p className="dinner-note">
          Published plans will appear here.{" "}
          <Link className="dinner-inline-link" href={planLink(room.id)}>
            Start a plan
          </Link>
        </p>
      )}
      <div className="plan-conversation-cards">
        {feed.plans.map((plan) =>
          plan.state === "confirmed" || plan.state === "completed" ? (
            <article
              key={plan.id}
              className="plan-conversation-locked"
              aria-label={`Plan: ${plan.title}`}
            >
              <p>
                <strong>
                  {plan.state === "confirmed" ? "Locked in" : "Completed"}:{" "}
                  {plan.title}.
                </strong>{" "}
                {slotLabel(plan)} at {plan.terms?.location ?? plan.location}, up
                to {usd(plan.terms?.budgetCents ?? plan.budgetCents)} per person
                (estimated). {plan.confirmedIds.length} confirmed.{" "}
                <Link
                  className="dinner-inline-link"
                  href={planLink(room.id, plan.id)}
                >
                  {plan.state === "confirmed"
                    ? "View or edit details"
                    : "View details"}
                </Link>
              </p>
            </article>
          ) : (
            <article
              key={plan.id}
              className="dinner-card soft plan-conversation-card"
              aria-label={`Plan: ${plan.title}`}
            >
              <p className="dinner-eyebrow">{plan.state}</p>
              <h4>{plan.title}</h4>
              <p>{slotLabel(plan)}</p>
              <p>
                {plan.terms?.location ?? plan.location} · up to{" "}
                {usd(plan.terms?.budgetCents ?? plan.budgetCents)} per person,
                estimated
              </p>
              <p className="dinner-note">
                {plan.state === "collecting"
                  ? `${plan.responses.length} of ${plan.participantIds.length} responded`
                  : plan.state === "confirming"
                    ? `${plan.decisions.filter((d) => d.termsVersion === plan.termsVersion && d.decision === "accepted").length} of ${plan.participantIds.length} accepted`
                    : "This outing is cancelled"}
              </p>
              <Link className="dinner-button" href={planLink(room.id, plan.id)}>
                {planAction(plan, userId)}
              </Link>
            </article>
          ),
        )}
      </div>
      {feed.morePlans && (
        <p className="dinner-note">
          Showing six recently updated plans. Open All plans for the rest.
        </p>
      )}
    </section>
  );
}
export function ConversationPlanEvent({
  event,
  room,
}: {
  event: PlanEvent;
  room: RoomView;
}) {
  if (
    (event.action === "auto_finalize" || event.action === "finalize") &&
    event.terms
  )
    return (
      <article
        className="plan-conversation-event"
        aria-label={`Plan update: ${event.action === "auto_finalize" ? "Everyone confirmed · outing locked in" : "Outing locked in"}`}
        data-plan-event={event.id}
      >
        <p>
          <strong>
            {event.action === "auto_finalize"
              ? "Everyone confirmed—"
              : "Locked in—"}
            {event.title}.
          </strong>{" "}
          {event.terms.localStart.replace("T", " ")} ({event.terms.timeZone}) at{" "}
          {event.terms.location}, up to {usd(event.terms.budgetCents)} per
          person (estimated).{" "}
          <Link
            className="dinner-inline-link"
            href={planLink(room.id, event.planId)}
          >
            View or edit details
          </Link>
        </p>
      </article>
    );
  const name =
    room.members.find((m) => m.userId === event.actorId)?.name ?? "A member";
  return (
    <article
      className="plan-conversation-event"
      aria-label={`Plan update: ${eventDescription(event, name)}`}
      data-plan-event={event.id}
    >
      <p className="dinner-eyebrow">
        Plan update ·{" "}
        <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
      </p>
      <p>
        <strong>{eventDescription(event, name)}</strong> · {event.title}
      </p>
      {event.action === "propose" && event.terms && (
        <p className="dinner-note">
          Proposed version {event.termsVersion}:{" "}
          {event.terms.localStart.replace("T", " ")} ({event.terms.timeZone}),{" "}
          {event.terms.location}, up to {usd(event.terms.budgetCents)} per
          person.
        </p>
      )}
      {(event.action === "propose" ||
        event.action === "add_participants" ||
        event.action === "rework") && (
        <p className="dinner-note">
          Review the current plan before responding.
        </p>
      )}
      <Link
        className="dinner-inline-link"
        href={planLink(room.id, event.planId)}
      >
        View current plan
      </Link>
    </article>
  );
}
