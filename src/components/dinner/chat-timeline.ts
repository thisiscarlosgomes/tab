import type { Proposal } from "@/lib/dinner/agent/model";

/** Creation timestamps keep historical and pending-workflow cards in place. */
export function chatTimeline<M extends { id: string; createdAt: string }>(
  messages: M[],
  proposals: Proposal[],
) {
  return [
    ...messages.map((message, index) => ({
      kind: "message" as const,
      message,
      index,
      id: message.id,
      createdAt: message.createdAt,
    })),
    ...proposals.map((proposal) => ({
      kind: "proposal" as const,
      proposal,
      id: proposal.id,
      createdAt: proposal.createdAt,
    })),
  ].sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      (a.kind === b.kind
        ? a.kind === "message"
          ? 0
          : a.id.localeCompare(b.id)
        : a.kind === "message"
          ? -1
          : 1),
  );
}
