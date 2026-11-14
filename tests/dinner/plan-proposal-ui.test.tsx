import "./dom";
import React from "react";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PlanProposalCards } from "../../src/components/dinner/PlanProposalCards";
import { DinnerContext } from "../../src/components/dinner/DinnerShell";
import type { PlanProposal } from "../../src/lib/dinner/agent/plan-proposals";
afterEach(cleanup);
test("cards distinguish prior suggestions, missing details and saved plans while retaining comparison", () => {
  const first: PlanProposal = {
    id: "first",
    roomId: "room",
    userId: "alice",
    visibility: "room",
    runKey: "room:room:source",
    createdAt: "2030-01-01T00:00:00Z",
    appliedPlanId: null,
    idea: "Dinner",
    fields: {
      title: "Dinner",
      location: "Cafe",
      budgetCents: 5000,
      slots: null,
      timeZone: null,
      participantIds: null,
    },
  };
  const second = {
    ...first,
    id: "second",
    createdAt: "2030-01-01T00:01:00Z",
    fields: { ...first.fields, budgetCents: 2500 },
  };
  const harness = (proposals: PlanProposal[]) => (
    <DinnerContext.Provider
      value={{
        me: { id: "alice", name: "Alice" },
        api: async () => {
          throw new Error("No request expected");
        },
        image: async () => new Blob(),
      }}
    >
      <PlanProposalCards proposals={proposals} />
    </DinnerContext.Provider>
  );
  const view = render(harness([first, second]));
  assert.ok(screen.getByText("Latest suggestion with this title"));
  assert.ok(screen.getByText("Earlier suggestion with this title"));
  assert.ok(screen.getByText("Changed from the previous suggestion: Budget."));
  const details = view.container.querySelector("details")!;
  assert.equal(details.open, false);
  fireEvent.click(screen.getByText("Compare earlier suggestion"));
  assert.equal(details.open, true);
  assert.ok(screen.getByText("$50.00 per person"));
  assert.ok(screen.getByText("$25.00 per person"));
  view.rerender(harness([{ ...second, appliedPlanId: "saved" }]));
  assert.ok(screen.getByText("Dinner was saved to Plans."));
  assert.equal(screen.queryByText("Needs details"), null);
  assert.equal(
    screen
      .getByRole("link", { name: "Open saved plan ↗" })
      .getAttribute("href"),
    "/app/rooms/room?view=plan&plan=saved",
  );
});
