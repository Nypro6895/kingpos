import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PayrollChangeHistory} from './app/payroll/payroll-change-history';
export {resolveAppNotificationDestination,appNotificationToFeedItem} from './lib/notification-feed-items';
export const renderHistory=changes=>renderToStaticMarkup(<div id="input-history"><PayrollChangeHistory compact changes={changes}/></div>);
`},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime','react-dom/server'],plugins:[{name:'isolated-context-and-copy',setup(b){
 b.onResolve({filter:/^@\/lib\/current-context$/},()=>({path:'context',namespace:'fixture'}));
 b.onResolve({filter:/workspace-language$/},()=>({path:'copy',namespace:'fixture'}));
 b.onResolve({filter:/\.module\.css$/},()=>({path:'styles',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',contents:a.path==='context'?'export const getStaffWorkspaceId=id=>`staff:${id}`;export const getManageWorkspaceId=id=>`manage:${id}`;':a.path==='styles'?'export default {};':'export const WorkspaceText=({text})=>text;'}));
}}]});
const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
const {resolveAppNotificationDestination,appNotificationToFeedItem,renderHistory}=module.exports;
const legacy={id:'notification-1',notification_type:'payroll_updated',recipient_kind:'staff',salon_id:'salon',href:'/staff/my-work?tab=payroll&payPeriodStart=2026-10-16%3A2026-10-31#payroll-changes',title:'Payroll updated',body:'An earlier update',created_at:'2026-10-29T12:00:00Z',read_at:null,booking_id:null};

test('retained legacy Payroll notification reaches the current history anchor and preserves its original period without inventing an event id',()=>{
 const destination=resolveAppNotificationDestination(legacy),url=new URL(destination.href,'https://fixture.invalid');
 assert.equal(destination.workspaceId,'staff:salon');assert.equal(url.hash,'#input-history');assert.equal(url.searchParams.get('payPeriodStart'),'2026-10-16:2026-10-31');assert.equal(url.searchParams.has('inputEvent'),false);
 const markup=renderHistory([{id:'retained-audit',salon_id:'salon',staff_id:'staff',source_table:'payroll_period_staff_inputs',source_id:'period-input',period_start:'2026-10-16',period_end:'2026-10-31',before_values:{bonus_amount:0},after_values:{bonus_amount:25},actor_id:null,actor_name:'Owner',created_at:'2026-10-29T12:00:00Z'}]);
 assert.ok(markup.includes(`id="${url.hash.slice(1)}"`));assert.ok(markup.includes('Bonus'));assert.ok(markup.includes('$25.00'));assert.equal(markup.includes('payroll-changes'),false);
 const item=appNotificationToFeedItem(legacy);assert.equal(item.action.href,destination.href);assert.equal(item.action.notificationId,legacy.id);assert.equal(item.unread,true);
});
test('explicit new event links retain their event identity and Owner/Staff workspace handoff',()=>{
 const href='/staff/my-work?tab=payroll&payPeriodStart=2026-10-01&inputEvent=event-1#input-history';
 const current=resolveAppNotificationDestination({...legacy,notification_type:'financial_input_updated',href});assert.equal(current.href,href);assert.equal(current.workspaceId,'staff:salon');
 const ownerHref='/staff/today?eventDate=2026-10-01&inputEvent=event-1#input-history';const owner=resolveAppNotificationDestination({...legacy,recipient_kind:'owner_manager',notification_type:'financial_input_updated',href:ownerHref});assert.equal(owner.href,ownerHref);assert.equal(owner.workspaceId,'manage:salon');
 const unrelated=resolveAppNotificationDestination({...legacy,notification_type:'other',href:'/staff/my-work?tab=analysis'});assert.equal(unrelated.href,'/staff/my-work?tab=analysis');
});

test('legacy ticket notices recover an exact event only from a complete captured financial event key',()=>{
 const event='b0000000-1111-4111-8111-000000000001',recipient='b0000000-1111-4111-8111-000000000002';
 for(const [kind,path,key,workspace] of [['owner_manager','/staff/today','financial-input-owner','manage:salon'],['staff','/staff/my-work','financial-input','staff:salon']]){
  const notice={...legacy,recipient_kind:kind,notification_type:'financial_input_updated',href:path+'?eventDate=2026-10-29#input-history',event_key:key+':'+event+':'+recipient};
  const destination=resolveAppNotificationDestination(notice),url=new URL(destination.href,'https://fixture.invalid');
  assert.equal(url.searchParams.get('eventDate'),'2026-10-29');assert.equal(url.searchParams.get('inputEvent'),event);assert.equal(url.hash,'#input-history');assert.equal(destination.workspaceId,workspace);
  assert.equal(appNotificationToFeedItem(notice).action.href,destination.href);
 }
});
test('day-only unknown legacy links stay day-only and explicit event identity is never overwritten',()=>{
 const href='/staff/today?eventDate=2026-10-29#input-history',notice={...legacy,recipient_kind:'owner_manager',notification_type:'financial_input_updated',href};
 for(const event_key of [undefined,'financial-input-owner:not-a-uuid:other','period-input:b0000000-1111-4111-8111-000000000001'])assert.equal(resolveAppNotificationDestination({...notice,event_key}).href,href);
 const explicit=href.replace('#','&inputEvent=existing#');assert.equal(resolveAppNotificationDestination({...notice,href:explicit,event_key:'financial-input-owner:b0000000-1111-4111-8111-000000000001:b0000000-1111-4111-8111-000000000002'}).href,explicit);
 assert.equal(resolveAppNotificationDestination({...notice,recipient_kind:'customer',event_key:'financial-input-owner:b0000000-1111-4111-8111-000000000001:b0000000-1111-4111-8111-000000000002'}).href,href);
});
