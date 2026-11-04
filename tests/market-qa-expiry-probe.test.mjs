import test from 'node:test';
import assert from 'node:assert/strict';
import {observeExpiry} from '../artifacts/market-published-qa/expiry-probe.mjs';
test('expiry observer waits through validator leeway and sends only one credential-free simulated probe',async()=>{
 let clock=0,calls=0;const waits=[];const result=await observeExpiry({expiresAt:900000,now:()=>clock,wait:async ms=>{assert.ok(ms>0&&ms<=30000);waits.push(ms);clock+=ms;},probe:async()=>{calls++;return {status:clock>930000?401:403};}});
 assert.equal(calls,1);assert.equal(result.rejected,true);assert.equal(result.httpStatus,401);assert.ok(clock>930000);assert.ok(waits.length>0);
});
for(const status of [200,403,503])test('status '+status+' is not mislabeled as expired-key rejection',async()=>{const result=await observeExpiry({expiresAt:0,now:()=>40000,probe:async()=>({status})});assert.equal(result.rejected,false);assert.equal(result.httpStatus,status);});
test('observation failure allows caller finally cleanup; invalid timing bounds never probe',async()=>{
 let cleaned=false,calls=0;try{await observeExpiry({expiresAt:0,now:()=>40000,probe:async()=>{throw Error('Synthetic transport outage')}});}catch(error){assert.match(error.message,/outage/);}finally{cleaned=true;}assert.equal(cleaned,true);
 await assert.rejects(observeExpiry({expiresAt:Infinity,probe:async()=>{calls++;}}),/bounds/);assert.equal(calls,0);
});
