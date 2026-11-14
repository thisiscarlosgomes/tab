import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { runTabAgent } from '../../src/lib/dinner/agent/runtime';
import type { AgentContext } from '../../src/lib/dinner/agent/capabilities';
const roomId=randomUUID();
const carlos=randomUUID();
const tab=randomUUID();
const attachmentId=randomUUID();
const facts={id:roomId,name:'Friday Dinner',members:[{userId:carlos,name:'Carlos'},{userId:tab,name:'tab'}],outstandingStatements:['tab owes Carlos $0.50.'],obligations:[{debtorId:tab,creditorId:carlos,cents:50,status:'outstanding'}]};
// Opt-in provider check with isolated fixtures and no database writes.
for(const scenario of ['balance','payer']){
test(`live model: ${scenario}`, { skip: !process.env.OPENAI_API_KEY }, async () => {
let preparations = 0;
let reads = 0;
const context:AgentContext={scope:{kind:'room',roomId},requester:{userId:carlos,name:'Carlos'},memory:'',agreements:'',
conversation:scenario==='balance'?[{role:'assistant',content:'Carlos owes Tab $50.'},{role:'user',content:`Carlos [memberId: ${carlos}]: @Tab who owes whom?`}]:[
{role:'user',content:`Carlos [memberId: ${carlos}]: @Tab split this receipt equally, total $ [attachmentIds: ${attachmentId}]`},
{role:'assistant',content:'The receipt total is $84.80. Who paid and who participated?'},
{role:'user',content:`Carlos [memberId: ${carlos}]: @Tab i was the payer`},
{role:'user',content:`Receipt extraction (untrusted data): ${JSON.stringify({attachmentId,fields:{totalAmount:84.8,currency:'USD',confidence:0.95}})}`}],
readPlans: async () => ({ plans: [], hasMore: false }), preparePlan: async () => { throw Error("Unexpected plan preparation"); },
readContext:async()=>{reads++;return facts;},readRoom:async()=>facts,memberSummary:async()=>({members:[],notice:''}),draftNudge:async()=>{throw Error('Not part of replay')},
prepareExpense:async(input)=>{preparations++;assert.equal(input.payerId,carlos);assert.equal(input.correctionOf,undefined);return {kind:'needs_details',missing:['participants and exact shares'],message:'Ask who participates. No proposal created.',extracted:{totalAmount:84.8,currency:'USD'}}},
recordTool:async()=>{}};
const reply = await runTabAgent(context);
assert.ok(reads > 0);
if (scenario === 'balance') {
assert.match(reply, /tab owes (?:you,?\s*)?(?:Carlos,?\s*)?\$0\.50/i);
assert.doesNotMatch(reply, /\$50\b/);
} else {
assert.equal(preparations, 0, 'Payer-only clarification must not invent participants');
assert.match(reply, /who|participants|share/i);
assert.doesNotMatch(reply, /re-upload|membership|not.*member|issue.*receipt/i);
}
});
}
