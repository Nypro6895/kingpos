import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import {historyNotificationFixture} from './helpers/history-notification-fixture.mjs';

const replacements={
 'server-only':'',
 '@/lib/supabase/server':'export const createAuthenticatedSupabaseServerClient=async()=>globalThis.__attentionClient;export const getSupabaseConfig=()=>null;',
 '@/lib/workspace-pending':'export const getAppNotificationScopeForContext=c=>({recipientKind:c.kind??"owner_manager",salonId:c.currentSalon?.id});',
 '@/lib/current-context':'export const getManageWorkspaceId=id=>`manage:${id}`;export const getStaffWorkspaceId=id=>`staff:${id}`;',
 '@/lib/salon-profile':'export const getSalonProfileMediaUrl=()=>null;',
 '@/lib/beauty-media':'export const getBeautyMediaPublicUrl=()=>null;',
};
const {outputFiles}=await build({stdin:{resolveDir:process.cwd(),contents:'export {loadNotificationPage} from "./lib/notification-center";',loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'isolated-authenticated-rpc',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(replacements,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:replacements[a.path],loader:'ts'}));}}]});
const {loadNotificationPage}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const context={user:{id:'owner'},currentSalon:{id:'salon-A'},currentAccount:{id:'account-A'}};
const notice=(id,salon='salon-A',kind='owner_manager')=>({id,salon_id:salon,recipient_kind:kind,notification_type:'financial_input_updated',title:'Ticket updated',body:'Recorded inputs',href:'/staff/today?eventDate=2026-10-29#input-history',read_at:null,created_at:'2026-10-30T01:00:00Z',booking_id:null});

test('Owner attention filters the actor-wide feed by exact salon/recipient and follows the RAW cursor across other workspaces',async()=>{
 const first=Array.from({length:51},(_,i)=>notice('other-'+i,i%2?'salon-B':null,i%2?'owner_manager':'customer'));
 const event='b0000000-1111-4111-8111-000000000001',recipient='b0000000-1111-4111-8111-000000000002';
 const own={...notice('own'),event_key:'financial-input-owner:'+event+':'+recipient},calls=[];
 globalThis.__attentionClient={from(){throw Error('No raw-table fallback allowed');},rpc:async(name,args)=>{calls.push({name,args});return {data:{items:calls.length===1?first:[own,notice('read','salon-A'),notice('personal','salon-A','customer'),notice('wrong','salon-B')],unreadCount:99}};}};
 const result=await loadNotificationPage(context,{limit:3,unread:true,strictSalonScope:true});
 assert.equal(calls.length,2);assert.equal(calls[0].name,'notification_feed');assert.equal(calls[0].args.p_kind,'owner_manager');assert.equal(calls[0].args.p_salon,'salon-A');assert.equal(calls[0].args.p_unread,true);
 assert.equal(calls[1].args.p_before_id,'other-50');assert.equal(calls[1].args.p_before,first.at(-1).created_at);
 assert.deepEqual(result.items.map(r=>r.id),['app:own','app:read']);assert.ok(result.items[0].action.href.includes('inputEvent='+event));
});
test('an unavailable feed or incomplete bounded scan returns an error, never a false empty attention result',async()=>{
 globalThis.__attentionClient={rpc:async()=>({error:{message:'private'}})};
 await assert.rejects(loadNotificationPage(context,{strictSalonScope:true}),/Could not load notifications/);
 let page=0;globalThis.__attentionClient={rpc:async()=>({data:{items:Array.from({length:51},(_,i)=>notice('other-'+(++page)+'-'+i,'other')),unreadCount:9999}})};
 await assert.rejects(loadNotificationPage(context,{strictSalonScope:true,limit:3}),/fully checked/);
 await assert.rejects(loadNotificationPage({...context,kind:'staff'},{strictSalonScope:true}),/Salon notification access/);
});
test('ordinary notification-center loading keeps its actor-wide behavior',async()=>{
 const global=notice('personal',null,'customer');let called;
 globalThis.__attentionClient={rpc:async(name,args)=>{called=args;return {data:{items:[global],unreadCount:1}};}};
 const result=await loadNotificationPage(context,{limit:3});assert.equal(called.p_limit,4);assert.equal(result.items[0].id,'app:personal');
});

test('actual SQL suppression of draft/duplicate notices is honored by the actual scoped attention loader',async()=>{
 const {db,row,actor,uid,date}=await historyNotificationFixture();
 try{
  await db.exec(fs.readFileSync('supabase/migrations/20261030100000_history_notification_semantics.sql','utf8'));
  await actor(uid(90));
  await db.query("insert into public.financial_input_events(id,salon_id,kind,business_date,source_id,before_values,after_values,actor_name,event_action) values($1,$2,'ticket',$3,$4,'{}','{\"status\":\"open\"}','Owner','draft'),($5,$2,'ticket',$3,$4,'{\"service_total\":50}','{\"service_total\":60}','Owner','updated')",[uid(700),uid(1),date,uid(30),uid(701)]);
  await db.query("insert into public.financial_input_event_staff(event_id,salon_id,staff_id,staff_name,kind,business_date,before_values,after_values,note,actor_name,created_at) values($1,$2,$3,'Anna','ticket',$4,'{\"service_total\":50}','{\"service_total\":60}','','Owner',now())",[uid(701),uid(1),uid(10),date]);
  const entries=[
   [uid(710),uid(1),'owner_manager','Draft hidden','financial-input-owner:'+uid(700)+':'+uid(90)],
   [uid(711),uid(1),'owner_manager','Visible original edit','financial-input-owner:'+uid(701)+':'+uid(90)],
   [uid(712),uid(1),'staff','Duplicate hidden','financial-input:'+uid(701)+':'+uid(10)],
   [uid(713),uid(8),'owner_manager','Other salon','other-salon'],
   [uid(714),null,'customer','Personal system','personal-system'],
  ];
  for(const [id,salon,kind,title,key] of entries)await db.query("insert into public.app_notifications(id,account_id,salon_id,recipient_user_id,recipient_kind,notification_type,title,body,href,event_key) values($1,$2,$3,$4,$5,'financial_input_updated',$6,'View recorded inputs',$7,$8)",[id,uid(2),salon,uid(90),kind,title,'/staff/today?eventDate='+date+'#input-history',key]);
  const raw=await row('select count(*)::int n from public.app_notifications');assert.equal(raw.n,5);
  globalThis.__attentionClient={from(){throw Error('No raw-table fallback');},rpc:async(name,args)=>{assert.equal(name,'notification_feed');return {data:(await row('select public.notification_feed($1,$2,$3,$4,$5,$6,$7) r',[args.p_kind,args.p_salon,args.p_account,args.p_unread,args.p_before,args.p_before_id,args.p_limit])).r};}};
  const result=await loadNotificationPage({user:{id:uid(90)},currentSalon:{id:uid(1)}},{limit:3,unread:true,strictSalonScope:true});
  assert.deepEqual(result.items.map(r=>r.title),['Visible original edit']);assert.ok(result.items[0].action.href.includes('inputEvent='+uid(701)));
  assert.equal((await row('select count(*)::int n from public.app_notifications')).n,5);
 }finally{await db.close();}
});
test.after(()=>{delete globalThis.__attentionClient;});
