import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {PGlite}from'@electric-sql/pglite';import{build}from'esbuild';
const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const customer=id(1),other=id(2),moderator=id(3),salon=id(10),privateSalon=id(11),experience=id(20),otherExperience=id(21),reply=id(30),otherReply=id(31);
function definition(file,name){const s=fs.readFileSync(file,'utf8'),start=s.search(new RegExp('create (?:or replace )?function public\\.'+name+'\\('));assert(start>=0);return s.slice(start,s.indexOf('$$;',s.indexOf('as $$',start))+3);}
async function bundle(entry,mocks={}){const r=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':path.resolve('.')},loader:{'.css':'empty'},plugins:[{name:'transport',setup(b){b.onResolve({filter:/.*/},a=>a.path==='server-only'||Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]??'',loader:'tsx',resolveDir:process.cwd()}));}}]});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));}
const {submitSocialTextReport}=await bundle('lib/social-text-reports.ts');
const {loadAdminReportContext}=await bundle('lib/platform-admin/report-context.ts',{
 './rpc':`export const callPlatformAdminRpc=(n,a)=>globalThis.__caseTransport(n,a);`,
 './reports':`export const getPlatformAdminReportDetail=id=>globalThis.__caseTransport('get_platform_admin_report_detail',{p_report_id:id});`,
 './post-safety':`export const loadAdminPostReviewWorkspace=async()=>({cases:[]});`,
 '@/lib/support-cases':`export const supportRpc=(n,a)=>globalThis.__caseTransport(n,a);`
});
// The actual case renderer is used, not a mock of the consumer/presentation path.
const viewBuild=await build({outdir:'fixture',banner:{js:'import {createRequire as __cr} from "node:module";const require=__cr('+JSON.stringify(path.resolve('package.json'))+');'},stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from'react';import{renderToStaticMarkup}from'react-dom/server';import{ReportCaseView}from'./app/(app)/admin/reports/report-case-view';export const render=data=>renderToStaticMarkup(<ReportCaseView data={data} permissions={['admin.reports.read']} assignees={[]} membershipId="admin" roleSlug="moderator"/>);`},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'operational-boundaries',setup(b){const mocks={
 'next/navigation':`export const useRouter=()=>({refresh(){}});`,
 'next/link':`import React from'react';export default function Link(p){return React.createElement('a',p);}`,
 'next/image':`import React from'react';export default function Image(p){return React.createElement('img',p);}`,
 '@/lib/admin-support-client':`export const openAdminSupport=()=>{};`,
 '@/app/support/actions':`export const reopenContentReportReview=async()=>{};`,
 '../dashboard/dashboard-action-form':`import React from'react';export const DashboardActionForm=({children})=>React.createElement('div',null,children);`,
 '../dashboard/actions':`export const dashboardCaseAction=async()=>({ok:true});`,
 './report-evidence':`export const ReportEvidence=()=>null;`
 };b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
const {render}=await import('data:text/javascript;base64,'+Buffer.from(viewBuild.outputFiles[0].text).toString('base64'));

test('producer → stored support case → authenticated admin loader → actual case UI resolves exact private reply and rejects cross-tenant forgeries',async()=>{
 const db=new PGlite();const sql=file=>fs.readFileSync(file,'utf8');
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table users(id uuid primary key,status text,display_name text,first_name text,last_name text);
 create table locations(id uuid primary key,name text);create table salon_settings(salon_id uuid,business_name text);
 create table customers(id uuid,location_id uuid,customer_user_id uuid);create table pos_tickets(id uuid,salon_id uuid,customer_id uuid,status text);
 create table customer_visit_experiences(id uuid primary key,salon_id uuid,author_user_id uuid,ticket_id uuid,feedback_state text,body text,issue_status text,edited_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
 create table visit_experience_replies(id uuid primary key,experience_id uuid unique,author_user_id uuid,body text,created_at timestamptz default now());
 create table salon_profile_reviews(id uuid primary key,salon_id uuid,author_user_id uuid,body text,edited_at timestamptz,created_at timestamptz,updated_at timestamptz,verification_status text,moderation_status text);
 create table salon_profile_review_replies(id uuid primary key,review_id uuid,author_user_id uuid,body text,moderation_status text,created_at timestamptz default now());
 create table salon_profile_comments(id uuid primary key,salon_id uuid,look_id uuid,update_id uuid,beauty_post_id uuid,status text,body text);
 create table platform_reports(id uuid primary key default gen_random_uuid(),report_number text default 'CASE-TEST',status text default 'new',priority text default 'normal',category text,summary text,description text,source text,reporter_user_id uuid,created_by_user_id uuid,support_request_id uuid,support_context jsonb,created_at timestamptz default now());
 create table support_case_messages(report_id uuid,actor_user_id uuid,sender text,body text);
 create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function social_users_blocked(uuid,uuid) returns boolean language sql as $$select false$$;
 create function salon_profile_public_salon_exists(uuid) returns boolean language sql as $$select $1='${salon}'::uuid$$;
 create function post_comment_target_is_public(uuid,uuid,uuid,uuid) returns boolean language sql as $$select $4='${salon}'::uuid$$;
 create function platform_admin_require_permission(text) returns void language plpgsql as $$begin if current_public_user_id() is distinct from '${moderator}'::uuid or coalesce(current_setting('test.revoked',true),'')='yes' then raise exception 'Permission denied.' using errcode='42501';end if;end$$;
 create function get_platform_admin_report_detail(p_report_id uuid) returns jsonb language plpgsql security definer as $$declare report_row platform_reports;begin perform platform_admin_require_permission('admin.reports.read');select * into report_row from platform_reports where id=p_report_id;if not found then raise exception 'Report not found.';end if;return jsonb_build_object('report',to_jsonb(report_row)||jsonb_build_object('source', report_row.source,'updated_at',report_row.created_at),'subject',null,'reporter',null,'assignee',null,'notes','[]'::jsonb,'timeline','[]'::jsonb);end$$;
 insert into users(id,status,display_name) values('${customer}','active','Customer A'),('${other}','active','Customer B'),('${moderator}','active','Moderator');
 insert into locations values('${salon}','Public'),('${privateSalon}','Private');
 insert into customer_visit_experiences(id,salon_id,author_user_id,body) values('${experience}','${privateSalon}','${customer}','DO NOT EXPOSE PARENT A'),('${otherExperience}','${privateSalon}','${other}','DO NOT EXPOSE PARENT B');
 insert into visit_experience_replies(id,experience_id,author_user_id,body) values('${reply}','${experience}','${other}','EXACT PRIVATE SALON REPLY A'),('${otherReply}','${otherExperience}','${customer}','SECRET OTHER CUSTOMER REPLY B');`);
 for(const name of ['support_active_user','submit_user_support_case'])await db.exec(definition('supabase/migrations/202610070019_support_active_identity.sql',name));
 await db.exec(definition('supabase/migrations/20261030002000_visit_experience_replies.sql','get_my_visit_experiences'));
 await db.exec(sql('supabase/migrations/20261109223000_social_report_evidence.sql'));
 const actor=uid=>db.query("select set_config('test.actor',$1,false)",[uid??'']);
 const rpc=async(name,args={})=>{const entries=Object.entries(args);return(await db.query(`select public.${name}(${entries.map(([key],i)=>`${key}=>$${i+1}`).join(',')}) data`,entries.map(([,v])=>v))).rows[0].data;};
 const client={async rpc(name,args){try{return{data:await rpc(name,args),error:null};}catch(e){return{data:null,error:{message:e.message}};}}};
 await actor(customer);const result=await submitSocialTextReport(client,{target:{kind:'own_experience_reply',id:experience},requestId:id(50),reason:'Harassing salon reply'});
 const reportId=result.supportHref.split('/').at(-1);
 for(const uid of [customer,other]){await actor(uid);await assert.rejects(rpc('get_admin_social_report_evidence',{p_report_id:reportId}),/permission denied/i);}
 await actor(moderator);
 globalThis.__caseTransport=async(name,args)=>{
  if(name==='get_admin_report_previews'){const rid=args.p_report_ids[0],r=(await db.query('select * from platform_reports where id=$1',[rid])).rows[0];return{[rid]:{description:r.description,context_path:r.support_context.path,review:null}};}
  if(name==='get_support_conversation'){const r=(await db.query('select * from platform_reports where id=$1',[args.p_report_id])).rows[0];return{id:r.id,context:r.support_context,messages:[],attachments:[],admin_view:true};}
  return rpc(name,args);
 };
 const data=await loadAdminReportContext(reportId);assert.equal(data.socialContent.contentId,reply);assert.equal(data.socialContent.parentId,experience);
 const html=render(data);assert(html.includes('EXACT PRIVATE SALON REPLY A'));assert(!html.includes('SECRET OTHER CUSTOMER'));assert(!html.includes('DO NOT EXPOSE PARENT'));assert(!html.includes('href="/more/reviews'));
 const transport=globalThis.__caseTransport;
 globalThis.__caseTransport=(name,args)=>name==='get_support_conversation'?Promise.reject(Error('Attachment transport failed')):transport(name,args);
 const withoutChat=await loadAdminReportContext(reportId);assert.equal(withoutChat.socialContent.contentId,reply);assert(render(withoutChat).includes('EXACT PRIVATE SALON REPLY A'));
 globalThis.__caseTransport=transport;
 await db.exec(`insert into salon_profile_comments values('${id(60)}','${salon}','${id(61)}',null,null,'published','EXACT PUBLIC COMMENT');
 insert into salon_profile_reviews(id,salon_id,author_user_id,body,moderation_status,created_at) values('${id(62)}','${salon}','${other}','EXACT PUBLIC REVIEW','visible',now()),('${id(70)}','${privateSalon}','${customer}','PRIVATE LEGACY PARENT','visible',now());
 insert into salon_profile_review_replies(id,review_id,author_user_id,body,moderation_status) values('${id(63)}','${id(62)}','${other}','EXACT PUBLIC REVIEW REPLY','visible'),('${id(71)}','${id(70)}','${other}','EXACT PRIVATE LEGACY REPLY','visible');
 insert into customer_visit_experiences(id,salon_id,author_user_id,body) values('${id(64)}','${salon}','${other}','EXACT PUBLIC EXPERIENCE');
 insert into visit_experience_replies(id,experience_id,author_user_id,body) values('${id(65)}','${id(64)}','${customer}','EXACT PUBLIC EXPERIENCE REPLY');`);
 const examples=[['comment',id(60),'EXACT PUBLIC COMMENT'],['review',id(62),'EXACT PUBLIC REVIEW'],['review_reply',id(63),'EXACT PUBLIC REVIEW REPLY'],['experience',id(64),'EXACT PUBLIC EXPERIENCE'],['experience_reply',id(65),'EXACT PUBLIC EXPERIENCE REPLY']];
 let requestNo=100;
 for(const [kind,contentId,text] of examples){
  await db.exec("update platform_reports set created_at=now()-interval '2 hours'");await actor(customer);
  const caseId=await rpc('submit_user_support_case',{p_request_id:id(requestNo++),p_category:'review_dispute',p_summary:'Report '+kind,p_message:'Harassment',p_context:{module:'social_content_report',content_type:kind,content_id:contentId,path:`/explore/salons/${salon}#comment-${contentId}`}});
  await actor(moderator);const context=await loadAdminReportContext(caseId);assert.equal(context.socialContent.contentId,contentId);assert(render(context).includes(text));assert(!render(context).includes('href="/explore/salons/'));
  if(kind==='comment'){await db.query('update salon_profile_comments set salon_id=$1 where id=$2',[privateSalon,contentId]);assert.deepEqual(await rpc('get_admin_social_report_evidence',{p_report_id:caseId}),{status:'unavailable'});await db.query('update salon_profile_comments set salon_id=$1 where id=$2',[salon,contentId]);}
 }
 await db.exec("update platform_reports set created_at=now()-interval '2 hours'");await actor(customer);
 const legacy=await submitSocialTextReport(client,{target:{kind:'own_review_reply',id:id(70)},requestId:id(150),reason:'Abusive legacy reply'});
 await actor(moderator);const legacyData=await loadAdminReportContext(legacy.supportHref.split('/').at(-1));assert.equal(legacyData.socialContent.contentId,id(71));assert(render(legacyData).includes('EXACT PRIVATE LEGACY REPLY'));assert(!render(legacyData).includes('PRIVATE LEGACY PARENT'));
 await db.exec("update platform_reports set created_at=now()-interval '2 hours'");await actor(customer);
 const ordinary=await rpc('submit_user_support_case',{p_request_id:id(160),p_category:'booking',p_summary:'Booking question',p_message:'Please check my booking',p_context:{module:'booking',path:'/bookings?booking='+id(161)}});
 await actor(moderator);
 globalThis.__caseTransport=(name,args)=>name==='get_admin_social_report_evidence'?Promise.reject(Error('Optional RPC unavailable')):transport(name,args);
 const ordinaryFailure=await loadAdminReportContext(ordinary);assert.equal(ordinaryFailure.socialContent,null);const ordinaryHtml=render(ordinaryFailure);assert(ordinaryHtml.includes('href="/bookings"'));assert(!ordinaryHtml.includes('Reported text evidence'));
 const socialFailure=await loadAdminReportContext(reportId);assert.equal(socialFailure.socialContent.status,'unavailable');assert(render(socialFailure).includes('Reported text evidence'));assert(!render(socialFailure).includes('href="/more/reviews'));
 globalThis.__caseTransport=(name,args)=>['get_admin_social_report_evidence','get_support_conversation'].includes(name)?Promise.reject(Error('Transport unavailable')):transport(name,args);
 const unknownFailure=await loadAdminReportContext(ordinary);assert.equal(unknownFailure.socialContent,null);assert(render(unknownFailure).includes('href="/bookings"'));assert(!render(unknownFailure).includes('Reported text evidence'));
 const socialUnknownFailure=await loadAdminReportContext(reportId);assert.equal(socialUnknownFailure.socialContent.status,'unavailable');assert(!render(socialUnknownFailure).includes('href="/more/reviews'));
 await db.exec("update platform_reports set created_at=now()-interval '2 hours'");await actor(customer);
 const ordinaryHistory=await rpc('submit_user_support_case',{p_request_id:id(162),p_category:'app_issue',p_summary:'History question',p_message:'Help with history',p_context:{module:'activity',path:'/more/reviews'}});await actor(moderator);
 const ordinaryHistoryFailure=await loadAdminReportContext(ordinaryHistory);assert.equal(ordinaryHistoryFailure.socialContent,null);assert(render(ordinaryHistoryFailure).includes('href="/more/reviews"'));assert(!render(ordinaryHistoryFailure).includes('Reported text evidence'));
 globalThis.__caseTransport=transport;
 await db.query("update platform_reports set support_context=support_context||jsonb_build_object('content_type','experience_reply','content_id',$2::text) where id=$1",[reportId,reply]);
 assert.deepEqual(await rpc('get_admin_social_report_evidence',{p_report_id:reportId}),{status:'unavailable'},'public-kind forgery cannot reveal a private salon reply');
 await db.query("update platform_reports set support_context=support_context||jsonb_build_object('content_type','own_experience_reply','content_id',$2::text) where id=$1",[reportId,experience]);
 await db.query("update platform_reports set support_context=jsonb_set(support_context,'{content_id}',to_jsonb($1::text)) where id=$2",[otherExperience,reportId]);
 assert.deepEqual(await rpc('get_admin_social_report_evidence',{p_report_id:reportId}),{status:'unavailable'});
 await db.query("update platform_reports set support_context=jsonb_set(support_context,'{content_id}',to_jsonb($1::text)),created_by_user_id=$2 where id=$3",[experience,other,reportId]);
 assert.deepEqual(await rpc('get_admin_social_report_evidence',{p_report_id:reportId}),{status:'unavailable'},'an admin-created case cannot forge customer consent for private history');
 await db.query("select set_config('test.revoked','yes',false)");await assert.rejects(rpc('get_admin_social_report_evidence',{p_report_id:reportId}),/permission denied/i);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select get_admin_social_report_evidence($1)',[reportId]),/permission denied/i);
 }finally{delete globalThis.__caseTransport;await db.close();}
});
