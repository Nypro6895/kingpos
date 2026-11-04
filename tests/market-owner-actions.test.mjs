import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const key=Symbol.for('owner-actions-test'),state={calls:[],salon:'00000000-0000-4000-8000-000000000001'};globalThis[key]=state;
const compiled=await build({entryPoints:['app/market/developer-app-actions.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'boundaries',setup(b){
 b.onResolve({filter:/^(next\/(cache|navigation)|@\/lib\/market-platform\/(server|commerce|owner))$/},args=>({path:args.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='next/cache'?'export function revalidatePath(){}':args.path==='next/navigation'?'export function redirect(url){throw new Error("REDIRECT:"+url)}':args.path.endsWith('/server')?`export class PlatformError extends Error{constructor(message,outcome='rejected'){super(message);this.outcome=outcome}};export async function platformRpc(name,args){const s=globalThis[Symbol.for('owner-actions-test')];s.calls.push({name,args});if(s.throwOperation===name)throw s.definiteRejection?new PlatformError('Synthetic SQL rejection'):s.unknownPlatformError?new PlatformError('Synthetic transport loss','unknown'):new Error('Synthetic interrupted response');if(Object.hasOwn(s.responses,name))return s.responses[name];if(name==='owner_workspace'&&s.workspaceThrows)throw Error('Synthetic read failure');if(name==='owner_workspace'&&s.workspaceOverride!==undefined)return s.workspaceOverride;if(name==='install')return {id:s.salon,salon_id:s.salon,app_id:'00000000-0000-4000-8000-000000000002',version_id:args.p_version,consented_by:s.salon,scopes:args.p_scopes,state:'active',generation:1};if(name==='connection_owner_check'||name==='revoke')return true;if(name==='owner_workspace'){const installed=s.calls.findLast(c=>c.name==='install');return {salonId:s.salon,salonName:'Synthetic owner',observedAt:'2026-10-29T20:00:00Z',testPaymentsEnabled:false,catalog:[],installations:[{id:s.salon,appId:'00000000-0000-4000-8000-000000000002',versionId:installed?.args.p_version??s.salon,scopes:installed?.args.p_scopes??[],state:s.calls.some(c=>c.name==='revoke')?'revoked':'active',usable:true,connectionReady:false}]};}return {launchUrl:'https://developer.reylumi.com/app',clientId:'00000000-0000-4000-8000-000000000002',installationId:s.salon,versionId:s.salon};}`:args.path.endsWith('/owner')?`import {PlatformError} from '@/lib/market-platform/server';export async function currentOwnerSalon(expected){const s=globalThis[Symbol.for('owner-actions-test')];if(expected!==s.salon)throw new PlatformError('Your current salon changed');return s.salon;}export function platformPublicOrigin(){return 'https://reylumi.com';}`:'export async function startTestCheckout(){return "https://checkout.stripe.com/test";}'}));
}}]});
const {ownerAppAction}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
test.after(()=>delete globalThis[key]);test.beforeEach(()=>{state.calls=[];state.workspaceOverride=undefined;state.workspaceThrows=false;state.responses={};state.throwOperation=undefined;state.definiteRejection=false;state.unknownPlatformError=false;});
function form(op,fields={}){const f=new FormData();for(const [k,v]of Object.entries({operation:op,salon:state.salon,...fields}))f.set(k,v);return f;}
test('stale salon, duplicate field and missing consent cannot mutate current Owner installation',async()=>{
 const fields={version:state.salon,sha256:'a'.repeat(64),scopes:'[]'};
 assert.equal((await ownerAppAction({},form('install',fields))).ok,false);
 const stale=form('install',{...fields,consent:'yes',salon:'other'});assert.equal((await ownerAppAction({},stale)).ok,false);
 const duplicate=form('install',{...fields,consent:'yes'});duplicate.append('salon',state.salon);assert.equal((await ownerAppAction({},duplicate)).ok,false);assert.equal(state.calls.length,0);
 assert.equal((await ownerAppAction({},form('install',{...fields,consent:'yes'}))).ok,true);assert.equal(state.calls[0].args.p_salon,state.salon);
});
test('removal verifies active salon ownership and automatic launch carries no token or secret',async()=>{
 await ownerAppAction({},form('revoke',{installation:state.salon}));assert.deepEqual(state.calls.map(c=>c.name),['connection_owner_check','revoke','owner_workspace']);state.calls=[];
 await assert.rejects(ownerAppAction({},form('connect',{installation:state.salon})),error=>{assert.match(error.message,/^REDIRECT:https:\/\/developer.reylumi.com\/app\?/);assert.match(error.message,/reylumi_installation/);assert.ok(!/rmp_|rmr_|rmc_/.test(error.message));return true;});assert.equal(state.calls[0].name,'connection_start');
});
test('an invalid or foreign post-mutation observation never claims confirmed activation',async()=>{
 for(const workspace of [null, {}, {salonId:'00000000-0000-4000-8000-000000000002',salonName:'Foreign synthetic',observedAt:'2026-10-29T20:00:00Z',testPaymentsEnabled:false,catalog:[],installations:[]}]){
  state.workspaceOverride=workspace;const result=await ownerAppAction({},form('install',{version:state.salon,sha256:'a'.repeat(64),scopes:'[]',consent:'yes'}));assert.equal(result.ok,false);assert.equal(result.market,undefined);assert.match(result.message,/may have completed/);
 }
});
test('a post-mutation read failure reports uncertainty rather than confirming or repeating the change',async()=>{state.workspaceThrows=true;const result=await ownerAppAction({},form('install',{version:state.salon,sha256:'a'.repeat(64),scopes:'[]',consent:'yes'}));assert.equal(result.ok,false);assert.match(result.message,/may have completed/);assert.equal(state.calls.filter(c=>c.name==='install').length,1);});
test('same-salon ready data without the requested installation cannot confirm activation',async()=>{state.workspaceOverride={salonId:state.salon,salonName:'Synthetic owner',observedAt:'2026-10-29T20:00:00Z',testPaymentsEnabled:false,catalog:[],installations:[]};
 const result=await ownerAppAction({},form('install',{version:state.salon,sha256:'a'.repeat(64),scopes:'[]',consent:'yes'}));assert.equal(result.ok,false);assert.match(result.message,/may have completed/);
});
test('malformed installation acknowledgements and revoked-state mismatches never claim success',async()=>{
 for(const value of [null,false,{},[],{id:state.salon}]){state.responses={install:value};state.calls=[];const result=await ownerAppAction({},form('install',{version:state.salon,sha256:'a'.repeat(64),scopes:'[]',consent:'yes'}));assert.equal(result.ok,false);assert.match(result.message,/may have completed/);assert.equal(state.calls.filter(c=>c.name==='install').length,1);}
 state.responses={};state.workspaceOverride={salonId:state.salon,salonName:'Synthetic owner',observedAt:'2026-10-29T20:00:00Z',testPaymentsEnabled:false,catalog:[],installations:[{id:state.salon,appId:state.salon,versionId:state.salon,state:'active',scopes:[],usable:true,connectionReady:false}]};assert.equal((await ownerAppAction({},form('revoke',{installation:state.salon}))).ok,false);
});
test('Owner check must return true before revoke; invalid acknowledgement prevents confirmation',async()=>{
 for(const value of [null,false,{},'true']){state.responses={connection_owner_check:value};state.calls=[];const result=await ownerAppAction({},form('revoke',{installation:state.salon}));assert.equal(result.ok,false);assert.equal(state.calls.some(c=>c.name==='revoke'),false);}
 for(const value of [null,false,{}]){state.responses={revoke:value};state.calls=[];assert.equal((await ownerAppAction({},form('revoke',{installation:state.salon}))).ok,false);assert.equal(state.calls.filter(c=>c.name==='revoke').length,1);}
});
test('interrupted install/revoke responses remain uncertain and never auto retry; SQL rejection remains definite',async()=>{
 for(const operation of ['install','revoke'])for(const unknownPlatformError of [false,true]){state.calls=[];state.responses={};state.throwOperation=operation;state.unknownPlatformError=unknownPlatformError;const result=await ownerAppAction({},form(operation,operation==='install'?{version:state.salon,sha256:'a'.repeat(64),scopes:'[]',consent:'yes'}:{installation:state.salon}));assert.equal(result.ok,false);assert.match(result.message,/may have completed/);assert.equal(state.calls.filter(c=>c.name===operation).length,1);}
 state.definiteRejection=true;const result=await ownerAppAction({},form('revoke',{installation:state.salon}));assert.equal(result.message,'Synthetic SQL rejection');
});
test('malformed/foreign/unsafe launch details never redirect an Owner',async()=>{
 for(const value of [null,{}, {launchUrl:'javascript:alert(1)',clientId:state.salon,installationId:state.salon,versionId:state.salon},{launchUrl:'https://developer.reylumi.com/app',clientId:state.salon,installationId:'00000000-0000-4000-8000-000000000099',versionId:state.salon}]){state.responses={connection_start:value};const result=await ownerAppAction({},form('connect',{installation:state.salon}));assert.equal(result.ok,false);assert.match(result.message,/could not be verified/);}
});
