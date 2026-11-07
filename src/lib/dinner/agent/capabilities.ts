import type { Proposal } from "./model";
import type { prepareInput } from "./model";
import type { z } from "zod";
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
  prepareExpense: (input: z.infer<typeof prepareInput>) => Promise<Proposal>;
  recordTool: (
    name: string,
    scope: "user-read" | "room-read" | "room-prepare",
    outcome: string,
  ) => Promise<void>;
};
export type AgentRunner = (context: AgentContext) => Promise<string>;
