import type { Proposal, NeedsDetails } from "./model";
import type { prepareInput } from "./model";
import type { z } from "zod";
import type { MemberSummary, NudgeDraft, nudgeInput } from "./room-tools";
export type AgentScope =
  | { kind: "personal" }
  | { kind: "room"; roomId: string };
export type AgentContext = {
  coordination?: import("./coordination").Coordination;
  lookupSummary?: () => Promise<{ awaitingPayment: number; awaitingConfirmation: number; outstandingCents: number }>;
  action?: import("./action-routing").ActionDecision["action"];
  missingBillDetails?: string[];
  pendingExpense?: () => Promise<
    import("./pending-expense").PendingWorkflow | null
  >;
  request?: { messageId: string; text: string; sequence?: number };
  requester?: { userId: string; name: string };
  scope: AgentScope;
  conversation: { role: "user" | "assistant"; content: string }[];
  historyCoverage?: {
    totalMessages: number;
    visibleMessages: number;
    oldestVisibleSeq: number;
    sourceSeq: number;
  };
  searchRoomHistory?: (input: {
    query: string;
    beforeSeq: number | null;
    limit: number | null;
  }) => Promise<{
    messages: {
      id: string;
      seq: number;
      senderId: string;
      sender: string;
      kind: string;
      createdAt: string;
      text: string;
      truncated: boolean;
    }[];
    hasMore: boolean;
    nextBeforeSeq: number | null;
  }>;
  memory: string;
  agreements: string;
  readContext: () => Promise<unknown>;
  readPlans: (
    roomId: string,
    planId?: string,
  ) => Promise<{
    plans: import("./planning").PlanningFacts[];
    hasMore: boolean;
  }>;
  readRoom: (roomId: string) => Promise<unknown>;
  preparePlan: (
    input: z.infer<typeof import("./plan-proposals").preparePlanInput>,
  ) => Promise<import("./plan-proposals").PlanProposal>;
  memberSummary: (
    roomId: string,
  ) => Promise<{ members: MemberSummary[]; notice: string }>;
  draftNudge: (input: z.input<typeof nudgeInput>) => Promise<NudgeDraft>;
  /** Optional live text sink. Persistence still happens only after the run completes. */
  onDelta?: (text: string) => void;
  /** Complete server-validated manual task, ready for a review proposal only. */
  readyBill?: z.infer<typeof prepareInput>;
  prepareExpense: (
    input: z.infer<typeof prepareInput>,
  ) => Promise<Proposal | NeedsDetails>;
  recordTool: (
    name: string,
    scope: "user-read" | "room-read" | "room-prepare",
    outcome: string,
  ) => Promise<void>;
};
export type AgentRunner = (context: AgentContext) => Promise<string>;
