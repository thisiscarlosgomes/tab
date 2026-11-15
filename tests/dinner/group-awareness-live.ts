import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { DinnerService } from "../../src/lib/dinner/service";
import { MongoRoomStore } from "../../src/lib/dinner/mongo-store";
import { DinnerAgentService } from "../../src/lib/dinner/agent/service";
import { runTabAgent } from "../../src/lib/dinner/agent/runtime";
import type { AgentContext } from "../../src/lib/dinner/agent/capabilities";
import type { Actor } from "../../src/lib/dinner/model";

type Entry = {
  name: string;
  history: { sender: string; text: string }[];
  question: string;
  searches: { input: Parameters<NonNullable<AgentContext["searchRoomHistory"]>>[0]; sequences: number[]; texts: string[] }[];
  tools: { tool: string; scope: string; outcome: string }[];
  coverage?: AgentContext["historyCoverage"];
  visible?: AgentContext["conversation"];
  reply?: string;
  pass?: boolean;
  error?: string;
};
type CompletedEntry = Entry & { reply: string; coverage: NonNullable<AgentContext["historyCoverage"]> };

// Opt-in real-model evaluation. All rooms and writes use disposable Mongo, never .env's Mongo URI.
async function main() {
  assert.ok(process.env.OPENAI_API_KEY, "A configured model key is required");
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  const report: Entry[] = [];
  try {
    const db = client.db("group-awareness-isolated");
    const dinner = new DinnerService(new MongoRoomStore(db));
    const people = ["Carlos", "Ana", "tab", "Lea"].map((name): Actor => ({ id: randomUUID(), name, twitterSubject: null }));
    const [carlos, ana, tab, lea] = people;
    async function room(name: string) {
      const r = await dinner.create(carlos, { clientId: randomUUID(), name, purpose: "Disposable awareness evaluation" });
      for (const actor of people.slice(1)) {
        const invite = await dinner.invite(r.id, carlos, { clientId: randomUUID() });
        await dinner.respond(actor, { token: invite.token }, "accepted");
      }
      return r;
    }
    async function post(roomId: string, actor: Actor, text: string) {
      return dinner.send(roomId, actor, { clientId: randomUUID(), text });
    }
    async function scenario(name: string, history: [Actor, string][], question: string, check: (entry: CompletedEntry) => void, future?: string, requester = carlos) {
      const r = await room(name);
      const entry: Entry = { name, history: history.map(([actor, text]) => ({ sender: actor.name, text })), question, searches: [], tools: [] };
      report.push(entry);
      let calls = 0;
      const agent = new DinnerAgentService(db, dinner, async (context) => {
        calls++;
        entry.coverage = context.historyCoverage;
        entry.visible = context.conversation;
        if (future) await post(r.id, ana, future);
        return runTabAgent({ ...context,
          searchRoomHistory: async (input) => {
            const result = await context.searchRoomHistory!(input);
            entry.searches.push({ input, sequences: result.messages.map((m) => m.seq), texts: result.messages.map((m) => m.text) });
            return result;
          },
          recordTool: async (tool, scope, outcome) => {
            entry.tools.push({ tool, scope, outcome });
            await context.recordTool(tool, scope, outcome);
          },
        });
      });
      for (const [actor, text] of history) {
        const m = await post(r.id, actor, text);
        await assert.rejects(agent.respond(actor, { kind: "room", roomId: r.id }, m.id));
      }
      assert.equal(calls, 0, "Untagged messages must never invoke the model");
      const source = await post(r.id, requester, question);
      try {
        const result = await agent.respond(requester, { kind: "room", roomId: r.id }, source.id);
        entry.reply = result.text;
        assert.equal(result.status, "complete");
        assert.equal(calls, 1);
        assert.ok(entry.coverage);
        assert.ok(entry.coverage.visibleMessages <= 25);
        for (const search of entry.searches) assert.ok(search.sequences.every((seq: number) => seq <= source.seq));
        check({ ...entry, reply: result.text, coverage: entry.coverage });
        entry.pass = true;
      } catch (error) {
        entry.pass = false;
        entry.error = error instanceof Error ? error.message : String(error);
      }
      console.log(JSON.stringify({ name, pass: entry.pass, coverage: entry.coverage, searches: entry.searches.length, reply: entry.reply, error: entry.error }));
      await writeFile("/tmp/tab-group-awareness-live.json", JSON.stringify(report, null, 2));
    }
    const chatter = (n: number): [Actor, string][] => Array.from({ length: n }, (_, i) => [people[i % people.length], ["The weather looks nice.", "I will charge my phone.", "The playlist sounds good.", "See you later."][i % 4] + ` (${i + 1})`]);
    const history: [Actor, string][] = [
      [carlos, "The reservation code is PINE-7319."],
      [carlos, "Let's eat at Orchid Quay at 19:00."],
      [ana, "I have a peanut allergy."],
      [tab, "I'll bring the cake."],
      [carlos, "I paid the restaurant deposit myself. This is just my report, not a confirmed Tab payment."],
      [lea, "I'm vegetarian, but I'm joining only for drinks; don't include me in dinner."],
      ...chatter(6),
      [ana, "Correction: the restaurant changed. Our final booking is Maple Lantern at 19:45, not Orchid Quay."],
      [tab, "Change of plan: I can't bring cake. Ana, can you bring it?"],
      [ana, "Yes, I'll bring the cake instead of tab."],
      [carlos, "Dinner participants are me, Ana and tab. Lea is drinks only."],
      ...chatter(8),
    ];
    await scenario("25-message mixed group context", history,
      "@Tab recap our current venue and time, reservation code, who reported paying the deposit, who is bringing cake, dinner participants versus drinks only, and dietary needs. Distinguish the member named tab from yourself. Do not treat the deposit claim as a verified payment.", (e) => {
        assert.equal(e.coverage.visibleMessages, 25);
        assert.equal(e.coverage.oldestVisibleSeq, 1);
        for (const pattern of [/Maple Lantern/i, /19:45|7:45/, /PINE-7319/, /Carlos/i, /Ana/i, /peanut/i, /vegetarian/i, /Lea/i, /drinks/i, /tab/i]) assert.match(e.reply, pattern);
        assert.match(e.reply, /(?:Ana.{0,60}cake|cake.{0,60}Ana)/is);
        assert.match(e.reply, /(?:Carlos.{0,100}deposit|deposit.{0,100}Carlos)/is);
      });
    await scenario("speaker attribution when another member tags Tab", [
      [carlos, "I booked the restaurant."], [ana, "I volunteered to buy the cake."],
      [tab, "I paid the restaurant deposit. This is my report, not verified payment."],
      [lea, "I arranged the taxi."], ...chatter(20),
    ], "@Tab what did I volunteer to do, who reported paying the deposit, and who arranged the taxi? Identify people by name; the member named tab is not you.", (e) => {
      assert.match(e.reply, /(?:you|Ana).{0,100}cake|cake.{0,100}(?:you|Ana)/is);
      assert.match(e.reply, /tab.{0,100}deposit|deposit.{0,100}tab/is);
      assert.match(e.reply, /Lea.{0,100}taxi|taxi.{0,100}Lea/is);
      assert.doesNotMatch(e.reply, /Carlos.{0,30}(?:paid|paying)/i);
    }, undefined, ana);
    await scenario("26-message boundary retrieves first message", [[carlos, "Reservation code: CEDAR-2864."], ...chatter(24)],
      "@Tab what reservation code did I share earlier?", (e) => {
        assert.equal(e.coverage.visibleMessages, 25);
        assert.equal(e.coverage.oldestVisibleSeq, 2);
        assert.ok(!JSON.stringify(e.visible).includes("CEDAR-2864"));
        assert.ok(e.searches.length > 0);
        assert.match(e.reply, /CEDAR-2864/);
      });
    await scenario("older correction retrieved beyond the window", [
      [carlos, "Reservation code is BIRCH-1001."], [ana, "Correction: the reservation code is now WILLOW-9007. The old BIRCH code is cancelled."], ...chatter(38),
    ], "@Tab which reservation code is current? Please use the latest correction.", (e) => {
      assert.ok(!JSON.stringify(e.visible).includes("WILLOW-9007"));
      assert.ok(e.searches.length > 0);
      assert.match(e.reply, /WILLOW-9007/);
    });
    const foreign = await room("Other unrelated room");
    await post(foreign.id, carlos, "Taxi pickup address: SECRET-PICKUP-992, Ocean Pier.");
    await scenario("unknown facts stay unknown; other room stays private", chatter(24),
      "@Tab where is our taxi pickup, and who booked it? If we haven't said, tell us rather than assume.", (e) => {
        assert.doesNotMatch(e.reply, /SECRET-PICKUP-992|Ocean Pier/);
        assert.match(e.reply, /not|haven.t|hasn.t|no |unknown|don.t|unspecified|missing/i);
      });
    await scenario("later messages cannot alter an earlier addressed question", [[carlos, "Reservation code is ASH-1122."], ...chatter(25)],
      "@Tab what is the reservation code from our conversation?", (e) => {
        assert.match(e.reply, /ASH-1122/);
        assert.doesNotMatch(e.reply, /FUTURE-7788/);
        assert.ok(!JSON.stringify(e.searches).includes("FUTURE-7788"));
      }, "Correction after the question: the reservation code is FUTURE-7788.");
    const failed = report.filter((e) => !e.pass);
    console.log(`RESULT: ${report.length - failed.length}/${report.length} scenarios passed. Evidence: /tmp/tab-group-awareness-live.json`);
    if (failed.length) process.exitCode = 1;
  } finally {
    await client.close();
    await mongo.stop();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
