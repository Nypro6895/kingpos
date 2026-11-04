import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {build} from 'esbuild';
import {proposedOwnerSource} from '../examples/market-qa-bootstrap/origin-review.mjs';
const result=await build({entryPoints:['lib/market-platform/qa-owner-origin-contract.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {matchReviewedQaOwnerOrigin:match}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const shipped=JSON.parse(fs.readFileSync('config/market-owner-qa-origins.json'));
const NOW=Date.parse('2026-10-30T01:00:00.000Z'),scope='isolated-nonfinancial-market-qa';
const config=()=>({...shipped,approved:true,marketOrigin:'https://synthetic-owner-qa.vercel.app',qrOrigin:'https://synthetic-qr-qa.vercel.app',marketProjectId:'prj_marketqa0001',qrProjectId:'prj_qrqa00000001',productionProjectId:'prj_production01',reviewId:'00000000-0000-4000-8000-000000000001',sourceSha256:'a'.repeat(64),reviewedAt:'2026-10-30T00:00:00.000Z',expiresAt:'2026-11-02T00:00:00.000Z'});
const runtime=()=>({mode:scope,providerProjectId:'prj_marketqa0001'});

test('shipped origin contract is inactive; malformed/unapproved/unknown metadata never grants a candidate or fallback',()=>{
 const c=config();assert.equal(shipped.approved,false);assert.equal(shipped.marketOrigin,'');assert.equal(match(shipped,c.marketOrigin,runtime(),NOW),null);
 for(const bad of [null,[],{}, {...c,approved:'true'},{...c,approved:false},{...c,schemaVersion:2},{...c,scope:'production'},{...c,marketProjectId:''},{...c,productionProjectId:c.marketProjectId},{...c,qrProjectId:c.marketProjectId},{...c,reviewId:''},{...c,sourceSha256:'0'.repeat(64)},{...c,allowWildcard:true},{...c,[Symbol('unknown')]:true}])assert.equal(match(bad,c.marketOrigin,runtime(),NOW),null);
 const getter={...c};Object.defineProperty(getter,'approved',{get:()=>true});assert.equal(match(getter,c.marketOrigin,runtime(),NOW),null);
 for(const absent of [undefined,null,''])assert.equal(match(c,absent,runtime(),NOW),null);
});

test('only a literal reviewed HTTPS origin matches; aliases/paths/ports/userinfo/wildcards/foreign or production namespaces are denied',()=>{
 const c=config();assert.equal(match(c,c.marketOrigin,runtime(),NOW),c.marketOrigin);
 const invalid=['http://synthetic-owner-qa.vercel.app','https://synthetic-owner-qa.vercel.app/','https://synthetic-owner-qa.vercel.app:443','https://synthetic-owner-qa.vercel.app:8443','https://user@synthetic-owner-qa.vercel.app','https://synthetic-owner-qa.vercel.app?next=https://evil.com','https://synthetic-owner-qa.vercel.app#x','https://synthetic-owner-qa.vercel.app/connect','https://*.vercel.app','https://synthetic-owner-qa.vercel.app.','https://SYNTHETIC-owner-qa.vercel.app','https://synthetic-owner-qa%2evercel.app','https://synthetic-owner-qa.vercel.app\\evil','https://localhost','https://127.0.0.1','https://[::1]','https://internal.local','https://xn--example-9d0b.com','https://réylumi.com','https://reylumi.com','https://www.reylumi.com','https://qa.reylumi.com'];
 for(const value of invalid){assert.equal(match({...c,marketOrigin:value},value,runtime(),NOW),null);assert.equal(match(c,value,runtime(),NOW),null);}
 for(const value of [c.qrOrigin,'https://foreign.vercel.app',c.marketOrigin+'.evil.com','https://reylumi.com.evil.com'])assert.equal(match(c,value,runtime(),NOW),null);
 assert.equal(match({...c,qrOrigin:c.marketOrigin},c.marketOrigin,runtime(),NOW),null);assert.equal(match({...c,qrOrigin:'https://reylumi.com'},c.marketOrigin,runtime(),NOW),null);
});

test('review window and provider project/mode are independent gates; production/foreign/missing identities cannot enable QA',()=>{
 const c=config();for(const r of [null,{}, {mode:scope},{providerProjectId:c.marketProjectId},{...runtime(),mode:'production'},{...runtime(),providerProjectId:c.productionProjectId},{...runtime(),providerProjectId:c.qrProjectId},{...runtime(),providerProjectId:'prj_foreign0001'},{...runtime(),'x-vercel-project-id':c.marketProjectId}])assert.equal(match(c,c.marketOrigin,r,NOW),null);
 for(const at of [NaN,Infinity,undefined,Date.parse(c.reviewedAt)-1,Date.parse(c.expiresAt),Date.parse(c.expiresAt)+1])assert.equal(match(c,c.marketOrigin,runtime(),at),null);
 for(const bad of [{...c,expiresAt:'2026-11-02T00:00:00.001Z'},{...c,reviewedAt:'2026-10-30T00:00:00Z'},{...c,expiresAt:c.reviewedAt}])assert.equal(match(bad,c.marketOrigin,runtime(),NOW),null);
});

async function compileGuard({proposal=false,reviewed=shipped,origin,mode,project}={}){
 const source=proposedOwnerSource();const built=await build({stdin:{contents:'export {platformPublicOrigin} from "./lib/market-platform/owner.ts";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},banner:{js:'const __qaTestClock=()=>'+NOW+';'},define:{'process.env.MARKET_PLATFORM_PUBLIC_ORIGIN':origin===undefined?'undefined':JSON.stringify(origin),'process.env.MARKET_QA_ORIGIN_MODE':mode===undefined?'undefined':JSON.stringify(mode),'process.env.VERCEL_PROJECT_ID':project===undefined?'undefined':JSON.stringify(project),'Date.now':'__qaTestClock'},plugins:[{name:'unapplied-proposal-and-provider-boundaries',setup(b){
  if(proposal)b.onLoad({filter:/[\\/]lib[\\/]market-platform[\\/]owner\.ts$/},()=>({contents:source,loader:'ts',resolveDir:path.resolve('lib/market-platform')}));
  b.onLoad({filter:/[\\/]config[\\/]market-owner-qa-origins\.json$/},()=>({contents:JSON.stringify(reviewed),loader:'json'}));
  b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'fixture'}));b.onResolve({filter:/^@\/lib\/supabase\/server$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='empty'?'':'export const createAuthenticatedSupabaseServerClient=async()=>null;export const createSupabaseServerClient=()=>null;export const createUserScopedSupabaseServerClient=()=>null;export const getSupabaseAuthUser=async()=>null;export const getAccessTokenFromRequest=async()=>null;'}));
 }}]});return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
}

test('unapplied patch preserves actual production/loopback behavior and stays closed by default; current guard never imports the contract',async()=>{
 const current=fs.readFileSync('lib/market-platform/owner.ts','utf8');assert.equal(current.includes('qa-owner-origin-contract'),false);
 for(const proposal of [false,true])for(const origin of [undefined,'https://reylumi.com','http://127.0.0.1:4328','http://localhost:4328']){const guard=await compileGuard({proposal,origin});assert.equal(guard.platformPublicOrigin(),origin??'https://reylumi.com');}
 const c=config();for(const proposal of [false,true]){const guard=await compileGuard({proposal,origin:c.marketOrigin,mode:scope,project:c.marketProjectId});assert.throws(()=>guard.platformPublicOrigin(),/not configured/);}
 const preview=await compileGuard({proposal:true,reviewed:c,origin:c.marketOrigin,mode:scope,project:c.marketProjectId});assert.equal(preview.platformPublicOrigin(),c.marketOrigin);
 const production=await compileGuard({proposal:true,reviewed:c,origin:c.marketOrigin,mode:scope,project:c.productionProjectId});assert.throws(()=>production.platformPublicOrigin(),/not configured/);
 for(const origin of [undefined,'https://reylumi.com','http://127.0.0.1:4328']){const noFallback=await compileGuard({proposal:true,reviewed:c,origin,mode:scope,project:c.marketProjectId});assert.throws(()=>noFallback.platformPublicOrigin(),/not configured/);}
 const malformedMode=await compileGuard({proposal:true,reviewed:c,origin:'https://reylumi.com',mode:'production',project:c.productionProjectId});assert.throws(()=>malformedMode.platformPublicOrigin(),/not configured/);
 assert.equal(fs.readFileSync('lib/market-platform/owner.ts','utf8'),current,'Compiling a proposal must not mutate the runtime file');
});
