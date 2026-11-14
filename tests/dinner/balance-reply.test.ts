import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { runTabAgent } from "../../src/lib/dinner/agent/runtime";
import type { AgentContext } from "../../src/lib/dinner/agent/capabilities";
import {
  isRoomBalanceQuestion,
  roomBalanceReply,
} from "../../src/lib/dinner/agent/balance-reply";

test("balance replies ignore false historical amounts and direction, including a member named tab", async () => {
  const carlos = randomUUID(),
    tab = randomUUID();
  const facts = {
    members: [
      { userId: carlos, name: "Carlos" },
      { userId: tab, name: "tab" },
    ],
    obligations: [
      {
        id: randomUUID(),
        expenseId: randomUUID(),
        debtorId: tab,
        creditorId: carlos,
        cents: 50,
        currency: "USD",
        status: "outstanding",
      },
    ],
  };
  const audit: string[] = [];
  for (const text of ["@Tab who owes whom?", "@Tab what's still pending?"]) {
    let streamed = "";
    const unexpected = async (): Promise<never> => {
      throw new Error("Balance answers must not invoke other capabilities");
    };
    const context: AgentContext = {
      memory: "",
      agreements: "",
      readPlans: async () => ({ plans: [], hasMore: false }),
    preparePlan: async () => { throw new Error("Unexpected plan preparation"); },
    readRoom: unexpected,
      memberSummary: unexpected,
      draftNudge: unexpected,
      prepareExpense: unexpected,
      scope: { kind: "room", roomId: randomUUID() },
      request: { messageId: randomUUID(), text },
      conversation: [{ role: "assistant", content: "Carlos owes Tab $50" }],
      readContext: async () => facts,
      recordTool: async (name: string) => {
        audit.push(name);
      },
      onDelta: (delta: string) => {
        streamed += delta;
      },
    };
    const reply = await runTabAgent(context);
    assert.match(reply, /member “tab” owes Carlos \$0\.50/);
    assert.doesNotMatch(reply, /\$50|Carlos owes/);
    assert.equal(streamed, reply);
  }
  assert.ok(audit.includes("render_room_balance"));
  assert.match(
    roomBalanceReply({ ...facts, obligations: [] }),
    /No outstanding/,
  );
});

test("compound requests are not silently replaced with a balance summary", () => {
  assert.equal(
    isRoomBalanceQuestion("@Tab who owes whom? Also split this receipt"),
    false,
  );
  assert.equal(isRoomBalanceQuestion("@Tab split this receipt"), false);
});
