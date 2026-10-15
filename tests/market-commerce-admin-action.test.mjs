import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['app/(app)/admin/market/commerce-actions.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':process.cwd()},plugins:[{name:'admin-fixture',setup(b){
 b.onResolve({filter:/^(server-only|next\/navigation|next\/cache|@\/lib\/platform-admin\/auth|@\/lib\/market-payments)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='server-only'?'':a.path.includes('navigation')?`export function notFound(){throw Error('Not found')}`:a.path.includes('cache')?`export function revalidatePath(){}`:a.path.includes('/auth')?`export async function requirePlatformAdmin(){return{userId:'admin',roleSlug:globalThis.adminRole??'platform_owner'}}`:`export function marketServiceClient(){return{from(table){let updating=false;const chain={select(){return this},eq(key,value){if(updating&&key==='version')globalThis.savedVersionFilter=value;return this},update(value){updating=true;globalThis.adminUpdate=value;return this},single:async()=>updating?(globalThis.simulateRace?{data:null,error:{message:'race'}}:{data:{version:2}}):{data:{version:1}},insert:async value=>{globalThis.adminAudit=value;return{}}};return chain}}}`}));
}}]});
const {saveCommerceConfiguration}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function form(){const data=new FormData();for(const [key,value] of Object.entries({'tax-company':'7.90',version:'1',tax:'8',fee:'2',fixed:'0.30','vietnamese-language':'3.99','booking-policy':'0.99','booking-deposit':'5.90','checkin-receipt':'4.70',bank_name:'Test bank',bank_beneficiary:'Test business',bank_account:'001234',bank_routing:'001',bank_instructions:'Use the order reference.'}))data.set(key,value);return data;}
test('only a platform owner can save a draft',async()=>{globalThis.adminRole='platform_admin';await assert.rejects(saveCommerceConfiguration(form()),/Not found/);delete globalThis.adminRole;});
test('invalid or stale admin input never writes settings',async()=>{
 delete globalThis.adminUpdate;const invalid=form();invalid.set('tax','101');assert.equal((await saveCommerceConfiguration(invalid)).ok,false);assert.equal(globalThis.adminUpdate,undefined);
 const stale=form();stale.set('version','0');assert.match((await saveCommerceConfiguration(stale)).message,/Settings changed/);assert.equal(globalThis.adminUpdate,undefined);
});
test('valid draft uses a version condition and leaves bank details out of the audit',async()=>{
 const result=await saveCommerceConfiguration(form());assert.equal(result.ok,true);assert.equal(globalThis.savedVersionFilter,1);assert.equal(globalThis.adminUpdate.tax_bps,800);assert.equal(globalThis.adminUpdate.plugin_prices['booking-deposit'],590);assert.equal(globalThis.adminAudit.after_data.bank_account,undefined);assert.equal(globalThis.adminAudit.after_data.version,2);
 globalThis.simulateRace=true;assert.equal((await saveCommerceConfiguration(form())).ok,false);delete globalThis.simulateRace;
});
