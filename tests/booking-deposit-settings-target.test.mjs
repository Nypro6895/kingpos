import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {AsyncLocalStorage} from 'node:async_hooks';
const ts = createRequire(import.meta.url)('typescript');
function compile(file, dependencies, extra = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports, require(name) { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; }, Error, URL, URLSearchParams, Date, ...extra});
  return exports;
}
function fixture({role = 'owner', signedIn = true, status = 'active', testMode = true} = {}) {
  const writes = [], reads = [], billing = [], cookieWrites = [];
  const salons = [{id:'a',account_id:'account-a',name:'A',status:'active'},{id:'b',account_id:'account-b',name:'B',status}];
  const memberships = salons.map(s=>({salon_id:s.id,account_id:s.account_id,status:'active',role}));
  const original = {user:signedIn?{id:'owner'}:null, salonMode:'personal', currentSalon:null, currentMembership:null,
    workspaceOptions:salons.map(s=>({id:'manage:'+s.id,salonId:s.id,salonMode:'manage',roleLabel:role})),
    availableManageSalons:salons,availableStaffSalons:[],availableAccounts:salons.map(s=>({id:s.account_id,name:s.name})),
    salonMemberships:memberships,accountMemberships:[]};
  const scoped = compile('lib/scoped-business-context.ts', {'server-only':{},'node:async_hooks':{AsyncLocalStorage}});
  const current = {getCurrentBusinessContext:async()=>scoped.scopedBusinessContext()??original,
    isOwnerMembership:m=>m?.role==='owner', isSalonManageContext:c=>c.salonMode==='manage',
    getCurrentRolePermissionCodesForMembership:async()=>[]};
  const target = compile('lib/settings-target-context.ts', {'server-only':{},'./current-context':current,'./scoped-business-context':scoped});
  const client = {rpc:async(name,args)=>{writes.push({name,args});return {error:null};}};
  const market = compile('lib/market-plugins.ts', {'server-only':{},'@/lib/current-context':current,'@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>client}});
  const api = compile('app/market/booking-deposit-actions.ts', {
    'node:crypto':{randomUUID:()=> 'synthetic-nonce'},'next/headers':{cookies:async()=>({set:(...args)=>cookieWrites.push(args)})},
    'next/cache':{revalidatePath:()=>{}},'@/lib/market-plugins':market,'@/lib/current-context':current,
    '@/lib/settings-target-context':target,
    '@/lib/booking-deposit':{bookingDepositState:async id=>{await new Promise(r=>setTimeout(r,id==='a'?8:1));const scope=await market.marketPluginContext();assert.equal(scope.salonId,id);reads.push(id);return {salonId:id,testMode,connected:false};}},
    '@/lib/booking-deposit-subscription':{bookingDepositPayment:async(...args)=>{billing.push(args);return 'https://example.test/billing';}},
    '@/lib/reylumi-config':{REYLUMI_METADATA_BASE:'https://example.test'},
  },{process:{env:{BOOKING_STRIPE_CONNECT_CLIENT_ID:'synthetic-client',BOOKING_STRIPE_SECRET_KEY:'synthetic-test-only',NODE_ENV:'test'}}});
  return {api,reads,writes,billing,cookieWrites,original,current,salons,memberships};
}
const settings = {enabled:false,mode:'fixed',value:20,checkout:'both'};

test('personal account loads selected salon without changing the current workspace',async()=>{
  const f=fixture();const result=await f.api.loadBookingDepositAction('b');
  assert.equal(result.state.salonId,'b');assert.equal(result.state.testMode,true);
  assert.equal((await f.current.getCurrentBusinessContext()).salonMode,'personal');assert.equal(f.writes.length,0);
});
test('parallel salon reads keep each request scoped to its own target',async()=>{
  const f=fixture();const [a,b]=await Promise.all([f.api.loadBookingDepositAction('a'),f.api.loadBookingDepositAction('b')]);
  assert.equal(a.state.salonId,'a');assert.equal(b.state.salonId,'b');
  assert.equal((await f.current.getCurrentBusinessContext()).currentSalon,null);
});
test('save and installation target the selected salon, retaining existing owner checks',async()=>{
  const f=fixture();assert.ok((await f.api.saveBookingDepositAction(settings,'b')).state);
  assert.ok((await f.api.installBookingDepositAction(true,'b')).state);
  assert.deepEqual(f.writes.map(x=>[x.name,x.args.p_salon]),[['booking_deposit_save','b'],['booking_deposit_install','b']]);
});
test('billing and Stripe handoff are bound to selected salon without contacting a provider',async()=>{
  const f=fixture();assert.ok((await f.api.bookingDepositBillingAction(true,'b')).url);
  assert.deepEqual(f.billing[0],['b','owner',true]);
  const result=await f.api.connectBookingStripeAction('b');assert.equal(new URL(result.url).hostname,'connect.stripe.com');
  assert.equal(JSON.parse(f.cookieWrites[0][1]).salonId,'b');
  assert.equal((await f.current.getCurrentBusinessContext()).currentSalon,null);
});
for (const [label,options,target] of [['signed out',{signedIn:false},'b'],['non-owner manager',{role:'manager'},'b'],['inactive salon',{status:'closed'},'b'],['unrelated salon',{},'outside']]) {
  test(`${label} is denied before reads, mutations or payment handoff`,async()=>{
    const f=fixture(options);
    const results=await Promise.all([f.api.loadBookingDepositAction(target),f.api.saveBookingDepositAction(settings,target),f.api.installBookingDepositAction(true,target),f.api.bookingDepositBillingAction(false,target),f.api.connectBookingStripeAction(target)]);
    assert.ok(results.every(r=>typeof r.error==='string'));
    assert.deepEqual([f.reads.length,f.writes.length,f.billing.length,f.cookieWrites.length],[0,0,0,0]);
  });
}
test('existing Market callers without an explicit target still use their selected Owner workspace',async()=>{
  const f=fixture();Object.assign(f.original,{salonMode:'manage',currentSalon:f.salons[0],currentMembership:f.memberships[0]});
  assert.equal((await f.api.loadBookingDepositAction()).state.salonId,'a');
  assert.ok((await f.api.bookingDepositBillingAction(false)).url);assert.equal(f.billing[0][0],'a');
});
test('live payment readiness and amount validation are unchanged',async()=>{
  const f=fixture({testMode:false});
  assert.match((await f.api.saveBookingDepositAction({...settings,enabled:true},'b')).error,/Connect a Stripe account/);
  assert.match((await f.api.saveBookingDepositAction({...settings,value:0},'b')).error,/valid deposit/);
  assert.equal(f.writes.length,0);
});
