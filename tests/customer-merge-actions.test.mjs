import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

test('merge action reports server outcomes and enforces salon authorization', async t => {
  const state={calls:[],paths:[],allowed:true,error:null,result:{merged:2,skipped:[{id:'conflict'}]}};
  globalThis.mergeActionFixture=state;
  const stubs={
    '@/lib/booking-domain/customer-identity':'export const normalizeBookingEmail=value=>value;export const normalizeBookingPhone=value=>value;',
    '@/lib/customers':'export const CUSTOMER_PERMISSIONS={manage:"customers.manage"};',
    '@/lib/current-context':'export const getCurrentBusinessContext=async()=>({user:{id:"owner"},currentAccount:{id:"account"},currentMembership:{},currentSalon:{id:"salon"}});export const isSalonManageContext=()=>true;export const getRouteForInvalidSalonContext=()=>"/businesses";',
    '@/lib/permissions':'export const requirePermission=async()=>{if(!globalThis.mergeActionFixture.allowed)throw Error("denied")};',
    '@/lib/supabase/server':'export const createAuthenticatedSupabaseServerClient=async()=>({rpc:async(name,args)=>{const s=globalThis.mergeActionFixture;s.calls.push({name,args});return {data:s.result,error:s.error}}});',
    'next/cache':'export const revalidatePath=path=>globalThis.mergeActionFixture.paths.push(path);',
    'next/navigation':'export const redirect=path=>{throw Error("redirect:"+path)};',
  };
  const bundled=await build({entryPoints:['app/customers/actions.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixture',setup(b){
    b.onResolve({filter:/^@\/|^next\//},args=>{assert.ok(args.path in stubs,args.path);return {path:args.path,namespace:'fixture'};});
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path]}));
  }}]});
  const {mergeDuplicateCustomers}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const form=(all=true)=>{
    const data=new FormData();data.set('target_customer_id','target');
    for(const id of ['source','other','conflict','source','target'])data.append('source_customer_id',id);
    if(all)data.set('merge_mode','all');return data;
  };
  try {
    await t.test('Merge all uses bulk RPC and actual merged/skipped counts',async()=>{
      await assert.rejects(mergeDuplicateCustomers(form()),/redirect:\/customers\/target\?merged=2&skipped=1/);
      assert.deepEqual(state.calls.at(-1),{name:'merge_customer_suggestions',args:{p_salon:'salon',p_target:'target',p_sources:['source','other','conflict']}});
      assert.ok(state.paths.includes('/customers/conflict'));
    });
    await t.test('selected merge keeps atomic strict RPC and does not report submitted counts',async()=>{
      state.result={merged:1};
      await assert.rejects(mergeDuplicateCustomers(form(false)),/merged=1&skipped=0/);
      assert.equal(state.calls.at(-1).name,'merge_customer_records');
      assert.equal(state.calls.at(-1).args.p_reason,'manual');
    });
    await t.test('zero compatible sources are reported as skipped rather than a successful merge',async()=>{
      state.result={merged:0,skipped:[{id:'source'},{id:'other'},{id:'conflict'}]};
      await assert.rejects(mergeDuplicateCustomers(form()),/merged=0&skipped=3/);
    });
    await t.test('RPC failure cannot redirect to success or revalidate as a completed merge',async()=>{
      state.error={message:'Customer selection changed'};const count=state.paths.length;
      await assert.rejects(mergeDuplicateCustomers(form()),/\?error=Customer%20selection%20changed/);
      assert.equal(state.paths.length,count);state.error=null;
    });
    await t.test('missing customer permission fails before calling any RPC',async()=>{
      state.allowed=false;const count=state.calls.length;
      await assert.rejects(mergeDuplicateCustomers(form()),/\?error=You%20do%20not%20have%20permission/);
      assert.equal(state.calls.length,count);
    });
  } finally { delete globalThis.mergeActionFixture; }
});
