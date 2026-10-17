import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {appId,keep,makePlan,validatePlan,createExpirer,executePlan,inventory} from './retire-other-testflight-builds.mjs';
const now=Date.parse('2026-10-17T23:00:00Z');
const oldId='c8da597f-f963-4650-8ed3-e0738b3572d4';
function rows(){return [{...keep,uploadedDate:'2026-10-17T22:23:34Z',expired:false,state:'VALID',expirationDate:'2027-01-15T22:23:34Z'},{id:oldId,version:'1.1.0',build:'32.1',uploadedDate:'2026-10-17T20:22:15Z',expired:false,state:'VALID',expirationDate:'2027-01-15T20:22:15Z'}];}
test('plan keeps newer upload despite its lower marketing version',()=>{
  const plan=makePlan(rows(),now);assert.deepEqual(plan.targets.map(b=>b.id),[oldId]);validatePlan(plan,rows(),now);
});
test('invalid, missing or expired protected build prevents any plan',()=>{
  for(const patch of [{expired:true},{state:'PROCESSING'},{version:'1.1.0'},{expirationDate:'2026-10-01T00:00:00Z'}]){const current=rows();Object.assign(current[0],patch);assert.throws(()=>makePlan(current,now),/Kept build/);}
  assert.throws(()=>makePlan(rows().slice(1),now),/Kept build/);
});
test('reviewed plan rejects other app, protected target, stale review and changed inventory',()=>{
  const plan=makePlan(rows(),now);
  assert.throws(()=>validatePlan({...plan,appId:'1'},rows(),now),/app or protected/);
  assert.throws(()=>validatePlan({...plan,targets:[keep]},rows(),now),/target list/);
  assert.throws(()=>validatePlan(plan,rows(),now+3600001),/stale/);
  assert.throws(()=>validatePlan(plan,rows().map(b=>b.id===oldId?{...b,build:'31.1'}:b),now),/inventory changed/);
  const newer={...rows()[1],id:'d8da597f-f963-4650-8ed3-e0738b3572d4',uploadedDate:'2026-10-17T22:30:00Z'};
  assert.throws(()=>makePlan([...rows(),newer],now),/newer upload/);
});
test('expired historical builds stay untouched and partial operations resume idempotently',async()=>{
  let current=rows(),calls=[];const plan=makePlan(current,now);current[1].expired=true;
  const result=await executePlan({plan,now,readInventory:async()=>structuredClone(current),verifyKeep:async()=>({available:true}),expire:async id=>calls.push(id)});
  assert.deepEqual(calls,[]);assert.equal(result.remainingActive.length,1);assert.equal(result.completed[0].alreadyExpired,true);
  assert.equal(makePlan(current,now).targets.length,0);
});
test('exact old build expiration is verified and kept build never mutated',async()=>{
  let current=rows(),calls=[],proofs=0;const plan=makePlan(current,now);
  const result=await executePlan({plan,now,readInventory:async()=>structuredClone(current),verifyKeep:async()=>{proofs++;return{available:true};},expire:async id=>{calls.push(id);current.find(b=>b.id===id).expired=true;}});
  assert.deepEqual(calls,[oldId]);assert.ok(proofs>=3);assert.deepEqual(result.remainingActive.map(b=>b.id),[keep.id]);assert.equal(result.verified,true);
});
test('lost keep access prevents mutation and incomplete expiration never reports success',async()=>{
  let calls=0;const current=rows(),plan=makePlan(current,now);
  await assert.rejects(executePlan({plan,now,readInventory:async()=>current,verifyKeep:async()=>{throw Error('not available');},expire:async()=>calls++}),/not available/);assert.equal(calls,0);
  await assert.rejects(executePlan({plan,now,readInventory:async()=>current,verifyKeep:async()=>true,expire:async()=>calls++}),/remain active/);
});
test('writer permits only exact allowlisted expired=true PATCH to Apple',async()=>{
  const {privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'}),calls=[];
  const env={APP_STORE_CONNECT_APP_ID:appId,APP_STORE_CONNECT_KEY_ID:'fixture',APP_STORE_CONNECT_ISSUER_ID:'fixture',APP_STORE_CONNECT_PRIVATE_KEY:privateKey};
  const expire=createExpirer(env,[oldId],async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({data:{id:oldId,attributes:{expired:true}}}),{status:200});});
  await expire(oldId);assert.equal(calls[0].url,'https://api.appstoreconnect.apple.com/v1/builds/'+oldId);assert.equal(calls[0].options.method,'PATCH');assert.equal(calls[0].options.redirect,'error');
  assert.deepEqual(JSON.parse(calls[0].options.body),{data:{type:'builds',id:oldId,attributes:{expired:true}}});
  await assert.rejects(expire(keep.id),/reviewed/);await assert.rejects(expire('../apps/1'),/reviewed/);assert.equal(calls.length,1);
  assert.throws(()=>createExpirer(env,[keep.id]),/Protected/);assert.throws(()=>createExpirer({...env,APP_STORE_CONNECT_APP_ID:'1'},[oldId]),/Wrong Apple/);
});
test('inventory rejects cross-app resources and foreign pagination',async()=>{
  const reply={data:[{id:keep.id,type:'builds',attributes:{version:'33',expired:false,uploadedDate:'2026-10-17T22:23:34Z'},relationships:{app:{data:{id:'wrong-app'}},preReleaseVersion:{data:{id:'v'}}}}],included:[{id:'v',type:'preReleaseVersions',attributes:{version:'1.0.0',platform:'IOS'}}]};
  await assert.rejects(inventory(async()=>reply),/Unexpected app/);
  await assert.rejects(inventory(async()=>({data:[],links:{next:'https://evil.invalid/v1/builds'}})),/Unsupported/);
});
