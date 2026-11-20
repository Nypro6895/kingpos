import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){
 const a={id:id(1),account_id:id(10),name:'Owned A',status:'active'},b={id:id(2),account_id:id(20),name:'Staff B',status:'active'},c={id:id(3),account_id:id(10),name:'Owned C',status:'active'},d={id:id(4),account_id:id(30),name:'Managed D',status:'active'};
 const membership=(salon,role)=>({salon_id:salon.id,status:'active',role:{code:role}});
 const state={calls:[],context:{user:{id:id(100),status:'active'},currentSalon:b,currentStaffSalon:b,currentMembership:null,workspaceType:'salon',salonMode:'staff',currentWorkspace:{id:'staff-b'},availableManageSalons:[a,c,d],availableStaffSalons:[b],availableAccounts:[{id:id(10),status:'active'},{id:id(20),status:'active'},{id:id(30),status:'active'}],workspaceOptions:[a,c,d].map(s=>({id:`manage-${s.id}`,salonId:s.id,salonMode:'manage',roleLabel:'Owner'})),salonMemberships:[membership(a,'STAFF'),membership(c,'OWNER'),membership(d,'MANAGER')],accountMemberships:[{account_id:id(10),status:'active',role:{code:'OWNER'}}],permissionCodes:[],permissions:[]}};
 globalThis.__marketTargetTest=state;
 const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`export * from './lib/market-target-context';export {marketPluginContext} from './lib/market-plugins';export {marketTargetHref} from './lib/market-target-url';export {setServiceRelayPlugin,startCardCheckout,marketTrialAction,downloadPayrollData,updateTaxSettings,changeOwnerCampaignAction} from './app/market/scoped-market-actions';`},bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'boundaries',setup(p){
 p.onResolve({filter:/server-only|current-context$|supabase\/server$|market-bank-billing$|^@\/app\//},a=>({path:a.path,namespace:'stub'}));
 p.onLoad({filter:/.*/,namespace:'stub'},a=>({resolveDir:process.cwd(),contents:a.path==='server-only'?'':a.path.endsWith('market-bank-billing')?`export const unavailableMarketBankBilling=(reason,message)=>({available:false,reason:message});`:a.path.endsWith('current-context')?`import {scopedBusinessContext} from './lib/scoped-business-context';export async function getCurrentBusinessContext(){return scopedBusinessContext()??globalThis.__marketTargetTest.context}export const isOwnerMembership=m=>m?.role?.code==='OWNER';export const getCurrentRolePermissionCodesForMembership=async()=>[];`:a.path.endsWith('supabase/server')?`export async function createAuthenticatedSupabaseServerClient(){return {authenticated:true}}`:`import {getCurrentBusinessContext} from './lib/current-context';${[...readFileSync('app/market/scoped-market-actions.ts','utf8').matchAll(/export async function (\w+)/g)].map(m=>m[1]).map(n=>`export async function ${n}(...args){const c=await getCurrentBusinessContext();globalThis.__marketTargetTest.calls.push({name:'${n}',salon:c.currentSalon.id,args});return {salonId:c.currentSalon.id}}`).join('\n')}`}));
 }}]});
 const m={exports:{}};new Function('module','exports','require',bundle.outputFiles[0].text)(m,m.exports,require);return {api:m.exports,state,a,b,c,d};
}
test('Staff B can manage owned A through direct/account ownership without changing workspace; staff-only B and manager D denied',async()=>{
 const {api,state,a,b,c,d}=await fixture();
 const target=await api.resolveMarketTarget(a.id);assert.equal(target.currentSalon.id,a.id);assert.equal(target.salonMode,'manage');
 assert.equal((await api.marketPluginContext(a.id)).salonId,a.id);
 await assert.rejects(api.resolveMarketTarget(b.id));await assert.rejects(api.resolveMarketTarget(d.id));await assert.rejects(api.resolveMarketTarget(id(999)));await assert.rejects(api.resolveMarketTarget(''));
 assert.equal((await api.resolveMarketTarget(c.id)).currentSalon.id,c.id);
 const owner=state.context.accountMemberships;state.context.accountMemberships=[];assert.equal((await api.resolveMarketTarget(c.id)).currentSalon.id,c.id);state.context.accountMemberships=owner;
 state.context.availableAccounts[0].status="disabled";await assert.rejects(api.resolveMarketTarget(a.id));state.context.availableAccounts[0].status="active";
 assert.equal(state.context.currentSalon.id,b.id);assert.equal(state.context.salonMode,'staff');
 a.status='disabled';await assert.rejects(api.resolveMarketTarget(a.id));a.status='active';state.context.user.status='blocked';await assert.rejects(api.resolveMarketTarget(a.id));
});
test('Explicit actions stay bound to each owned salon across tabs; missing/unauthorized target never reaches plugin or checkout',async()=>{
 const {api,state,a,b,c}=await fixture();
 await api.setServiceRelayPlugin(a.id,true);await api.startCardCheckout(c.id,'checkin-receipt',false);await api.marketTrialAction(a.id,'checkin-receipt',true,a.id);
 assert.deepEqual(state.calls.map(x=>x.salon),[a.id,c.id,a.id]);
 await api.downloadPayrollData(a.id,{salonId:a.id});await api.updateTaxSettings(c.id,new FormData());await api.changeOwnerCampaignAction(a.id,"campaign","pause");
 assert.deepEqual(state.calls.slice(3).map(x=>x.salon),[a.id,c.id,a.id]);
 const reads=await Promise.all([api.withMarketTarget(a.id,async()=>{await new Promise(r=>setTimeout(r,20));return (await api.marketPluginContext()).salonId}),api.withMarketTarget(c.id,async()=>{await new Promise(r=>setTimeout(r,5));return (await api.marketPluginContext()).salonId})]);assert.deepEqual(reads,[a.id,c.id]);
 assert.ok((await api.setServiceRelayPlugin(b.id,true)).error);assert.ok((await api.startCardCheckout(undefined,'booksms')).message);assert.equal(state.calls.length,6);assert.equal(state.context.currentSalon.id,b.id);
 state.context.accountMemberships=[];state.context.salonMemberships=[];assert.ok((await api.setServiceRelayPlugin(a.id,false)).error);assert.equal(state.calls.length,6);
});
test('Navigation preserves target, query and hash; rejects external destinations',async()=>{
 const {api,a}=await fixture();assert.equal(api.marketTargetHref('/market?q=Phone%20Checkin#details',a.id),`/market?q=Phone+Checkin&salon=${a.id}#details`);assert.equal(api.marketTargetHref('/market/booking-deposit?cancelled=1',a.id),`/market/booking-deposit?cancelled=1&salon=${a.id}`);assert.throws(()=>api.marketTargetHref('https://other.test',a.id));
});
