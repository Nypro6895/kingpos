import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url),key=Symbol.for('market-recovery-test');
const salon='00000000-0000-4000-8000-000000000001';
const state={mode:'normal',reads:[],owner:{status:'ready',data:{salonId:salon,salonName:'Synthetic A',observedAt:'2026-10-28T21:00:00Z',testPaymentsEnabled:false,catalog:[],installations:[]}}};globalThis[key]=state;
async function compile(entry,page=false){
 const replacements={
  'next/link':`import React from 'react';export default function Link({href,children,...rest}){return React.createElement('a',{href,...rest},children)}`,
  'next/server':'export async function connection(){}',
  '@/components/workspace-language':'export function WorkspaceText({text}){return text};export function useWorkspaceTranslation(){return text=>text}',
  '@/components/experience-page':'export const withExperiencePage=page=>page;',
  '@/lib/request-business-context':`export async function getRequestBusinessContext(){return {syntheticSalon:'${salon}'}}`,
  '@/lib/experience-context':'export const getExperienceContext=()=>({scope:"synthetic-only"});',
  '@/lib/experience-live-resource-server':'export const createLiveResourceSnapshot=data=>({data});',
  '@/app/market/market-experience-client':'export function MarketExperienceClient(){}',
  '@/app/market/market-startup-view':'export function MarketStartupView(){}',
  '@/lib/market-experience-data':`import {ReadConnectionError}from '@/lib/bounded-get';export async function loadMarketExperienceData(context){const s=globalThis[Symbol.for('market-recovery-test')];s.reads.push('composite');if(s.mode==='hang')return new Promise(()=>{});if(s.mode==='connection')throw new ReadConnectionError('network');if(s.mode==='bug')throw new TypeError('Synthetic unexpected bug');return {nativeState:'authoritative',context};}`,
  '@/lib/market-platform/owner':`export async function loadOwnerMarketplace(context){const s=globalThis[Symbol.for('market-recovery-test')];s.reads.push('owner-independent');s.ownerContext=context;return s.owner;}`,
 };
 if(page)replacements['@/app/market/market-developer-recovery']='export function MarketDeveloperRecovery(){}';
 const out=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'controlled-boundaries',setup(b){
  b.onResolve({filter:/^react(?:\/jsx-runtime)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));
  b.onResolve({filter:/.*/},a=>Object.hasOwn(replacements,a.path)?{path:a.path,namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:replacements[a.path]}));
  b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'css'}));b.onLoad({filter:/.*/,namespace:'css'},()=>({contents:'export default new Proxy({}, {get:(_,key)=>String(key)});'}));
  b.onResolve({filter:/developer-app-actions$/},()=>({path:'actions',namespace:'actions'}));b.onLoad({filter:/.*/,namespace:'actions'},()=>({contents:'export async function ownerAppAction(){throw Error("No mutations allowed in this test")}'}));
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
const page=await compile('app/(app)/market/page.tsx',true);
const ui=await compile('app/market/market-developer-recovery.tsx');
test.after(()=>delete globalThis[key]);test.beforeEach(()=>{state.mode='normal';state.reads=[];state.owner={status:'ready',data:{salonId:salon,salonName:'Synthetic A',observedAt:'2026-10-28T21:00:00Z',testPaymentsEnabled:false,catalog:[],installations:[]}}});
async function content(query={}){const shell=await page.default({searchParams:Promise.resolve(query)});return shell.props.children.type(shell.props.children.props);}
test('healthy Market retains original authoritative view and does not add an Owner read',async()=>{const view=await content();assert.equal(view.type.name,'MarketExperienceClient');assert.equal(view.props.initial.data.nativeState,'authoritative');assert.deepEqual(state.reads,['composite']);});
for(const mode of ['hang','connection'])test(mode+' composite read uses separately authorized same-context developer state',async()=>{state.mode=mode;const started=performance.now();const view=await content({q:'Synthetic QR'});if(mode==='hang')assert.ok(performance.now()-started>=19000,'Actual production20s deadline must run, not a mocked timeout');assert.equal(view.type.name,'MarketDeveloperRecovery');assert.equal(view.props.initial.data.salonId,salon);assert.equal(view.props.initialQuery,'Synthetic QR');assert.deepEqual(state.reads,['composite','owner-independent']);assert.equal(state.ownerContext.syntheticSalon,salon);assert.equal(Object.hasOwn(view.props,'nativeState'),false);});
test('unavailable/unauthorized developer state is preserved, never replaced by fabricated ready state',async()=>{state.mode='connection';state.owner={status:'select-salon',message:'Owner required'};const view=await content();assert.deepEqual(view.props.initial,state.owner);assert.equal(view.key,'select-salon');});
test('unexpected bugs and payment-return failures keep their original boundary',async()=>{state.mode='bug';await assert.rejects(content(),/Synthetic unexpected bug/);assert.equal(state.reads.includes('owner-independent'),false);state.mode='connection';state.reads=[];await assert.rejects(page.default({searchParams:Promise.resolve({payment:'received'})}),/Connection temporarily unavailable/);assert.deepEqual(state.reads,['composite']);});
test('actual recovery component renders four-scope app with clear partial state and no fabricated native billing',()=>{
 const manifest={schemaVersion:1,type:'hosted-app',version:'1.0.0',name:'Synthetic QR menu',description:'Approved public groups only',launchUrl:'https://developer.reylumi.com/connect',privacyUrl:'https://developer.reylumi.com/privacy',supportUrl:'https://developer.reylumi.com/support',scopes:['salon:profile:read','salon:services:read','salon:media:read','salon:content:read'],price:{currency:'usd',amountCents:0,billing:'one-time-version'}};
 state.owner.data.catalog=[{id:salon,app_id:salon,version:'1.0.0',manifest,publisher:'Synthetic publisher',sha256:'a'.repeat(64),entitled:true,connectionReady:true}];
 const html=renderToStaticMarkup(React.createElement(ui.MarketDeveloperRecovery,{initial:state.owner,initialQuery:'Synthetic QR'}));assert.match(html,/Synthetic QR menu/);assert.match(html,/Some Reylumi features could not load/);assert.match(html,/Synthetic A/);assert.match(html,/Manage data shared with plugins/);assert.match(html,/View app/);assert.doesNotMatch(html,/Subscription active|Make payment|Booking Deposit|Payroll Data Download/);
});
test('actual recovery component denies missing Owner data without zero subscription or install claims',()=>{const html=renderToStaticMarkup(React.createElement(ui.MarketDeveloperRecovery,{initial:{status:'unavailable',message:'unavailable'}}));assert.match(html,/Developer apps could not be loaded/);assert.doesNotMatch(html,/No developer apps match|View app|Synthetic A/);});
test('late mutation observations cannot cross salons, regress freshness, or override unavailable authorization',()=>{
 const next={...state.owner.data,observedAt:'2026-10-28T21:01:00Z'};assert.equal(ui.recoveryState(state.owner,next).data,next);
 assert.equal(ui.recoveryState({status:'ready',data:next},state.owner.data).data,next);
 assert.equal(ui.recoveryState(state.owner,{...next,salonId:'00000000-0000-4000-8000-000000000002'}),state.owner);
 assert.equal(ui.recoveryState(state.owner,{...next,observedAt:'invalid'}),state.owner);
 const unavailable={status:'unavailable',message:'Owner access unavailable'};assert.equal(ui.recoveryState(unavailable,next),unavailable);
});
test('disabled developer platform does not offer search or app controls in recovery',()=>{const html=renderToStaticMarkup(React.createElement(ui.MarketDeveloperRecovery,{initial:{status:'disabled',message:'disabled'}}));assert.match(html,/Developer apps are not available/);assert.doesNotMatch(html,/Find a developer app|Available developer apps|View app/);});
