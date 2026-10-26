import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness({signedIn=true}={}) {
 const rpc=[],broadcast=[],revalidated=[];
 const client={rpc:async(name,args)=>{rpc.push({name,args});return {error:null,data:{}};}};
 const dependencies={
  '@/lib/staff-portal-identity':{getStaffPortalIdentity:async()=>{throw Error('Unexpected Staff admission');}},
  '@/lib/current-context':{getCurrentBusinessContext:async()=>({user:signedIn?{id:'synthetic-owner'}:null,currentSalon:{id:'synthetic-current-salon'}})},
  '@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>client,createSupabaseServerClient:()=>{throw Error('Unexpected public client');}},
  '@/lib/market-plugins':{marketPluginContext:async()=>{throw Error('Unexpected plugin mutation');}},
  '@/lib/pos-staff-realtime-server':{broadcastPosStaffChange:async(...args)=>broadcast.push(args)},
  'next/cache':{revalidatePath:value=>revalidated.push(value)},
  '@/types/service-relay':{SERVICE_RELAY_PLUGIN:'synthetic-plugin'},
 };
 const exports={};
 const code=ts.transpileModule(fs.readFileSync('app/service-relay/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];},Error});
 return {exports,rpc,broadcast,revalidated};
}

test('composed desk save export forwards revision/lines using admitted salon, ignoring foreign client scope',async()=>{
 const h=harness();assert.equal(typeof h.exports.saveServiceRelayAtDesk,'function');
 const lines=[{id:'synthetic-line',staffId:'synthetic-staff',serviceId:'synthetic-service',amount:'25.00'}];
 assert.equal((await h.exports.saveServiceRelayAtDesk({visitId:'synthetic-visit',revision:7,lines,salonId:'foreign-salon'})).ok,true);
 assert.equal(h.rpc.length,1);assert.equal(h.rpc[0].name,'staff_scan_desk_save');assert.equal(h.rpc[0].args.p_salon,'synthetic-current-salon');assert.equal(h.rpc[0].args.p_expected,7);assert.equal(h.rpc[0].args.p_lines,lines);
 assert.equal(h.broadcast[0][0],'synthetic-current-salon');
});

test('composed Ready export preserves request id and admitted salon for server idempotency',async()=>{
 const h=harness();assert.equal(typeof h.exports.notifyPersonalReady,'function');
 const requestId='00000000-0000-4000-8000-000000000001';
 assert.equal((await h.exports.notifyPersonalReady({visitId:'synthetic-visit',staffId:null,chair:'1',requestId,salonId:'foreign-salon'})).ok,true);
 assert.equal(h.rpc[0].name,'personal_qr_notify_ready');assert.equal(h.rpc[0].args.p_request,requestId);assert.equal(h.rpc[0].args.p_salon,'synthetic-current-salon');
 assert.ok(h.revalidated.includes('/qr'));assert.ok(h.revalidated.includes('/notifications'));assert.equal(h.broadcast[0][1],'waiting');
});

test('both composed desk actions reject missing signed-in principal before RPC',async()=>{
 const h=harness({signedIn:false});
 assert.match((await h.exports.saveServiceRelayAtDesk({visitId:'synthetic-visit',revision:0,lines:[]})).error,/Open your salon POS/);
 assert.match((await h.exports.notifyPersonalReady({visitId:'synthetic-visit',staffId:null,chair:'',requestId:'synthetic-request'})).error,/Open your salon POS/);
 assert.equal(h.rpc.length,0);assert.equal(h.broadcast.length,0);
});
