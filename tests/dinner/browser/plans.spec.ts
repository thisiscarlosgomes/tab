import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function signIn(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: `Continue as ${name}` }).click();
  await expect(
    page.getByRole("link", { name: "Rooms", exact: true }),
  ).toBeVisible();
}
test("two browser sessions coordinate, recover edits, withdraw, invite and export on desktop and mobile", async ({
  browser,
}, testInfo) => {
  const aliceContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    baseURL: "http://127.0.0.1:3107",
  });
  const bobContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: "http://127.0.0.1:3107",
  });
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const errors: string[] = [];
  alice.on("pageerror", (e) => errors.push(`Alice: ${e.message}`));
  bob.on("pageerror", (e) => errors.push(`Bob: ${e.message}`));
  try {
    await signIn(alice, "Alice");
    await signIn(bob, "Bob");
    const rooms = await (await alice.request.get("/api/dinner/rooms")).json();
    const roomId = rooms.rooms[0].id;
    const url = `/app/rooms/${roomId}?view=plan`;
    await alice.goto(url);
    await alice.getByRole("button", { name: "New plan", exact: true }).click();
    await alice.getByLabel("What are we planning?").fill("Browser supper");
    await alice.getByRole("checkbox", { name: "Carol", exact: true }).uncheck();
    await alice.getByLabel("Area or venue").fill("Downtown");
    await alice
      .getByLabel("Estimated maximum per person · USD", { exact: true })
      .fill("50");
    await alice.getByLabel("Event time zone").fill("UTC");
    await alice.getByLabel("Starts", { exact: true }).fill("2035-01-05T19:00");
    await alice.getByLabel("Ends", { exact: true }).fill("2035-01-05T21:00");
    await alice.getByRole("button", { name: "Save plan draft" }).click();
    await alice
      .getByRole("button", { name: "Edit draft", exact: true })
      .click();
    await alice
      .getByLabel("What are we planning?")
      .fill("Browser supper revised");
    await alice.getByLabel("Area or venue").fill("Harbor");
    await alice
      .getByLabel("Estimated maximum per person · USD", { exact: true })
      .fill("45");
    await alice.getByRole("button", { name: "Save draft changes" }).click();
    await expect(
      alice.getByRole("heading", {
        name: "Browser supper revised",
        exact: true,
      }),
    ).toBeVisible();
    await alice.getByRole("button", { name: "Publish options" }).click();
    await bob.goto(url);
    await bob.getByRole("radio", { name: "Works", exact: true }).check();
    await bob.getByLabel(/Does the/).selectOption("works");
    await bob
      .getByLabel("Dietary or accessibility note · optional")
      .fill("Needs step-free access");
    await bob.getByRole("button", { name: "Save my response" }).click();
    await expect(alice.getByText(/1 works · 0 if needed/)).toBeVisible();
    await alice
      .getByRole("button", { name: "Extend response deadline", exact: true })
      .click();
    await alice.getByLabel("Later deadline · UTC").fill("2035-01-05T15:00");
    await alice
      .getByRole("button", { name: "Save deadline without clearing responses" })
      .click();
    await expect(
      alice.getByRole("heading", { name: "Extend response deadline" }),
    ).not.toBeVisible();
    const list = await (
      await alice.request.get(`/api/dinner/rooms/${roomId}/plans`)
    ).json();
    const planId = list[0].id;
    expect(list[0].responses).toHaveLength(1);
    expect(list[0].responses[0].privateNote).toBe("Needs step-free access");
    await alice
      .getByRole("button", { name: "Propose final details", exact: true })
      .click();
    await alice.getByLabel("Exact venue or meeting point").fill("Harbor cafe");
    await bob.getByRole("radio", { name: "If needed", exact: true }).check();
    await bob.getByRole("button", { name: "Save my response" }).click();
    await expect(
      alice.getByRole("button", {
        name: "I reviewed the latest plan — keep my edits",
      }),
    ).toBeVisible();
    await expect(alice.getByLabel("Exact venue or meeting point")).toHaveValue(
      "Harbor cafe",
    );
    await alice
      .getByRole("button", {
        name: "I reviewed the latest plan — keep my edits",
      })
      .click();
    await alice.getByRole("button", { name: "Request confirmations" }).click();
    await alice
      .getByRole("button", { name: "Confirm my participation" })
      .click();
    await bob.getByRole("button", { name: "Confirm my participation" }).click();
    await expect(
      alice.getByRole("button", { name: "Finalize for 2 accepted people" }),
    ).toHaveCount(0);
    await expect(
      alice.getByRole("button", { name: "Download calendar event" }),
    ).toBeVisible();
    await expect(
      bob.getByRole("button", { name: "I can no longer attend" }),
    ).toBeVisible();
    await bob.getByRole("button", { name: "I can no longer attend" }).click();
    await bob
      .getByRole("button", { name: "Yes, withdraw my attendance" })
      .click();
    await expect(
      alice.getByText("Going: Alice", { exact: true }),
    ).toBeVisible();
    await alice
      .getByRole("button", { name: "Invite more participants", exact: true })
      .click();
    await alice.getByRole("checkbox", { name: "Carol", exact: true }).check();
    await alice
      .getByRole("button", { name: "Add selected participants" })
      .click();
    await expect(
      alice.getByText("Carol · Awaiting response", { exact: true }),
    ).toBeVisible();
    await expect(
      alice.getByRole("button", { name: "Finalize for 0 accepted people" }),
    ).toBeDisabled();
    await alice
      .getByRole("button", { name: "Confirm my participation" })
      .click();
    await alice
      .getByRole("button", { name: "Finalize for 1 accepted person" })
      .click();
    await alice.getByRole("link", { name: "Today", exact: true }).click();
    await alice.getByRole("link", { name: /Browser supper revised/ }).click();
    await expect(alice).toHaveURL(new RegExp(`plan=${planId}`));
    await expect(
      alice.getByRole("button", { name: "Download calendar event" }),
    ).toBeVisible();
    const downloadPromise = alice.waitForEvent("download");
    await alice
      .getByRole("button", { name: "Download calendar event" })
      .click();
    const download = await downloadPromise;
    const file = await download.path();
    expect(file).toBeTruthy();
    const ics = await readFile(file!, "utf8");
    expect(ics).toContain(`UID:${planId}@tab`);
    expect(ics).toContain("LOCATION:Harbor cafe");
    expect(ics).not.toContain("step-free");
    // A real network interruption must not discard the saved plan.
    await bobContext.setOffline(true);
    await bob.waitForTimeout(4000);
    await expect(
      bob.getByRole("heading", { name: "Browser supper revised", exact: true }),
    ).toBeVisible();
    await bobContext.setOffline(false);
    await bob.reload();
    await expect(
      bob.getByRole("button", { name: "Download calendar event" }),
    ).toBeVisible();
    expect(
      await bob.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await alice.screenshot({
      path: testInfo.outputPath("organizer-desktop.png"),
      fullPage: true,
    });
    await bob.screenshot({
      path: testInfo.outputPath("participant-mobile.png"),
      fullPage: true,
    });
    const beforeCancel = await (
      await alice.request.get(`/api/dinner/rooms/${roomId}/plans/${planId}`)
    ).json();
    expect(
      beforeCancel.history.some(
        (h: { action: string }) => h.action === "withdraw",
      ),
    ).toBe(true);
    expect(beforeCancel.confirmedIds).toHaveLength(1);
    await alice
      .getByRole("button", { name: "Cancel plan", exact: true })
      .click();
    await alice.getByRole("button", { name: "Yes, cancel plan" }).click();
    await expect(bob.getByText(/cancelled · organized by Alice/)).toBeVisible();
    const storedRoom = await (
      await alice.request.get(`/api/dinner/rooms/${roomId}`)
    ).json();
    expect(storedRoom.expenses).toHaveLength(0);
    const noSession = await browser.newContext();
    const denied = await noSession.request.get(
      `http://127.0.0.1:3107/api/dinner/rooms/${roomId}/plans`,
    );
    expect(denied.status()).toBe(401);
    await noSession.close();
    expect(errors).toEqual([]);
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test("published plans live in chat with private-safe updates and working response links", async ({
  browser,
}, testInfo) => {
  const a = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    baseURL: "http://127.0.0.1:3107",
  });
  const b = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    baseURL: "http://127.0.0.1:3107",
  });
  const alice = await a.newPage();
  const bob = await b.newPage();
  const errors: string[] = [];
  alice.on("pageerror", (e) => errors.push(e.message));
  bob.on("pageerror", (e) => errors.push(e.message));
  try {
    await signIn(alice, "Alice");
    await signIn(bob, "Bob");
    const { rooms } = await (
      await alice.request.get("/api/dinner/rooms")
    ).json();
    const room = rooms[0];
    const fields = {
      clientId: crypto.randomUUID(),
      title: "Conversation dinner",
      participantIds: room.members
        .filter((m: { name: string }) => m.name !== "Carol")
        .map((m: { userId: string }) => m.userId),
      timeZone: "UTC",
      location: "Riverside",
      budgetCents: 3500,
      slots: [{ localStart: "2035-02-02T19:00", localEnd: "2035-02-02T21:00" }],
      deadline: null,
    };
    const create = await alice.request.post(
      `/api/dinner/rooms/${room.id}/plans`,
      { data: fields },
    );
    expect(create.ok()).toBe(true);
    let plan = await create.json();
    const conversation = `/app/rooms/${room.id}?view=conversation`;
    await alice.goto(conversation);
    await bob.goto(conversation);
    await expect(
      bob.getByRole("article", {
        name: "Plan: Conversation dinner",
        exact: true,
      }),
    ).toHaveCount(0);
    const published = await alice.request.post(
      `/api/dinner/rooms/${room.id}/plans/${plan.id}/commands`,
      {
        data: {
          clientId: crypto.randomUUID(),
          action: "publish",
          expectedRevision: plan.revision,
        },
      },
    );
    expect(published.ok()).toBe(true);
    const card = bob.getByRole("article", {
      name: "Plan: Conversation dinner",
      exact: true,
    });
    await expect(card).toBeVisible();
    await expect(card.getByText("0 of 2 responded")).toBeVisible();
    await expect(
      bob
        .getByRole("article", {
          name: "Plan update: Alice published a plan",
          exact: true,
        })
        .filter({ hasText: fields.title }),
    ).toHaveCount(1);
    await alice.getByLabel("Message the room").fill("Let’s meet after work.");
    await alice.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      bob.getByText("Let’s meet after work.", { exact: true }),
    ).toBeVisible();
    await card.getByRole("link", { name: "Respond", exact: true }).click();
    await expect(bob).toHaveURL(new RegExp(`view=plan&plan=${plan.id}`));
    await bob.getByRole("radio", { name: "Works", exact: true }).check();
    await bob.getByLabel(/Does the/).selectOption("works");
    await bob
      .getByLabel("Dietary or accessibility note · optional")
      .fill("Private note absent from chat");
    await bob.getByRole("button", { name: "Save my response" }).click();
    await bob.getByText("See who can make it", { exact: true }).click();
    await expect(bob.getByText("Works: Bob", { exact: true })).toBeVisible();
    await bob.getByRole("tab", { name: "Conversation", exact: true }).click();
    await expect(
      card.getByRole("link", { name: "Edit response", exact: true }),
    ).toBeVisible();
    await expect(
      bob.getByText("Private note absent from chat", { exact: true }),
    ).toHaveCount(0);
    await alice
      .getByLabel("Message the room")
      .fill("@Tab who has responded to the plan?");
    await alice.getByRole("button", { name: "Send", exact: true }).click();
    const agentReply = alice.getByText(/Verified read-only planning summary/);
    await expect(agentReply).toBeVisible();
    await expect(agentReply).toContainText(
      "Conversation dinner (collecting): missing availability: Alice",
    );
    await expect(agentReply).toContainText(
      "1 works, 0 if needed, 0 can't, 1 unanswered",
    );
    await expect(agentReply).not.toContainText("Private note absent from chat");
    await alice.reload();
    await expect(
      alice.getByText(/Verified read-only planning summary/),
    ).toHaveCount(1);
    const feed = await (
      await alice.request.get(`/api/dinner/rooms/${room.id}/plan-feed`)
    ).json();
    expect(JSON.stringify(feed)).not.toContain("privateNote");
    plan = await (
      await alice.request.get(`/api/dinner/rooms/${room.id}/plans/${plan.id}`)
    ).json();
    const terms = {
      ...fields.slots[0],
      timeZone: "UTC",
      location: "Riverside cafe",
      budgetCents: 3000,
    };
    const proposed = await alice.request.post(
      `/api/dinner/rooms/${room.id}/plans/${plan.id}/commands`,
      {
        data: {
          clientId: crypto.randomUUID(),
          action: "propose",
          expectedRevision: plan.revision,
          terms,
        },
      },
    );
    expect(proposed.ok()).toBe(true);
    await expect(
      card.getByRole("link", { name: "Confirm", exact: true }),
    ).toBeVisible();
    await card.getByRole("link", { name: "Confirm", exact: true }).click();
    await bob
      .getByRole("button", { name: "Confirm my participation", exact: true })
      .click();
    await bob.getByRole("tab", { name: "Conversation", exact: true }).click();
    await expect(card.getByText("1 of 2 accepted")).toBeVisible();
    await expect(
      card.getByRole("link", { name: "View details", exact: true }),
    ).toBeVisible();
    await bob.reload();
    await expect(
      bob
        .getByRole("article", {
          name: "Plan update: Alice proposed new details",
          exact: true,
        })
        .filter({ hasText: fields.title }),
    ).toHaveCount(1);
    await expect(
      bob.getByText("Let’s meet after work.", { exact: true }),
    ).toBeVisible();
    expect(
      await bob.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const page of [alice, bob]) {
      const messageArea = await page
        .getByRole("log", { name: "Room conversation" })
        .boundingBox();
      expect(messageArea?.height).toBeGreaterThanOrEqual(250);
      const chat = await page.locator(".dinner-chat").boundingBox();
      const composer = await page.locator(".dinner-composer").boundingBox();
      expect(composer!.y + composer!.height).toBeLessThanOrEqual(
        chat!.y + chat!.height,
      );
    }
    expect(
      await bob.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
      })),
    ).toEqual({ viewport: 390, document: 390 });
    const mobileChat = await bob.locator(".dinner-chat").boundingBox();
    const mobileAside = await bob.locator("aside.dinner-stack").boundingBox();
    expect(mobileAside!.y).toBeGreaterThanOrEqual(
      mobileChat!.y + mobileChat!.height,
    );
    await alice.screenshot({
      path: testInfo.outputPath("conversation-desktop.png"),
      fullPage: true,
    });
    await bob.screenshot({
      path: testInfo.outputPath("conversation-mobile.png"),
      fullPage: true,
    });
    plan = await (
      await alice.request.get(`/api/dinner/rooms/${room.id}/plans/${plan.id}`)
    ).json();
    const cancelled = await alice.request.post(
      `/api/dinner/rooms/${room.id}/plans/${plan.id}/commands`,
      {
        data: {
          clientId: crypto.randomUUID(),
          action: "cancel",
          expectedRevision: plan.revision,
        },
      },
    );
    expect(cancelled.ok()).toBe(true);
    await expect(
      card.getByText("This outing is cancelled", { exact: true }),
    ).toBeVisible();
    await expect(
      bob
        .getByRole("article", {
          name: "Plan update: Alice cancelled the outing",
          exact: true,
        })
        .filter({ hasText: fields.title }),
    ).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});

test("agent idea stays incomplete until its requester reviews, saves and publishes on mobile", async ({
  browser,
}, testInfo) => {
  const a = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: "http://127.0.0.1:3107",
  });
  const b = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
  const alice = await a.newPage();
  const bob = await b.newPage();
  const errors: string[] = [];
  alice.on("pageerror", (e) => errors.push(e.message));
  try {
    await signIn(alice, "Alice");
    await signIn(bob, "Bob");
    const { rooms } = await (
      await alice.request.get("/api/dinner/rooms")
    ).json();
    const roomId = rooms[0].id;
    await alice.goto(`/app/rooms/${roomId}`);
    const before = await (
      await alice.request.get(`/api/dinner/rooms/${roomId}/plans`)
    ).json();
    await alice
      .getByLabel("Message the room")
      .fill("@Tab prepare a plan for a relaxed dinner, details undecided");
    await alice.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      alice.getByText(/I saved your words as a plan idea/),
    ).toBeVisible();
    const card = alice.getByRole("article", {
      name: "Plan idea: Untitled",
      exact: true,
    });
    await expect(card).toContainText(
      "Still needed: title, participants, time zone, place, budget, time options",
    );
    const [proposal] = await (
      await alice.request.get(`/api/dinner/rooms/${roomId}/plan-proposals`)
    ).json();
    expect(proposal.fields.budgetCents).toBeNull();
    const unchanged = await (
      await alice.request.get(`/api/dinner/rooms/${roomId}/plans`)
    ).json();
    expect(unchanged).toEqual(before);
    await bob.goto(`/app/rooms/${roomId}`);
    await expect(
      bob.getByRole("article", { name: "Plan idea: Untitled", exact: true }),
    ).toContainText("requesting member must review");
    expect(
      (
        await bob.request.get(`/api/dinner/agent/plan-proposals/${proposal.id}`)
      ).status(),
    ).toBe(404);
    await card
      .getByRole("link", { name: "Review and complete plan ↗" })
      .click();
    await expect(
      alice.getByRole("heading", { name: "Review your plan idea" }),
    ).toBeVisible();
    await expect(alice.getByLabel("Event time zone")).toHaveValue("");
    await expect(
      alice.getByRole("checkbox", { name: "Alice", exact: true }),
    ).not.toBeChecked();
    await alice.reload();
    await expect(
      alice.getByRole("heading", { name: "Review your plan idea" }),
    ).toBeVisible();
    await alice
      .getByLabel("What are we planning?")
      .fill("Reviewed agent dinner");
    await alice.getByRole("checkbox", { name: "Alice", exact: true }).check();
    await alice.getByRole("checkbox", { name: "Bob", exact: true }).check();
    await alice.getByLabel("Area or venue").fill("Harbor cafe");
    await alice
      .getByLabel("Estimated maximum per person · USD", { exact: true })
      .fill("35");
    await alice.getByLabel("Event time zone").fill("UTC");
    await alice.getByLabel("Starts", { exact: true }).fill("2035-02-05T19:00");
    await alice.getByLabel("Ends", { exact: true }).fill("2035-02-05T21:00");
    expect(
      await alice.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await alice.screenshot({
      path: testInfo.outputPath("proposal-review-mobile.png"),
      fullPage: true,
    });
    await alice
      .getByRole("button", { name: "Save plan draft", exact: true })
      .click();
    await expect(alice).toHaveURL(/view=plan&plan=/);
    const saved = await (
      await alice.request.get(`/api/dinner/agent/plan-proposals/${proposal.id}`)
    ).json();
    const plan = await (
      await alice.request.get(
        `/api/dinner/rooms/${roomId}/plans/${saved.appliedPlanId}`,
      )
    ).json();
    expect(plan.state).toBe("draft");
    expect(plan.title).toBe("Reviewed agent dinner");
    expect(plan.budgetCents).toBe(3500);
    await alice
      .getByRole("button", { name: "Publish options", exact: true })
      .click();
    await expect(
      alice.getByRole("heading", {
        name: "Reviewed agent dinner",
        exact: true,
      }),
    ).toBeVisible();
    const published = await (
      await alice.request.get(
        `/api/dinner/rooms/${roomId}/plans/${saved.appliedPlanId}`,
      )
    ).json();
    expect(published.state).toBe("collecting");
    await bob.reload();
    await expect(
      bob.getByRole("article", {
        name: "Plan: Reviewed agent dinner",
        exact: true,
      }),
    ).toBeVisible();
    await alice.goto(`/app/rooms/${roomId}?view=plan&proposal=${proposal.id}`);
    await expect(
      alice.getByRole("link", { name: "Open saved plan ↗", exact: true }),
    ).toBeVisible();
    // Continue the same human-reviewed proposal through the completed outing
    // and actual-bill flow; only the fixture's plan clock is advanced.
    let finalPlan = published;
    async function command(page: Page, action: string, extra = {}) {
      const response = await page.request.post(
        `/api/dinner/rooms/${roomId}/plans/${finalPlan.id}/commands`,
        {
          data: {
            action,
            clientId: crypto.randomUUID(),
            ...(action === "decide"
              ? {}
              : { expectedRevision: finalPlan.revision }),
            ...extra,
          },
        },
      );
      expect(response.ok()).toBe(true);
      finalPlan = await response.json();
    }
    await command(alice, "propose", {
      terms: {
        localStart: "2035-02-05T19:00",
        localEnd: "2035-02-05T21:00",
        timeZone: "UTC",
        location: "Harbor cafe",
        budgetCents: 3500,
      },
    });
    for (const page of [alice, bob])
      await command(page, "decide", {
        termsVersion: finalPlan.termsVersion,
        expectedDecisionVersion: 0,
        decision: "accepted",
      });
    await command(alice, "finalize");
    expect(
      (
        await alice.request.post("/api/test/time", {
          data: { now: "2035-02-06T00:00:00Z" },
        })
      ).ok(),
    ).toBe(true);
    await alice.clock.setFixedTime(new Date("2035-02-06T00:00:00Z"));
    await alice.goto(`/app/rooms/${roomId}?view=plan&plan=${finalPlan.id}`);
    await alice
      .getByRole("button", { name: "Mark outing complete", exact: true })
      .click();
    await alice
      .getByRole("link", { name: "Prepare outing expense ↗", exact: true })
      .click();
    await expect(
      alice.getByRole("heading", {
        name: "Expense from completed outing",
        exact: true,
      }),
    ).toBeVisible();
    await expect(alice.getByLabel("Total (USD)", { exact: true })).toHaveValue(
      "",
    );
    await expect(alice.getByLabel("Who paid?", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      alice.getByRole("checkbox", { name: "Alice", exact: true }),
    ).toBeChecked();
    await expect(
      alice.getByRole("checkbox", { name: "Bob", exact: true }),
    ).toBeChecked();
    await expect(
      alice.getByRole("checkbox", { name: "Carol", exact: true }),
    ).not.toBeChecked();
    await alice.getByLabel("Total (USD)", { exact: true }).fill("70.01");
    await alice
      .getByLabel("Who paid?", { exact: true })
      .selectOption(plan.creatorId);
    await expect(
      alice.getByLabel("Alice’s share in USD", { exact: true }),
    ).toHaveValue("35.01");
    await expect(
      alice.getByLabel("Bob’s share in USD", { exact: true }),
    ).toHaveValue("35.00");
    expect(
      await alice.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await alice.screenshot({
      path: testInfo.outputPath("outing-expense-mobile.png"),
      fullPage: true,
    });
    await alice
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(
      alice.getByText(
        "This outing already has an expense below. Review it in Money.",
      ),
    ).toBeVisible();
    const roomWithDraft = await (
      await alice.request.get(`/api/dinner/rooms/${roomId}`)
    ).json();
    const draft = roomWithDraft.expenses.find(
      (e: { sourcePlanId?: string }) => e.sourcePlanId === finalPlan.id,
    );
    expect(draft.status).toBe("draft");
    expect(draft.totalCents).toBe(7001);
    expect(draft.obligations).toBeUndefined();
    await bob.goto(`/app/rooms/${roomId}?view=money&fromPlan=${finalPlan.id}`);
    await expect(
      bob.getByText(
        "This outing already has an expense below. Review it in Money.",
      ),
    ).toBeVisible();
    await expect(
      bob.getByRole("heading", { name: "Expense from completed outing" }),
    ).toHaveCount(0);
    await alice
      .getByRole("button", { name: "Confirm expense", exact: true })
      .click();
    await expect(
      alice.getByText("Confirmed expense · obligation record", { exact: true }),
    ).toBeVisible();
    const confirmedRoom = await (
      await alice.request.get(`/api/dinner/rooms/${roomId}`)
    ).json();
    const confirmed = confirmedRoom.expenses.find(
      (e: { id: string }) => e.id === draft.id,
    );
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.obligations).toHaveLength(1);
    expect(confirmed.obligations[0].cents).toBe(3500);
    expect(
      confirmedRoom.expenses.filter(
        (e: { sourcePlanId?: string }) => e.sourcePlanId === finalPlan.id,
      ),
    ).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await alice.request.post("/api/test/time", { data: { now: null } });
    await a.close();
    await b.close();
  }
});
