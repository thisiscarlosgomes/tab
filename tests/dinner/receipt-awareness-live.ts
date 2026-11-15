import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import sharp from "sharp";
import { DinnerService } from "../../src/lib/dinner/service";
import { MongoRoomStore } from "../../src/lib/dinner/mongo-store";
import { DinnerAgentService } from "../../src/lib/dinner/agent/service";
import { Attachments } from "../../src/lib/dinner/attachments";
import { parseReceipt } from "../../src/lib/receipt";

// Opt-in: real configured model and OCR, disposable Mongo only. Never writes production.
async function main() {
  assert.ok(process.env.OPENAI_API_KEY);
  const screenshot = process.argv[2];
  assert.ok(screenshot, "Pass the receipt screenshot path");
  const bytes = await sharp(screenshot).extract({ left: 1119, top: 140, width: 480, height: 520 }).png().toBuffer();
  const mongo = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongo.getUri());
  const transcript: unknown[] = [];
  try {
    const db = client.db("isolated-awareness");
    const dinner = new DinnerService(new MongoRoomStore(db));
    const actor = { id: randomUUID(), name: "Carlos", twitterSubject: null };
    const other = { id: randomUUID(), name: "tab", twitterSubject: null };
    const room = await dinner.create(actor, { clientId: randomUUID(), name: "Isolated receipt replay", purpose: "Test only" });
    const invite = await dinner.invite(room.id, actor, { clientId: randomUUID() });
    await dinner.respond(other, { token: invite.token }, "accepted");
    const image = await new Attachments(db, dinner).upload(room.id, actor, new Request(`http://test?clientId=${randomUUID()}`, { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array(bytes) }));
    let parses = 0;
    const service = () => new DinnerAgentService(db, dinner, undefined, async (url) => {
      parses++;
      const result = await parseReceipt(url);
      transcript.push({ extraction: result });
      return result;
    });
    async function send(text: string, tagged = true, attachments: string[] = []) {
      const m = await dinner.send(room.id, actor, { clientId: randomUUID(), text, attachmentIds: attachments });
      transcript.push({ user: text });
      if (!tagged) {
        await assert.rejects(service().respond(actor, { kind: "room", roomId: room.id }, m.id));
        return "";
      }
      const reply = await service().respond(actor, { kind: "room", roomId: room.id }, m.id);
      transcript.push({ agent: reply.text });
      console.log(JSON.stringify({ user: text, agent: reply.text }));
      assert.equal(reply.status, "complete");
      return reply.text;
    }
    await send("help me create a tab for this receipt", false, [image.id]);
    const first = await send("@tab check message above");
    assert.match(first, /84\.80/);
    assert.doesNotMatch(first, /What is the total/);
    await send("@tab i paid");
    await send("everyone in this group", false);
    await send("@tab check message above");
    const people = await send("everyone in this group @tab");
    assert.match(people, /Sharing: Carlos, tab\./);
    const task = await db.collection("dinner-pending-expenses").findOne({ userId: actor.id });
    assert.equal(task?.payerId, actor.id);
    assert.deepEqual([...task!.participantIds].sort(), [actor.id, other.id].sort());
    if (!task?.totalCents) {
      assert.match(people, /Is that USD\?/);
      await send("@tab yes USD");
    }
    const final = await send("@tab split equally");
    assert.match(final, /\$84\.80/);
    assert.match(final, /Carlos \$42\.40/);
    assert.match(final, /tab \$42\.40/);
    const proposals = await service().roomProposals(actor, room.id);
    assert.equal(proposals.length, 1);
    assert.equal((await dinner.memberRoom(room.id, actor)).expenses.length, 0);
    assert.equal(parses, 1);
    console.log("PASS: real OCR + real model, untagged silence, reference awareness, payer/participants retained, one review proposal, no confirmed expense");
  } finally {
    await writeFile("/tmp/tab-receipt-awareness-live.json", JSON.stringify(transcript, null, 2));
    await client.close();
    await mongo.stop();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
