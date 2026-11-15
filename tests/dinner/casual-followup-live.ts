import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { DinnerService } from "../../src/lib/dinner/service";
import { MongoRoomStore } from "../../src/lib/dinner/mongo-store";
import { DinnerAgentService } from "../../src/lib/dinner/agent/service";

test("live casual update and untagged follow-up in an existing room", {skip: !process.env.OPENAI_API_KEY}, async () => {
 const mongo = await MongoMemoryServer.create();
 const client = await MongoClient.connect(mongo.getUri());
 try {
  const db = client.db("casual-followup-test");
  const dinner = new DinnerService(new MongoRoomStore(db));
  const actor = {id: randomUUID(), name: "Carlos", twitterSubject: null};
  const room = await dinner.create(actor, {clientId: randomUUID(), name:"Existing conversation",purpose:"Isolated test"});
  await dinner.setAssistance(room.id, actor, "mentions");
  await dinner.send(room.id, actor, {clientId:randomUUID(),text:"Earlier room history"});
  const agent = new DinnerAgentService(db,dinner);
  for (const text of ["had a fantastic weekend @tab", "how are things"]) {
   const source = await dinner.send(room.id,actor,{clientId:randomUUID(),text});
   assert.equal((await agent.assessRoomMessage(actor,room.id,source.id)).action,"respond");
   const reply = await agent.respond(actor,{kind:"room",roomId:room.id},source.id);
   assert.equal(reply.status,"complete");
   assert.ok(reply.text.length);
   console.log(JSON.stringify({input:text,reply:reply.text,model:process.env.OPENAI_CHAT_MODEL||"gpt-4o-mini"}));
  }
  const saved = await dinner.memberRoom(room.id,actor);
  assert.equal(saved.messages.filter(m=>m.kind==="tab").length,2);
  assert.equal(saved.expenses.length,0);
  assert.equal(await db.collection("dinner-agent-plan-proposals").countDocuments(),0);
  assert.equal(await db.collection("dinner-agent-proposals").countDocuments(),0);
 } finally {await client.close();await mongo.stop();}
});
