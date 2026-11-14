import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Page } from "playwright";
import sharp from "sharp";
import { startHarness } from "./browser/harness";
import { runTabAgent } from "../../src/lib/dinner/agent/runtime";
import type { AgentRunner } from "../../src/lib/dinner/agent/capabilities";
import { pendingExpenseRunner } from "./experiments/pending-runner";
import { parseReceipt } from "../../src/lib/receipt";

const live = process.argv.includes("--live");
if (live && !process.env.OPENAI_API_KEY)
  throw new Error("Live browser tests require the existing OPENAI_API_KEY.");
const pendingApproach = process.argv.includes("--pending");
const gap = process.argv.includes("--gap");
const legacy = process.argv.includes("--legacy");
const odd = process.argv.includes("--odd");
const totalCents = odd ? 8481 : 8480;
if (pendingApproach && !live)
  throw new Error("Pending approach is a live-model experiment");
const artifactName = process.argv
  .find((arg) => arg.startsWith("--artifact-name="))
  ?.split("=")[1];
if (artifactName && !/^[a-z0-9-]+$/.test(artifactName))
  throw new Error("Invalid artifact name");
const artifacts = `/tmp/tab-browser-${artifactName ?? (live ? "live" : "controlled")}`;
async function until(check: () => Promise<boolean>, timeout = 60000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end)
      throw new Error("Timed out waiting for saved conversation state");
    await delay(50);
  }
}

test(
  `room chat browser journey (${live ? "live model + receipt OCR" : "controlled model"})`,
  { timeout: 240000 },
  async (t) => {
    let calls = 0;
    let failNextReply = false;
    let extractions = 0;
    let pause: Promise<void> | undefined;
    let release: (() => void) | undefined;
    const contexts: string[] = [];
    const timings: { message: string; milliseconds: number; reply?: string }[] =
      [];
    let harness: Awaited<ReturnType<typeof startHarness>>;
    const controlled: AgentRunner = async (context) => {
      if (failNextReply) {
        failNextReply = false;
        context.onDelta?.("Interrupted test reply");
        throw new Error("Injected stream interruption");
      }
      const facts = (await context.readRoom(harness.room.id)) as {
        outstandingStatements: string[];
      };
      const latest =
        context.conversation
          .filter(
            (m) =>
              m.role === "user" && !m.content.startsWith("Receipt extraction"),
          )
          .at(-1)?.content ?? "";
      const workflow = await context.pendingExpense?.();
      if (workflow) {
        const state = await workflow.update({
          payer: latest.includes("was the payer")
            ? "me"
            : latest.includes("Bob paid")
              ? "Bob"
              : null,
          participants: latest.includes("between Alice and Bob")
            ? ["Alice", "Bob"]
            : null,
          splitEqually: latest.includes("equally") ? true : null,
          totalUsd: null,
        });
        await context.recordTool(
          "update_pending_expense",
          "room-prepare",
          state.status,
        );
        context.onDelta?.(state.reply);
        return state.reply;
      }
      let reply: string;
      if (latest.includes("split this receipt")) {
        assert.match(context.conversation.at(-1)?.content ?? "", /84.8/);
        reply = "The receipt is $84.80. Who paid, and who should share it?";
      } else if (latest.includes("was the payer")) {
        assert.equal(context.requester?.userId, harness.alice.id);
        reply = "Alice paid. Who else should share the receipt?";
      } else if (latest.includes("Alice and Bob")) {
        const extraction = context.conversation.findLast((m) =>
          m.content.startsWith("Receipt extraction"),
        );
        assert.ok(extraction);
        const attachmentId = JSON.parse(
          extraction.content
            .slice(extraction.content.indexOf("{"))
            .split(". Ask for missing")[0],
        ).attachmentId as string;
        const proposal = await context.prepareExpense({
          roomId: harness.room.id,
          attachmentId,
          payerId: harness.alice.id,
          shares: [
            { userId: harness.alice.id, cents: 4240 },
            { userId: harness.bob.id, cents: 4240 },
          ],
        });
        assert.ok("id" in proposal);
        await context.recordTool(
          "prepare_expense",
          "room-prepare",
          "review_proposal",
        );
        reply =
          "The $84.80 receipt split is ready for review. Alice paid; Alice and Bob share $42.40 each.";
      } else if (latest.includes("what time")) {
        if (
          !context.conversation.some((m) =>
            m.content.includes("Dinner is at 7 pm"),
          )
        ) {
          const history = await context.searchRoomHistory!({
            query: "dinner",
            beforeSeq: null,
            limit: null,
          });
          assert.ok(
            history.messages.some((m) => m.text.includes("Dinner is at 7 pm")),
          );
          await context.recordTool("search_room_history", "room-read", "read");
        }
        reply = "Dinner is at 7 pm.";
      } else reply = facts.outstandingStatements.join("\n");
      context.onDelta?.(reply.slice(0, 10));
      if (pause) await pause;
      context.onDelta?.(reply.slice(10));
      return reply;
    };
    harness = await startHarness(
      async (context) => {
        calls++;
        const serialized = JSON.stringify(context.conversation);
        contexts.push(serialized);
        assert.doesNotMatch(serialized, /OTHER_ROOM_SECRET/);
        assert.equal(context.requester?.userId, harness.alice.id);
        await assert.rejects(context.readRoom(harness.other.id));
        const started = performance.now();
        const reply = await (live
          ? pendingApproach
            ? pendingExpenseRunner(harness.db, harness.dinner)(context)
            : runTabAgent(
                legacy ? { ...context, pendingExpense: undefined } : context,
              )
          : controlled(context));
        timings.push({
          message: context.request?.text ?? "",
          milliseconds: Math.round(performance.now() - started),
          reply,
        });
        return reply;
      },
      async (image) => {
        extractions++;
        return live
          ? parseReceipt(image)
          : {
              merchant: "Test Dinner",
              totalAmount: totalCents / 100,
              currency: "USD",
              items: [],
              confidence: 0.99,
            };
      },
    );
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const browserErrors: string[] = [];
    const failedRequests: string[] = [];
    const snapshot = () =>
      harness.dinner.memberRoom(harness.room.id, harness.alice);
    const runCount = () =>
      harness.db.collection("dinner-agent-runs").countDocuments({});
    const proposals = () =>
      harness.db
        .collection("dinner-agent-proposals")
        .find({ roomId: harness.room.id })
        .toArray();
    let page: Page;
    const api = (suffix: string, body: unknown) =>
      page.evaluate(
        async ({ suffix, body }) => {
          // The fixture identity is read from the same browser request header, never a production token.
          const response = await fetch(`/api/dinner${suffix}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Authorization:
                document.documentElement.dataset.testAuthorization!,
            },
            body: JSON.stringify(body),
          });
          return { status: response.status, body: await response.json() };
        },
        { suffix, body },
      );
    async function send(text: string) {
      await page.getByRole("textbox", { name: "Message the room" }).fill(text);
      await page
        .getByRole("textbox", { name: "Message the room" })
        .press("Enter");
      await until(async () =>
        (await snapshot()).messages.some((m) => m.text === text),
      );
      return (await snapshot()).messages.findLast((m) => m.text === text)!;
    }
    async function tagged(text: string) {
      const source = await send(text);
      await until(async () =>
        (await snapshot()).messages.some(
          (m) => m.kind === "tab" && m.runId === source.id,
        ),
      );
      const reply = (await snapshot()).messages.find(
        (m) => m.kind === "tab" && m.runId === source.id,
      )!;
      await page.getByText(reply.text, { exact: true }).first().waitFor();
      return { source, reply };
    }
    try {
      await mkdir(artifacts, { recursive: true });
      browser = await chromium.launch(
        process.argv.includes("--chrome") ? { channel: "chrome" } : {},
      );
      const browserContext = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      await browserContext.tracing.start({
        screenshots: true,
        snapshots: true,
      });
      page = await browserContext.newPage();
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("requestfailed", (request) => {
        if (!request.failure()?.errorText.includes("ERR_ABORTED"))
          failedRequests.push(request.url());
      });
      page.on("request", (request) => {
        const auth = request.headers().authorization;
        if (auth)
          void page
            .evaluate((auth) => {
              document.documentElement.dataset.testAuthorization = auth;
            }, auth)
            .catch(() => {});
      });
      let releaseIdentity!: () => void;
      const identityGate = new Promise<void>((resolve) => {
        releaseIdentity = resolve;
      });
      await page.route("**/api/dinner/me", async (route) => {
        await identityGate;
        await route.continue();
      });
      await page.goto(`${harness.url}/app/rooms/${harness.room.id}`);
      await page.getByRole("status", { name: "Loading page" }).waitFor();
      await page.screenshot({ path: `${artifacts}/page-skeleton.png` });
      releaseIdentity();

      await page.getByRole("textbox", { name: "Message the room" }).waitFor();
      await t.test(
        "untagged chat does not run the agent; forced bot call is rejected",
        async () => {
          const message = await send("Dinner is at 7 pm. Bring your appetite.");
          assert.equal(calls, 0);
          assert.equal(await runCount(), 0);
          assert.equal(
            harness.requests.filter((r) => r.path.endsWith("/bot")).length,
            0,
          );
          assert.equal(
            (
              await api(`/rooms/${harness.room.id}/bot`, {
                messageId: message.id,
              })
            ).status,
            400,
          );
          assert.equal(await runCount(), 0);
        },
      );
      await t.test(
        "ordinary messages beyond the context window do not wake Tab",
        async () => {
          for (let i = 0; i < 27; i++)
            await send(`Looking forward to it, message ${i}`);
          assert.equal(calls, 0);
          assert.equal(await runCount(), 0);
        },
      );
      await t.test(
        "tagged question uses preceding room conversation and persists one streamed reply",
        async () => {
          const { source, reply } = await tagged("@Tab what time is dinner?");
          assert.match(reply.text, /7(?::00)?\s*p\.?m/i);
          const run = await harness.db
            .collection("dinner-agent-runs")
            .findOne({ "tools.name": "search_room_history" });
          assert.ok(
            run,
            "earlier plan must be recovered through audited history retrieval",
          );
          assert.equal(
            (await snapshot()).messages.filter(
              (m) => m.kind === "tab" && m.runId === source.id,
            ).length,
            1,
          );
          await page.reload();
          await page.getByText(reply.text, { exact: true }).first().waitFor();
        },
      );
      await t.test(
        "balance reply preserves creditor direction and cents",
        async () => {
          const { reply } = await tagged("@Tab who owes whom?");
          assert.match(
            reply.text.replace(/[*_`]/g, ""),
            /Bob owes (?:you,?\s*)?(?:Alice,?\s*)?\$0\.50/i,
          );
          assert.doesNotMatch(reply.text, /\$50\b/);
        },
      );
      await t.test(
        "receipt upload without tag remains ordinary conversation",
        async () => {
          const before = calls;
          const buffer = await sharp(
            Buffer.from(
              '<svg width="640" height="400"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="sans-serif" font-size="32"><text x="40" y="65">TEST DINNER RECEIPT</text><text x="40" y="130">Dinner for two     USD 84.80</text><text x="40" y="200">TOTAL USD 84.80</text><text x="40" y="270">Thank you</text></g></svg>'.replaceAll(
                "84.80",
                (totalCents / 100).toFixed(2),
              ),
            ),
          )
            .png()
            .toBuffer();
          await page.locator('input[type="file"]').setInputFiles({
            name: "receipt.png",
            mimeType: "image/png",
            buffer,
          });
          await page
            .getByRole("button", { name: "Send", exact: true })
            .waitFor();
          await until(
            async () =>
              !(await page
                .getByRole("button", { name: "Send", exact: true })
                .isDisabled()),
          );
          const posted = await send("Here is the dinner receipt.");
          assert.equal(posted.attachmentIds.length, 1);
          assert.equal(calls, before);
          assert.equal(extractions, 0);
        },
      );
      await t.test(
        "receipt → payer → participants yields one review proposal, no confirmed expense",
        async () => {
          const first = await tagged("@Tab split this receipt equally");
          assert.match(first.reply.text, /84\.8[01]|payer|paid/i);
          const payer = await tagged(
            gap ? "@Tab Bob paid" : "@Tab i was the payer",
          );
          assert.match(payer.reply.text, /who|participants|share/i);
          assert.equal(
            (await proposals()).length,
            0,
            "Payer alone must not choose participants",
          );
          if (live && !legacy) {
            const task = await harness.db
              .collection(
                pendingApproach
                  ? "experiment-pending-expenses"
                  : "dinner-pending-expenses",
              )
              .findOne({ userId: harness.alice.id, roomId: harness.room.id });
            assert.equal(
              task?.payerId,
              gap ? harness.bob.id : harness.alice.id,
              "Payer must be saved independently of chat history",
            );
            assert.equal(
              task?.participantIds,
              null,
              "No guessed participants in pending state",
            );
          }
          if (gap) {
            for (let i = 0; i < 30; i++)
              await harness.dinner.send(harness.room.id, harness.bob, {
                clientId: randomUUID(),
                text: `Unrelated table chatter ${i + 1}.`,
              });
            harness.restartAgent();
            await page.reload();
            await page
              .getByRole("textbox", { name: "Message the room" })
              .waitFor();
          }
          const complete = await tagged(
            "@Tab split it equally between Alice and Bob",
          );
          assert.equal(
            (await proposals()).length,
            1,
            "Receipt task must finish without asking the payer again",
          );
          if (gap)
            assert.doesNotMatch(
              contexts.at(-1)!,
              /i was the payer|Bob paid/i,
              "The test must actually evict payer history",
            );
          if (live && !legacy && !pendingApproach) {
            assert.doesNotMatch(
              complete.reply.text,
              /\bowes?\b|\bowed\b/i,
              "Review shares must not be described as debts",
            );
            assert.match(complete.reply.text, /Shares:/);
          }
          const proposal = (await proposals())[0];
          assert.equal(proposal.fields.totalCents, totalCents);
          assert.equal(
            proposal.fields.payerId,
            gap ? harness.bob.id : harness.alice.id,
          );
          assert.deepEqual(
            proposal.fields.shares
              .map((s: { cents: number }) => s.cents)
              .sort(),
            [Math.floor(totalCents / 2), Math.ceil(totalCents / 2)],
          );
          assert.equal(proposal.correctionOf, undefined);
          assert.equal(proposal.appliedExpenseId, null);
          assert.equal(
            (await snapshot()).expenses.length,
            1,
            "Only pre-existing confirmed expense remains",
          );
          assert.equal(
            extractions,
            1,
            "Follow-ups reuse the cached extraction",
          );
          await page
            .getByRole("button", { name: "Edit" })
            .waitFor();
          const before = calls;
          const retries = await Promise.all([
            api(`/rooms/${harness.room.id}/bot`, {
              messageId: complete.source.id,
            }),
            api(`/rooms/${harness.room.id}/bot`, {
              messageId: complete.source.id,
            }),
          ]);
          assert.ok(retries.every((r) => r.status === 200));
          assert.equal(calls, before);
          assert.equal((await proposals()).length, 1);
          assert.equal(
            (await snapshot()).messages.filter(
              (m) => m.kind === "tab" && m.runId === complete.source.id,
            ).length,
            1,
          );
        },
      );
      await t.test(
        "human saves proposal as a draft without changing confirmed balances",
        async (subtest) => {
          if (!(await proposals()).length) {
            subtest.skip("No proposal from preceding scenario");
            return;
          }
          await page
            .getByRole("button", { name: "Edit", exact: true })
            .click();
          await until(async () => (await snapshot()).expenses.length === 2);
          await page.getByRole("button", { name: "Close", exact: true }).click();
          const saved = (await snapshot()).expenses.find(
            (expense) => expense.totalCents === totalCents,
          )!;
          assert.equal(saved.status, "draft");
          assert.equal(
            (await snapshot()).expenses.filter(
              (expense) => expense.status === "confirmed",
            ).length,
            1,
          );
          assert.equal((await proposals())[0].appliedExpenseId, saved.id);
        },
      );
      if (!live)
        await t.test(
          "interrupted stream keeps the member message and UI retry saves one reply",
          async () => {
            failNextReply = true;
            const source = await send(
              "@Tab retry the balance after interruption",
            );
            await page
              .getByRole("status")
              .filter({ hasText: "The member message is saved" })
              .waitFor();
            assert.equal(
              (await snapshot()).messages.filter(
                (m) => m.kind === "tab" && m.runId === source.id,
              ).length,
              0,
            );
            await page
              .getByRole("button", { name: "Ask Tab to reply", exact: true })
              .click();
            await until(async () =>
              (await snapshot()).messages.some(
                (m) => m.kind === "tab" && m.runId === source.id,
              ),
            );
            assert.equal(
              (await snapshot()).messages.filter((m) => m.text === source.text)
                .length,
              1,
            );
            assert.equal(
              (await snapshot()).messages.filter(
                (m) => m.kind === "tab" && m.runId === source.id,
              ).length,
              1,
            );
          },
        );
      if (!live)
        await t.test(
          "in-flight retry is deduplicated and later messages do not enter earlier context",
          async () => {
            pause = new Promise((resolve) => {
              release = resolve;
            });
            const callsBeforeSend = calls;
            const source = await send("@Tab show the current balance again");
            // Typing feedback starts during save, before the agent run acquires its lease.
            await until(async () => calls > callsBeforeSend);
            await page
              .getByRole("article", { name: "Tab reply" })
              .waitFor();
            const before = calls;
            const retry = await api(`/rooms/${harness.room.id}/bot`, {
              messageId: source.id,
            });
            assert.equal(retry.body.status, "running");
            await api(`/rooms/${harness.room.id}/messages`, {
              clientId: randomUUID(),
              text: "LATER_MESSAGE_SENTINEL",
            });
            assert.doesNotMatch(contexts.at(-1)!, /LATER_MESSAGE_SENTINEL/);
            assert.equal(calls, before);
            release!();
            pause = undefined;
            await until(async () =>
              (await snapshot()).messages.some(
                (m) => m.kind === "tab" && m.runId === source.id,
              ),
            );
          },
        );
      await t.test(
        "other room access is denied and UI remains usable on mobile",
        async () => {
          const result = await page.evaluate(
            async (id) =>
              (
                await fetch(`/api/dinner/rooms/${id}`, {
                  headers: {
                    Authorization:
                      document.documentElement.dataset.testAuthorization!,
                  },
                })
              ).status,
            harness.other.id,
          );
          assert.ok([403, 404].includes(result));
          await page.setViewportSize({ width: 390, height: 844 });
          await page
            .getByRole("textbox", { name: "Message the room" })
            .waitFor();
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          await page.screenshot({
            path: `${artifacts}/conversation.png`,
            fullPage: true,
          });
        },
      );
      await t.test("Markdown formats bold and lists in saved chat bubbles", async () => {
        await page.setViewportSize({ width: 1100, height: 1100 });
        const input = page.getByRole("textbox", { name: "Message the room" });
        await input.fill("In your rooms:\n\n1. **Friday Dinner by tab**: You are owed *$0.50*.\n2. **Friday Dinner**: No one owes anything.");
        await input.press("Enter");
        await page.locator(".chat-markdown strong").filter({ hasText: "Friday Dinner by tab" }).waitFor();
        assert.ok(await page.locator(".chat-markdown ol > li").count() >= 2);
        assert.ok(await page.locator(".chat-markdown em").filter({ hasText: "$0.50" }).count());
        await page.screenshot({ path: `${artifacts}/markdown.png`, fullPage: true });
      });
      await t.test("review, edit and confirm the same bill inside chat", async () => {
        if (!(await proposals()).length) return;
        const proposal = (await proposals())[0];
        const original = (await snapshot()).expenses.find((e) => e.id === proposal.appliedExpenseId)!;
        await page.getByRole("button", { name: "Edit", exact: true }).click();
        const review = page.getByRole("region", { name: "Edit bill" });
        await review.screenshot({ path: `${artifacts}/bill-review.png` });
        await review.getByLabel("Bill description").fill("Reviewed dinner bill");
        assert.equal(await review.getByRole("button", { name: "Confirm" }).count(), 0);
        await review.getByRole("button", { name: "Save changes" }).click();
        await until(async () => (await snapshot()).expenses.find((e) => e.id === original.id)?.description === "Reviewed dinner bill");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "Confirm", exact: true }).click();
        await until(async () => (await snapshot()).expenses.find((e) => e.id === original.id)?.status === "confirmed");
        await page.getByText("Confirmed", { exact: true }).waitFor();
        assert.equal((await snapshot()).expenses.length, 2);
        await page.screenshot({ path: `${artifacts}/confirmed-bill.png`, fullPage: true });
      });
      assert.deepEqual(browserErrors, []);
      assert.deepEqual(harness.errors, []);
      assert.deepEqual(failedRequests, []);
      assert.equal(harness.requests.filter((r) => r.status >= 500).length, 0);
      await browserContext.tracing.stop({ path: `${artifacts}/trace.zip` });
      await writeFile(
        `${artifacts}/evidence.json`,
        JSON.stringify(
          {
            mode: live ? "live" : "controlled",
            approach: pendingApproach
              ? "experimental"
              : legacy
                ? "legacy"
                : "production",
            scenario: gap
              ? "history-gap-and-restart"
              : odd
                ? "odd-cent-total"
                : "short-follow-up",
            timings,
            model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
            savedMessages: (await snapshot()).messages,
            proposals: await proposals(),
            pendingEvents: await harness.db
              .collection("experiment-pending-events")
              .find({})
              .toArray(),
            pendingTasks: await harness.db
              .collection(
                pendingApproach
                  ? "experiment-pending-expenses"
                  : "dinner-pending-expenses",
              )
              .find({})
              .toArray(),
            runs: await harness.db
              .collection("dinner-agent-runs")
              .find({})
              .toArray(),
            calls,
            extractions,
            requests: harness.requests,
            browserErrors,
            failedRequests,
          },
          null,
          2,
        ),
      );
      console.log(`Browser evidence: ${artifacts}`);
    } finally {
      release?.();
      await browser?.close();
      await harness.close();
    }
  },
);
