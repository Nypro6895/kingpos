import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID,createHash} from 'node:crypto';
const key=Symbol.for('market-platform-actions-test'),state={calls:[],override:false,response:null};globalThis[key]=state;
const compiled=await build({entryPoints:['app/(market-platform)/developer-platform/actions.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'action-boundaries',setup(b){
 b.onResolve({filter:/^(next\/cache|@\/lib\/market-platform\/(server|commerce|owner))$/},args=>({path:args.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='next/cache'?'export function revalidatePath(){}':args.path.endsWith('/owner')?'export const platformPublicOrigin=()=>"https://reylumi.com";':args.path.endsWith('/server')?`export class PlatformError extends Error{constructor(message,outcome='rejected'){super(message);this.outcome=outcome}};export async function platformRpc(name,args){const s=globalThis[Symbol.for('market-platform-actions-test')];s.calls.push({name,args});if(s.throwOperation===name)throw s.definiteRejection?new PlatformError('Synthetic SQL rejection'):s.unknownPlatformError?new PlatformError('Synthetic transport loss','unknown'):new Error('Synthetic interrupted response');if(s.override)return s.response;if(s.reply)return s.reply(name,args);return name==='register'?'00000000-0000-4000-8000-000000000001':true;}`:'export async function startSellerOnboarding(){};export async function startTestCheckout(){};export async function refreshSellerStatus(){};export async function requestFullTestRefund(){const s=globalThis[Symbol.for("market-platform-actions-test")];if(s.refundError)throw s.refundError;return s.refundStatus;};'}));
}}]});
const {platformAction}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
test.after(()=>delete globalThis[key]);test.beforeEach(()=>{state.calls=[];state.override=false;state.response=null;state.reply=undefined;state.throwOperation=undefined;state.definiteRejection=false;state.unknownPlatformError=false;state.refundStatus="pending";state.refundError=undefined;});

test('HTTP-success null/false/object mutation acknowledgements cannot announce a confirmed save or auto retry',async()=>{
 for(const operation of ['profile','register','moderate'])for(const response of [null,false,{},[],1]){
  state.calls=[];state.override=true;state.response=response;const form=new FormData();form.set('operation',operation);form.set('name','Synthetic publisher');
  if(operation==='profile'){form.set('email','support@example.com');form.set('website','https://example.com');form.set('description','Synthetic profile');}
  if(operation==='moderate'){form.delete('name');form.set('app',randomUUID());form.set('active','false');form.set('reason','Synthetic withdrawal');}
  const result=await platformAction({},form);assert.equal(result.ok,false,operation+' must not confirm '+JSON.stringify(response));assert.match(result.message,/may have completed/);assert.equal(state.calls.length,1,'Never repeat the mutation automatically');
 }
});
test('existing typed boolean and UUID mutation confirmations still complete normally',async()=>{
 for(const operation of ['profile','register','moderate']){const form=new FormData();form.set('operation',operation);if(operation==='moderate'){form.set('app',randomUUID());form.set('active','false');form.set('reason','Synthetic withdrawal');}else{form.set('name','Synthetic org');if(operation==='profile'){form.set('email','support@example.com');form.set('website','https://example.com');form.set('description','Synthetic profile');}}assert.equal((await platformAction({},form)).ok,true);}
 state.override=true;state.response=true;const form=new FormData();form.set('operation','register');form.set('name','Synthetic org');assert.equal((await platformAction({},form)).ok,false,'Boolean success cannot replace the organization ID');
});
test('missing submit and review acknowledgements must not announce Saved',async()=>{
 state.override=true;state.response=null;
 const review=new FormData();for(const [k,v]of Object.entries({operation:'review',publisher:'Synthetic publisher',version:randomUUID(),sha256:'a'.repeat(64),decision:'approved',reason:'Synthetic inspection'}))review.set(k,v);
 const result=await platformAction({},review);assert.equal(result.ok,false);assert.match(result.message,/may have completed/);assert.equal(state.calls.length,1);
 state.calls=[];const submission=new FormData();for(const [k,v]of Object.entries({operation:'submit',app:'',requestId:randomUUID()}))submission.set(k,v);submission.set('manifest',new File([JSON.stringify({schemaVersion:1,type:'hosted-app',version:'1.0.0',name:'Synthetic submit',description:'Synthetic missing acknowledgement test.',launchUrl:'https://developer.reylumi.com/connect',privacyUrl:'https://developer.reylumi.com/privacy',supportUrl:'https://developer.reylumi.com/support',scopes:['salon:profile:read'],price:{currency:'usd',amountCents:0,billing:'one-time-version'}})],'manifest.json'));
 const unconfirmed=await platformAction({},submission);assert.equal(unconfirmed.ok,false);assert.equal(unconfirmed.uncertain,true);assert.match(unconfirmed.message,/may have completed/);assert.equal(state.calls.length,1);
});
test('review acknowledgement binds the exact requested version/decision/reason; malformed payloads do not save',async()=>{
 const version=randomUUID(),form=new FormData();for(const [k,v]of Object.entries({operation:'review',publisher:'Synthetic publisher',version,sha256:'a'.repeat(64),decision:'approved',reason:' Synthetic inspection '}))form.set(k,v);
 const valid={publisher_name:'Synthetic publisher',version_id:version,decision:'approved',reason:'Synthetic inspection',actor_id:randomUUID(),created_at:'2026-10-29T22:00:00Z'};
 state.override=true;for(const reply of [null,{},true,{...valid,version_id:randomUUID()},{...valid,decision:'rejected'},{...valid,reason:'Different inspection'},{...valid,publisher_name:'Changed publisher'}]){state.response=reply;assert.equal((await platformAction({},form)).ok,false);}state.response=valid;assert.equal((await platformAction({},form)).ok,true);
});
test('interrupted submit/review responses are uncertain; known SQL rejections are retained without retry',async()=>{
 const form=new FormData();for(const [k,v]of Object.entries({operation:'review',publisher:'Synthetic publisher',version:randomUUID(),sha256:'a'.repeat(64),decision:'rejected',reason:'Synthetic inspection'}))form.set(k,v);
 state.throwOperation='review_exact';for(const unknownPlatformError of [false,true]){state.calls=[];state.unknownPlatformError=unknownPlatformError;const result=await platformAction({},form);assert.equal(result.ok,false);assert.match(result.message,/may have completed/);assert.equal(state.calls.length,1);}state.definiteRejection=true;assert.equal((await platformAction({},form)).message,'Synthetic SQL rejection');
});
test('unconfirmed rotation and sandbox responses never reveal a replacement credential',async()=>{
 state.override=true;state.response=null;for(const operation of ['client','sandbox']){const form=new FormData();form.set('operation',operation);if(operation==='client'){form.set('app',randomUUID());form.set('confirm','yes');}else form.set('version',randomUUID());const result=await platformAction({},form);assert.equal(result.ok,false);assert.equal(result.token,undefined);assert.match(result.message,/may have completed/);}
});
test('real JSON upload action retains immutable request identity and never accepts caller ownership',async()=>{
 const manifest={schemaVersion:1,type:'hosted-app',version:'1.0.0',name:'Synthetic app',description:'A synthetic manifest for validation.',launchUrl:'https://developer.reylumi.com/connect',privacyUrl:'https://developer.reylumi.com/privacy',supportUrl:'https://developer.reylumi.com/support',scopes:['salon:profile:read'],price:{currency:'usd',amountCents:0,billing:'one-time-version'}};
 const data=new FormData();data.set('operation','submit');data.set('app','');data.set('requestId',randomUUID());data.set('manifest',new File([JSON.stringify(manifest)],'connection.json',{type:'application/json'}));
 state.reply=(name,args)=>{const canonical=JSON.stringify(args.p_manifest);return {id:randomUUID(),app_id:randomUUID(),version:args.p_manifest.version,manifest:args.p_manifest,canonical,sha256:createHash('sha256').update(canonical).digest('hex')};};const result=await platformAction({},data);assert.equal(result.ok,true);assert.equal(state.calls[0].name,'submit');assert.equal(state.calls[0].args.p_request,data.get('requestId'));assert.deepEqual(state.calls[0].args.p_manifest,manifest);
 state.calls=[];data.set('ownerId',randomUUID());assert.equal((await platformAction({},data)).ok,false);assert.equal(state.calls.length,0);
});
test('duplicate operations, malformed upload, oversized files and missing consent never reach the database',async()=>{
 const duplicate=new FormData();duplicate.append('operation','register');duplicate.append('operation','register');duplicate.set('name','Test org');assert.equal((await platformAction({},duplicate)).ok,false);
 for(const file of [new File(['invalid'],'connection.json'),new File(['{}'],'code.exe'),new File(['x'.repeat(16385)],'connection.json'),new File(['{"schemaVersion":1}'],'connection.json')]){
  const data=new FormData();data.set('operation','submit');data.set('app','');data.set('requestId',randomUUID());data.set('manifest',file);assert.equal((await platformAction({},data)).ok,false);
 }
 const install=new FormData();install.set('operation','install');assert.equal((await platformAction({},install)).ok,false);assert.equal(state.calls.length,0);
});
test('client credential rotation requires confirmation and stores only its digest',async()=>{
 const form=new FormData();form.set('operation','client');form.set('app',randomUUID());assert.equal((await platformAction({},form)).ok,false);assert.equal(state.calls.length,0);form.set('confirm','yes');const result=await platformAction({},form);assert.equal(result.ok,true);assert.match(result.token,/^rmc_[A-Za-z0-9_-]{43}$/);assert.equal(state.calls[0].name,'rotate_client');assert.match(state.calls[0].args.p_secret_hash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(state.calls).includes(result.token));
 const legacy=new FormData();legacy.set('operation','token');legacy.set('installation',randomUUID());assert.equal((await platformAction({},legacy)).ok,false);
});

test('developer marketplace and runtime endpoints are excluded from offline HTML policy',async()=>{
 const policy=await build({entryPoints:['lib/experience-offline-policy.ts'],bundle:true,write:false,platform:'node',format:'esm'});const {getExperienceOfflinePath}=await import(`data:text/javascript;base64,${Buffer.from(policy.outputFiles[0].text).toString('base64')}`);
 for(const path of ['/developer-platform','/developer-platform?salon=synthetic','/market/data','/api/market-platform/v1/published/profile','/api/market-platform/v1/published/media/00000000-0000-4000-8000-000000000001','/api/market-platform/v1/salon','/api/market-platform/v1/token'])assert.equal(getExperienceOfflinePath(path),null);
});


test('refund action distinguishes recorded pending/failed status from completion and blocks an unknown response',async()=>{
 const form=new FormData();form.set('operation','refund');form.set('order',randomUUID());form.set('confirm','yes');
 for(const status of ['pending','requires_action','succeeded']){state.refundStatus=status;const result=await platformAction({},form);assert.equal(result.ok,true);assert.match(result.message,/Reconcile the authoritative charge/);assert.doesNotMatch(result.message,/^Saved/);}
 for(const status of ['failed','canceled']){state.refundStatus=status;const result=await platformAction({},form);assert.equal(result.ok,true);assert.match(result.message,/failed or was canceled/);}
 for(const status of [undefined,null,'unknown']){state.refundStatus=status;const result=await platformAction({},form);assert.equal(result.ok,false);assert.equal(result.uncertain,true);}
 state.refundError=new Error('Synthetic lost response');const lost=await platformAction({},form);assert.equal(lost.ok,false);assert.equal(lost.uncertain,true);
});

test('synthetic launch acknowledgement must match the requested version and cannot expose a credential',async()=>{const version=randomUUID(),data=new FormData();data.set('operation','sandbox-connect');data.set('version',version);state.override=true;const reply={synthetic:true,installationId:randomUUID(),clientId:randomUUID(),versionId:randomUUID(),launchUrl:'https://plugin.example.com/connect'};state.response=reply;assert.equal((await platformAction({},data)).ok,false);state.response={...reply,versionId:version};const result=await platformAction({},data);assert.equal(result.ok,true);const url=new URL(result.launchUrl);assert.equal(url.searchParams.get('reylumi_sandbox'),'true');assert.equal(url.searchParams.get('reylumi_installation'),reply.installationId);assert.equal(url.searchParams.get('reylumi_authorize_url'),'https://reylumi.com/api/market-platform/authorize');assert.equal(url.searchParams.has('token'),false);assert.equal(result.token,undefined);});
