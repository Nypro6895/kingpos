import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {build} from 'esbuild';
const key=Symbol.for('market-loader-matrix'),salon='00000000-0000-4000-8000-000000000001';let state;const evidence=[];
const defaults={counts:{},relay:false,payroll:false,campaign:null,vietnamese:{installed:false},paymentSettings:{vietnamese_published:false,enabled:false},receipt:{active:false,subscribed:false},policy:undefined,deposit:undefined,card:null,tax:undefined,taxCompany:{active:false,subscribed:false},booksms:undefined,owner:{salonId:salon,salonName:'Synthetic',observedAt:'2026-10-29T20:00:00Z',testPaymentsEnabled:false,catalog:[],installations:[]},bank:{data:null,error:null}};
const read=name=>`globalThis[Symbol.for('market-loader-matrix')].read('${name}')`;
const replacements={
 'server-only':'',
 '@/lib/current-context':'export function isOwnerMembership(){return true}export function isSalonManageContext(){return true}',
 '@/lib/market-platform/server':`export class PlatformError extends Error{};export const platformEnabled=()=>true;export const platformRpc=()=>${read('owner')}`,
 './server':`export class PlatformError extends Error{};export const platformEnabled=()=>true;export const platformRpc=()=>${read('owner')}`,
 '@/lib/market-plugins':`export const payrollDataPluginInstalled=()=>${read('payroll')};export async function marketPluginContext(){return {salonId:'${salon}',client:{rpc:()=>${read('bank')}}}}`,
 '@/lib/supabase/server':'export function createSupabaseServerClient(){return null}',
 '@/lib/market-installation-counts':`export const marketInstallationCounts=()=>${read('counts')}`,
 '@/app/service-relay/actions':`export const serviceRelayInstalled=()=>${read('relay')}`,
 '@/app/campaigns/credit-actions':`export const campaignWalletAction=()=>${read('campaign')}`,
 '@/lib/vietnamese-plugin':`export const vietnamesePluginState=()=>${read('vietnamese')}`,
 '@/types/vietnamese-plugin':'export const EMPTY_VIETNAMESE_PLUGIN={installed:false}',
 '@/lib/market-payments':`export const marketPaymentSettings=()=>${read('paymentSettings')};export const marketPaymentReady=()=>false`,
 '@/lib/checkin-receipt-subscription':`export const checkinReceiptSubscription=()=>${read('receipt')}`,
 '@/lib/booking-policy-subscription':`export const bookingPolicySubscription=()=>${read('policy')}`,
 '@/lib/booking-deposit':`export const bookingDepositState=()=>${read('deposit')}`,
 '@/lib/platform-payment':`export const paymentConfig=()=>${read('card')}`,
 '@/lib/market-tax':`export const marketTaxCheckoutSettings=()=>${read('tax')}`,
 '@/lib/tax-company-subscription':`export const taxCompanySubscription=()=>${read('taxCompany')}`,
 '@/lib/booksms':`export const bookSmsState=()=>${read('booksms')}`,
 '@/lib/experience-context':'export const getExperienceContext=()=>({scope:"synthetic-loader-only"})',
};
const compiled=await build({entryPoints:['lib/market-experience-data.ts','lib/bounded-get.ts'],outdir:'virtual',bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'named-read-adapters',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(replacements,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:replacements[a.path],resolveDir:process.cwd()}));}}]});
const modules=await Promise.all(compiled.outputFiles.map(f=>import('data:text/javascript;base64,'+Buffer.from(f.text).toString('base64'))));const {loadMarketExperienceData}=modules.find(m=>m.loadMarketExperienceData),{runReadWithDeadline}=modules.find(m=>m.runReadWithDeadline);
const context={user:{id:salon},currentSalon:{id:salon,status:'active'},currentMembership:{}};
test.beforeEach(()=>{state={faults:{},trace:[],read:async name=>{const start=performance.now(),fault=state.faults[name];const trace={stage:name,status:'started'};state.trace.push(trace);if(fault==='hang'){trace.status='hanging';return new Promise(()=>{});}try{if(fault==='reject')throw new Error('Synthetic '+name+' read failure');if(fault==='bug')throw new TypeError('Synthetic '+name+' programming failure');const value=Object.hasOwn(state.faults,name)?fault:structuredClone(defaults[name]);trace.status='resolved';return value;}catch(error){trace.status='rejected';trace.errorClass=error.name;throw error;}finally{trace.elapsedMs=Math.round((performance.now()-start)*100)/100;}}};globalThis[key]=state;});
test.afterEach(t=>evidence.push({test:t.name,trace:state.trace}));
test.after(()=>{delete globalThis[key];if(process.env.MARKET_MATRIX_EVIDENCE==='1')fs.writeFileSync('artifacts/market-milestone-20261029/loader-matrix.json',JSON.stringify({layer:'actual orchestration and bank/Owner normalization; named read adapters; no auth/provider',cases:evidence},null,2));});
test('actual composite executes independent named readers and preserves safe unavailable native bank state',async()=>{const result=await loadMarketExperienceData(context);assert.equal(result.developerMarket.status,'ready');assert.equal(result.bankBillingState.available,false);assert.equal(typeof result.bankBillingState.settings.version,'number');assert.equal(result.paymentsAvailable,false);for(const name of Object.keys(defaults))assert.ok(state.trace.some(t=>t.stage===name),name);});
for(const group of ['relay','payroll','campaign','vietnamese','receipt','policy','deposit','card','tax','taxCompany','booksms'])test('independent '+group+' read failure does not manufacture a ready native subscription',async()=>{state.faults[group]='reject';const result=await loadMarketExperienceData(context);assert.equal(result.developerMarket.status,'ready');assert.equal(result.paymentsAvailable,false);if(group==='payroll')assert.equal(result.payrollDownloadInstalled,false);if(group==='vietnamese')assert.match(result.pluginLoadError,/Synthetic/);});
test('actual bank adapter normalizes bad successful RPC shapes before composite .settings.version access',async()=>{for(const data of [null,{}, {settings:null,catalog:[],orders:[]},{settings:{currency:'USD'},catalog:[],orders:[]}]){state.faults.bank={data,error:null};const result=await loadMarketExperienceData(context);assert.equal(result.bankBillingState.available,false);assert.equal(typeof result.bankBillingState.settings.version,'number');}});
test('bank transport rejection and missing SQL function retain normalized unavailability, not TypeError',async()=>{state.faults.bank='reject';assert.equal((await loadMarketExperienceData(context)).bankBillingState.available,false);state.faults.bank={data:null,error:{code:'PGRST202',message:'synthetic missing function'}};assert.equal((await loadMarketExperienceData(context)).bankBillingState.unavailable_reason,'setup_required');});
test('bad HTTP-success Owner payload becomes unavailable, never ready-null catalog',async()=>{state.faults.owner=null;const warn=console.warn;console.warn=()=>{};try{assert.equal((await loadMarketExperienceData(context)).developerMarket.status,'unavailable');}finally{console.warn=warn;}});
test('unexpected required-reader programming errors retain their exception boundary',async()=>{state.faults.counts='bug';await assert.rejects(loadMarketExperienceData(context),error=>error instanceof TypeError&&/Synthetic counts/.test(error.message));});
for(const stage of ['bank','owner'])test('a hanging '+stage+' read is bounded by the real deadline primitive',async()=>{state.faults[stage]='hang';await assert.rejects(runReadWithDeadline(loadMarketExperienceData(context),30),error=>error.name==='ReadConnectionError'&&error.kind==='timeout');});
