import type { Proposal } from "./model";
import type { prepareInput } from "./model";
import type { z } from "zod";
import type { MemberSummary, NudgeDraft, nudgeInput } from "./room-tools";
export type AgentScope =
  | { kind: "personal" }
  | { kind: "room"; roomId: string };
export type AgentContext = {
  scope: AgentScope;
  conversation: { role: "user" | "assistant"; content: string }[];
  memory: string;
  agreements: string;
  readContext: () => Promise<unknown>;
  readRoom: (roomId: string) => Promise<unknown>;
  memberSummary: (
    roomId: string,
  ) => Promise<{ members: MemberSummary[]; notice: string }>;
  draftNudge: (input: z.input<typeof nudgeInput>) => Promise<NudgeDraft>;
  /** Optional live text sink. Persistence still happens only after the run completes. */
  onDelta?: (text: string) => void;
  prepareExpense: (input: z.infer<typeof prepareInput>) => Promise<Proposal>;
  recordTool: (
    name: string,
    scope: "user-read" | "room-read" | "room-prepare",
    outcome: string,
  ) => Promise<void>;
};
export type AgentRunner = (context: AgentContext) => Promise<string>;
