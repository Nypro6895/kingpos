import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function bundle(entry,{mocks={},disabled=false}={}){
 const result=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':process.cwd()},define:{'process.env.CRON_SECRET':'"synthetic-maintenance-guard"','process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH':disabled?'"1"':'"0"'},plugins:[{name:'isolated-maintenance',setup(b){b.onResolve({filter:/.*/},a=>a.path==='server-only'||Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]??'',loader:'ts',resolveDir:process.cwd()}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const {createAccountMaintenanceHandler:create}=await bundle('lib/account-maintenance-route.ts');
const zeroRights=()=>({claimed:0,captured:0,removed:0,purged:0,failed:0,deferred:0,blocked:0});
const request=auth=>new Request('https://fixture.test/api/account/erase-due',{headers:auth?{authorization:auth}:{}});
function dependencies(changes={}){const calls=[];return{calls,authorization:()=> 'Bearer synthetic-maintenance-guard',backgroundDisabled:()=>false,erase:async()=>{calls.push('erase');return{completed:1,failed:0};},exports:async()=>{calls.push('exports');return{removed:1,failed:0};},staging:async()=>{calls.push('staging');return{removed:1,failed:0};},postMedia:async()=>{calls.push('postMedia');return{claimed:1,removed:1,failed:0,deferred:0};},rights:async stage=>{calls.push(stage);return zeroRights();},...changes};}

test('cron authorization/disabled guard stops every old/new queue before any RPC or service construction',async()=>{
 for(const authorization of [()=>null,()=> 'Bearer synthetic-maintenance-guard'])for(const auth of [null,'Bearer wrong','Bearer synthetix-maintenance-guard']){const d=dependencies({authorization}),r=await create(d)(request(auth));assert.equal(r.status,401);assert.deepEqual(d.calls,[]);assert.equal(r.headers.get('Cache-Control'),'no-store');}
 const d=dependencies({backgroundDisabled:()=>true});assert.equal((await create(d)(request('Bearer synthetic-maintenance-guard'))).status,503);assert.deepEqual(d.calls,[]);
});

test('new stages run once in order beside, rather than ahead of, the unchanged cleanup→erasure pipeline',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});const d=dependencies();d.exports=async()=>{d.calls.push('exports-start');await pending;d.calls.push('exports-finish');return{removed:1,failed:0};};
 const result=create(d)(request('Bearer synthetic-maintenance-guard'));await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(d.calls.filter(x=>['capture','remove_origin','purge'].includes(x)),['capture','remove_origin','purge']);assert(!d.calls.includes('erase'));
 release();assert.equal((await result).status,200);assert(d.calls.indexOf('erase')>d.calls.indexOf('exports-finish'));assert.equal(d.calls.filter(x=>x==='erase').length,1);
});

test('isolated old/new failures preserve every other queue and never return false HTTP200 or raw errors',async()=>{
 for(const failing of ['exports','staging','postMedia','erase','capture','remove_origin','purge']){
  const d=dependencies();
  if(['capture','remove_origin','purge'].includes(failing))d.rights=async stage=>{d.calls.push(stage);if(stage===failing)throw Error('PRIVATE upstream bucket/path/key details');return zeroRights();};
  else d[failing]=async()=>{d.calls.push(failing);throw Error('PRIVATE upstream bucket/path/key details');};
  const response=await create(d)(request('Bearer synthetic-maintenance-guard'));assert.equal(response.status,503);for(const job of ['exports','staging','postMedia','erase','capture','remove_origin','purge'])assert.equal(d.calls.filter(x=>x===job).length,1,job+' still runs once after '+failing);
  assert(!(await response.text()).includes('PRIVATE'));
 }
 const d=dependencies({rights:async()=>({...zeroRights(),failed:1})});assert.equal((await create(d)(request('Bearer synthetic-maintenance-guard'))).status,503);
});

test('actual route retains maxDuration/auth guards and exact old/new bindings without reading real environment',async()=>{
 const mocks={
  '@/lib/account-erasure-worker':`export const runAccountErasures=()=>globalThis.__rightsMaintenance.erase();`,
  '@/lib/lifecycle-export-expiry':`export const runLifecycleExportExpiry=()=>globalThis.__rightsMaintenance.exports();`,
  '@/lib/public-image-staging-expiry':`export const runPublicImageStagingExpiry=()=>globalThis.__rightsMaintenance.staging();`,
  '@/lib/public-post-media-deletion':`export const runPublicPostMediaDeletions=()=>globalThis.__rightsMaintenance.postMedia();`,
  '@/lib/rights-evidence-worker':`export const runRightsImageEvidence=stage=>globalThis.__rightsMaintenance.rights(stage);`,
 };
 try{
  const d=dependencies();globalThis.__rightsMaintenance=d;const route=await bundle('app/api/account/erase-due/route.ts',{mocks});assert.equal(route.maxDuration,300);
  assert.equal((await route.GET(request(null))).status,401);assert.deepEqual(d.calls,[]);
  const response=await route.GET(request('Bearer synthetic-maintenance-guard'));assert.equal(response.status,200);const body=await response.json();assert.equal(body.completed,1);assert.deepEqual(Object.keys(body.rightsEvidence),['capture','removeOrigin','purge']);assert.deepEqual(d.calls.filter(x=>['capture','remove_origin','purge'].includes(x)),['capture','remove_origin','purge']);
  const disabled=await bundle('app/api/account/erase-due/route.ts',{mocks,disabled:true});const before=d.calls.length;assert.equal((await disabled.GET(request('Bearer synthetic-maintenance-guard'))).status,503);assert.equal(d.calls.length,before);
 }finally{delete globalThis.__rightsMaintenance;}
});
