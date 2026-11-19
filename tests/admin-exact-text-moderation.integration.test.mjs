import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';
import {functionSql} from './helpers/tax-erasure-fixture.mjs';

const migration='supabase/migrations/20261118230000_admin_exact_text_moderation.sql';
const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1),B=id(2),M=id(3),OUT=id(4),S=id(10),PRIVATE=id(11),POST=id(20);
const q=async(db,sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(db,sql,args=[])=>(await q(db,sql,args))[0];
async function fixture(){
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;
   -- Synthetic digest only for reduced state-machine tests. The full isolated
   -- migration replay below uses actual pgcrypto SHA256 and actual public RPCs.
   create function extensions.digest(text,text) returns bytea language sql immutable as $$select decode(md5($1)||md5($1),'hex')$$;
   create table users(id uuid primary key,status text,display_name text);
   create table locations(id uuid primary key,is_public boolean);
   create table salon_settings(salon_id uuid);
   create table beauty_profiles(id uuid primary key,visibility text);
   create table beauty_posts(id uuid primary key,profile_id uuid,author_user_id uuid,visibility text,deleted_at timestamptz,safety_hold boolean);
   create table salon_profile_looks(id uuid primary key,salon_id uuid,status text,safety_hold boolean);
   create table salon_profile_updates(like salon_profile_looks including all);
   create table salon_profile_comments(id uuid primary key,salon_id uuid,look_id uuid,update_id uuid,beauty_post_id uuid,parent_comment_id uuid,root_comment_id uuid,author_user_id uuid,status text,body text,updated_at timestamptz default now());
   create table salon_profile_reviews(id uuid primary key,salon_id uuid,author_user_id uuid,body text,moderation_status text,updated_at timestamptz default now());
   create table salon_profile_review_replies(id uuid primary key,review_id uuid,author_user_id uuid,body text,moderation_status text,created_at timestamptz default now());
   create table customer_visit_experiences(id uuid primary key,salon_id uuid,author_user_id uuid,feedback_state text,body text,issue_status text,counts_toward_reputation boolean,updated_at timestamptz default now());
   create table visit_experience_replies(id uuid primary key,experience_id uuid,author_user_id uuid,body text,created_at timestamptz default now());
   create table platform_reports(id uuid primary key,source text,reporter_user_id uuid,created_by_user_id uuid,support_context jsonb,status text default 'new');
   create table user_blocks(blocker_user_id uuid,blocked_user_id uuid);
   create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
   create function platform_admin_has_permission(p text) returns boolean language sql stable as $$select current_public_user_id()='${M}' and (p<>'admin.reports.update' or coalesce(current_setting('test.readonly',true),'')<>'yes')$$;
   create function platform_admin_require_permission(p text) returns void language plpgsql as $$begin if not platform_admin_has_permission(p) then raise exception 'Permission denied.' using errcode='42501';end if;end$$;
   create function get_platform_admin_report_detail(p uuid) returns jsonb language plpgsql as $$begin perform platform_admin_require_permission('admin.reports.read');if not exists(select 1 from platform_reports where id=p) then raise exception 'Report not found.';end if;return '{}'::jsonb;end$$;
   create function salon_profile_public_salon_exists(p uuid) returns boolean language sql stable security definer as $$select exists(select 1 from locations where id=p and is_public)$$;
   create function social_users_blocked(a uuid,b uuid) returns boolean language sql stable security definer as $$select exists(select 1 from user_blocks where(blocker_user_id=a and blocked_user_id=b)or(blocker_user_id=b and blocked_user_id=a))$$;
   create function user_has_salon_permission(uuid,text[]) returns boolean language sql stable as $$select false$$;
   create function post_comment_target_is_public(l uuid,u uuid,b uuid,s uuid) returns boolean language sql stable security definer as $$select case when b is not null then exists(select 1 from beauty_posts p join beauty_profiles bp on bp.id=p.profile_id where p.id=b and p.visibility='public' and p.deleted_at is null and not p.safety_hold and bp.visibility='public') else salon_profile_public_salon_exists(s) end$$;
   insert into users values('${A}','active','Author'),('${B}','active','Reply author'),('${M}','active','Reviewer'),('${OUT}','active','Outsider');
   insert into locations values('${S}',true),('${PRIVATE}',false);
   insert into beauty_profiles values('${POST}','public');insert into beauty_posts values('${POST}','${POST}','${A}','public',null,false);
  `);
  await db.exec(functionSql(fs.readFileSync('supabase/migrations/20261109223000_social_report_evidence.sql','utf8'),'get_admin_social_report_evidence'));
  // The reduced fixture exercises the exact ledger/resolver/action functions;
  // typed compiled public-routing assertions are tested only on the full schema.
  await db.exec(fs.readFileSync(migration,'utf8').replace(/do \$route\$[\s\S]*?end \$route\$;/,'').replace(/create or replace function public\.get_public_salon_profile_review_summary\([\s\S]*?\$\$;/,''));
  await db.query("select set_config('test.actor',$1,false)",[M]);
  return db;
 }catch(e){await db.close();throw e;}
}
async function makeText(db,kind,n=100,salon=S){
 const target=id(n),parent=id(n+1000);
 if(kind==='comment')await db.query("insert into salon_profile_comments(id,beauty_post_id,author_user_id,status,body) values($1,$2,$3,'published','Exact comment')",[target,POST,A]);
 else if(kind==='review')await db.query("insert into salon_profile_reviews(id,salon_id,author_user_id,body,moderation_status) values($1,$2,$3,'Exact review','visible')",[target,salon,A]);
 else if(kind==='experience')await db.query("insert into customer_visit_experiences(id,salon_id,author_user_id,body,feedback_state,issue_status,counts_toward_reputation) values($1,$2,$3,'Exact experience','issue','open',true)",[target,salon,A]);
 else if(kind==='review_reply'){
  await db.query("insert into salon_profile_reviews(id,salon_id,author_user_id,body,moderation_status) values($1,$2,$3,'Parent review','visible')",[parent,salon,A]);
  await db.query("insert into salon_profile_review_replies(id,review_id,author_user_id,body,moderation_status) values($1,$2,$3,'Exact review reply','visible')",[target,parent,B]);
 }else{
  await db.query("insert into customer_visit_experiences(id,salon_id,author_user_id,body,feedback_state,issue_status,counts_toward_reputation) values($1,$2,$3,'Parent experience','issue','open',true)",[parent,salon,A]);
  await db.query("insert into visit_experience_replies(id,experience_id,author_user_id,body) values($1,$2,$3,'Exact experience reply')",[target,parent,B]);
 }
 return {kind,target,parent,salon};
}
async function report(db,text,{alias=text.kind,reporter=A,target=text.target}={}){
 const rid=crypto.randomUUID();await db.query("insert into platform_reports(id,source,reporter_user_id,created_by_user_id,support_context) values($1,'user_support',$2,$2,$3)",[rid,reporter,JSON.stringify({module:'social_content_report',content_type:alias,content_id:target})]);return rid;
}
const state=async(db,rid)=>(await one(db,'select get_admin_exact_text_moderation($1) s',[rid])).s;
const act=async(db,rid,s,action='hide',request=crypto.randomUUID(),reason='Exact violation confirmed')=>(await one(db,'select set_admin_exact_text_visibility($1,$2,$3,$4,$5) r',[rid,request,s.evidenceVersion,action,reason])).r;

test('actual server binding forwards only case-bound immutable input and returns safe permission/unknown outcomes',async()=>{
 const built=await build({entryPoints:['lib/platform-admin/exact-text-moderation.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'no-runtime-provider',setup(api){
  api.onResolve({filter:/^(server-only|@\/lib\/supabase\/server)$/},a=>({path:a.path,namespace:'fixture'}));
  api.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='server-only'?'':'export const createAuthenticatedSupabaseServerClient=async()=>globalThis.__exactTextClient;'}));
 }}]});
 const helper=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const input=Object.freeze({reportId:id(800),requestId:id(801),expectedVersion:'a'.repeat(64),action:'hide',reason:'  Confirmed exact text  '});
 const calls=[];globalThis.__exactTextClient={async rpc(name,args){calls.push({name,args});return {data:{ok:true,state:helper.unavailableExactTextModeration()},error:null};}};
 try{
  assert.equal((await helper.setExactTextVisibility({...input,reason:'x'})).code,'conflict');assert.equal(calls.length,0);
  assert.equal((await helper.setExactTextVisibility(input)).ok,true);
  assert.deepEqual(calls[0],{name:'set_admin_exact_text_visibility',args:{p_report_id:input.reportId,p_request_id:input.requestId,p_expected_version:input.expectedVersion,p_action:'hide',p_reason:'Confirmed exact text'}});
  globalThis.__exactTextClient.rpc=async()=>({error:{code:'42501',message:'private implementation detail'}});
  assert.equal((await helper.setExactTextVisibility(input)).code,'permission');
  globalThis.__exactTextClient.rpc=async()=>{throw Error('private implementation detail');};
  const unknown=await helper.setExactTextVisibility(input);assert.equal(unknown.code,'unknown');assert.ok(!unknown.message.includes('private implementation detail'));
  assert.equal(input.reason,'  Confirmed exact text  ');assert.equal(input.requestId,id(801));
 }finally{delete globalThis.__exactTextClient;}
});

test('all five exact targets hide through independent overlay and immediately return current immutable history without mutating business facts',async()=>{
 const db=await fixture();try{
  for(const [i,kind]of ['comment','review','experience','review_reply','experience_reply'].entries()){
   const t=await makeText(db,kind,100+i),rid=await report(db,t),before=await state(db,rid);
   assert.equal(before.canHide,true);assert.equal(before.canRestore,false);
   const result=await act(db,rid,before);assert.equal(result.ok,true);assert.equal(result.state.moderationStatus,'hidden');assert.equal(result.state.revision,1);assert.equal(result.state.history.length,1);assert.equal(result.state.canRestore,true);
   assert.equal((await one(db,'select exact_text_public($1,$2) visible',[kind,t.target])).visible,false);
   const restored=await act(db,rid,result.state,'restore');assert.equal(restored.ok,true);assert.equal(restored.state.moderationStatus,'visible');assert.equal(restored.state.history.length,2);
  }
  assert.deepEqual(await one(db,'select feedback_state,issue_status,counts_toward_reputation,body from customer_visit_experiences where id=$1',[id(102)]),{feedback_state:'issue',issue_status:'open',counts_toward_reputation:true,body:'Exact experience'});
  await assert.rejects(db.exec("update admin_text_decisions set reason='Rewrite history'"),/immutable/);
 }finally{await db.close();}
});

test('stale evidence, edited text, stable same-UUID replay, conflicting reuse and changed permissions cannot duplicate or bypass decisions',async()=>{
 const db=await fixture();try{
  const t=await makeText(db,'review'),rid=await report(db,t),s=await state(db,rid),request=crypto.randomUUID();
  await db.query("update salon_profile_reviews set body='Edited before decision' where id=$1",[t.target]);
  assert.equal((await act(db,rid,s)).code,'stale');const current=await state(db,rid);
  const hidden=await act(db,rid,current,'hide',request);assert.equal(hidden.ok,true);
  assert.equal((await act(db,rid,current,'hide',request)).ok,true,'receipt replay precedes current-version check');
  assert.equal((await act(db,rid,current,'hide',request,'Different reason')).code,'conflict');
  assert.equal((await one(db,'select count(*)::int n from admin_text_decisions')).n,1);
  await db.exec("set test.readonly='yes'");await assert.rejects(act(db,rid,current,'hide',request),/Permission denied/);
  assert.equal((await state(db,rid)).canRestore,false);
 }finally{await db.close();}
});

test('multiple case holds release independently and Support close/reopen never changes public visibility',async()=>{
 const db=await fixture();try{
  const t=await makeText(db,'comment'),r1=await report(db,t),r2=await report(db,t);
  const s1=await state(db,r1);await state(db,r2);await act(db,r1,s1);
  const second=await state(db,r2);assert.equal(second.canHide,true);await act(db,r2,second);
  await db.query("update platform_reports set status='closed' where id=any($1::uuid[])",[[r1,r2]]);
  const current=await state(db,r1);assert.equal(current.otherHoldCount,1);assert.equal(current.canRestore,true);
  const release=await act(db,r1,current,'restore');assert.equal(release.state.moderationStatus,'hidden');assert.equal(release.state.heldByThisCase,false);assert.equal(release.state.otherHoldCount,1);
  await db.query("update platform_reports set status='new' where id=$1",[r1]);assert.equal((await state(db,r1)).moderationStatus,'hidden');
  const last=await state(db,r2);assert.equal((await act(db,r2,last,'restore')).state.moderationStatus,'visible');
 }finally{await db.close();}
});

test('forged public/private contexts, mismatched private-history parent and new hidden-ID contexts never reveal arbitrary text',async()=>{
 const db=await fixture();try{
  const privateReply=await makeText(db,'experience_reply',120,PRIVATE);
  assert.equal((await state(db,await report(db,privateReply))).body,null);
  const own=await state(db,await report(db,privateReply,{alias:'own_experience_reply',target:privateReply.parent}));
  assert.equal(own.body,'Exact experience reply');assert.equal(own.canHide,false);assert.equal(own.canRestore,false);
  assert.equal((await state(db,await report(db,privateReply,{alias:'own_experience_reply',target:privateReply.parent,reporter:OUT}))).body,null);
  const t=await makeText(db,'comment',121),r=await report(db,t);await act(db,r,await state(db,r));
  const forged=await state(db,await report(db,t));assert.equal(forged.status,'unavailable');assert.equal(forged.body,null);assert.equal(forged.availabilityVerified,true);
  assert.equal((await one(db,'select exact_text_public($1,$2) visible',['experience_reply',crypto.randomUUID()])).visible,true,'private/missing replies are not a new existence oracle');
 }finally{await db.close();}
});

test('withdrawal, held parent, native comment ancestry, source author edits and ancestor holds retain restrictions',async()=>{
 const db=await fixture();try{
  const t=await makeText(db,'comment'),r=await report(db,t);const hidden=await act(db,r,await state(db,r));
  await db.query('update beauty_posts set safety_hold=true where id=$1',[POST]);const parentHeld=await state(db,r);assert.equal(parentHeld.canRestore,false);assert.equal((await act(db,r,parentHeld,'restore')).ok,false);
  await db.query('update beauty_posts set safety_hold=false where id=$1',[POST]);await db.query("update salon_profile_comments set body='Edited while held' where id=$1",[t.target]);
  assert.equal((await act(db,r,hidden.state,'restore')).code,'stale');assert.equal((await state(db,r)).moderationStatus,'hidden');
  await db.query("update salon_profile_comments set status='deleted' where id=$1",[t.target]);const gone=await state(db,r);assert.equal(gone.body,null);assert.equal(gone.canRestore,false);assert.equal(gone.history.length,1);
  const root=await makeText(db,'comment',130),child=await makeText(db,'comment',131);await db.query('update salon_profile_comments set parent_comment_id=$1,root_comment_id=$1 where id=$2',[root.target,child.target]);
  const childCase=await report(db,child);await state(db,childCase);const rootCase=await report(db,root);await act(db,rootCase,await state(db,rootCase));
  assert.equal((await one(db,'select exact_text_public($1,$2) visible',['comment',child.target])).visible,false);assert.equal((await state(db,childCase)).canHide,false);
 }finally{await db.close();}
});

test('compiled exact-text projection and direct-read inventory',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async()=>{
 let f;
 const images=JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{"db":"public.ecr.aws/supabase/postgres:17.11.0.006","auth":"public.ecr.aws/supabase/gotrue:v2.197.0","storage":"public.ecr.aws/supabase/storage-api:v1.84.19","rest":"public.ecr.aws/supabase/postgrest:v16.5"}');
 try{
  f=await startIsolatedSupabase('admin-exact-text',images,{allowConcurrentFixtureCleanup:true});
  const functions=f.json(`select coalesce(json_agg(r order by name,signature),'[]') from (
   select p.proname name,p.oid::regprocedure::text signature,p.provolatile volatility,p.prosecdef security_definer,
    has_function_privilege('anon',p.oid,'execute') anon_execute,has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
    pg_get_functiondef(p.oid) definition
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
    and p.prosrc ~* '(salon_profile_comments|salon_profile_reviews|salon_profile_review_replies|customer_visit_experiences|visit_experience_replies)'
  ) r`);
  const policies=f.json(`select coalesce(json_agg(r),'[]') from (select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where tablename in('salon_profile_comments','salon_profile_reviews','salon_profile_review_replies','customer_visit_experiences','visit_experience_replies')) r`);
  const grants=f.json(`select coalesce(json_agg(r),'[]') from(select grantee,table_schema,table_name,privilege_type from information_schema.role_table_grants where grantee in('anon','authenticated','service_role') and (table_schema='moderation_public' or table_name in('salon_profile_comments','salon_profile_reviews','salon_profile_review_replies','customer_visit_experiences','visit_experience_replies','admin_text_case_bindings','admin_text_case_holds','admin_text_decisions')))r`);
  const routed=['count_public_post_comments','get_post_comment_identities','get_public_post_comments','get_public_salon_profile_comments_before_blocks','get_public_salon_profile_experiences_before_blocks','get_public_salon_profile_reviews_before_blocks','get_public_salon_profile_review_summary','get_public_salon_website_featured_look','hydrate_explore_social_feed_items_before_blocks','_explore_core_get_public_explore_decision_signals'];
  for(const name of routed)assert.ok(functions.find(r=>r.name===name)?.definition.includes('moderation_public.'),name+' did not route');
  const canonical=['_explore_core_get_public_lumi_trust_signals','get_public_salon_profile_reputation_summary'];
  for(const name of canonical){
   const fn=functions.find(r=>r.name===name);assert.ok(fn);assert.ok(!fn.definition.includes('moderation_public.'));
   const result=f.sql(`select pg_get_function_result('${fn.signature}'::regprocedure)`);assert.ok(!/\b(body|reply_id|reply_body|content_id)\b/i.test(result),name+' exposes text/target IDs');
  }
  assert.ok(!grants.some(r=>r.table_schema==='moderation_public'||r.table_name.startsWith('admin_text_')),'private views/ledgers leaked direct grants');
  assert.equal(policies.filter(r=>r.policyname==='platform_exact_text_visibility').length,5);
  f.save('compiled-social-read-inventory.json',{functions,policies,grants,coverage:{routed,canonicalNumericOnly:canonical,privateHistoryPreserved:['get_my_visit_experiences','customer_visit_verified_visit_payload']},migrations:f.evidence.migrationHashes});
  assert.ok(functions.length>0);

  const author=f.person('exact-author'),replyAuthor=f.person('exact-reply'),viewer=f.person('exact-viewer'),reader=f.person('exact-reader'),reviewer=f.person('exact-reviewer');
  const service=`set request.jwt.claims='{"role":"service_role"}';`;
  f.sql(`update auth.users set phone='15550001851',phone_confirmed_at=now() where id='${author.authId}';update auth.users set phone='15550001852',phone_confirmed_at=now() where id='${replyAuthor.authId}';update abuse_system_settings set require_signed_context=false where id;
   insert into platform_admin_roles(slug,name) values('exact-fixture-reader','Fixture reader'),('exact-fixture-reviewer','Fixture reviewer');
   insert into platform_admin_role_permissions(role_id,permission_id) select r.id,p.id from platform_admin_roles r cross join platform_admin_permissions p where r.slug in('exact-fixture-reader','exact-fixture-reviewer') and(p.code in('admin.access','admin.reports.read')or(r.slug='exact-fixture-reviewer'and p.code='admin.reports.update'));
   insert into platform_admin_memberships(user_id,role_id) select '${reader.profileId}',id from platform_admin_roles where slug='exact-fixture-reader';insert into platform_admin_memberships(user_id,role_id) select '${reviewer.profileId}',id from platform_admin_roles where slug='exact-fixture-reviewer';
   insert into beauty_profiles(user_id) values('${author.profileId}') on conflict(user_id) do nothing;`);
  const account=f.rpc(author,'ensure_personal_account_for_current_user',{p_account_name:'Exact text fixture'})[0].account_id;
  const salon=f.rpc(author,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'Exact text fixture',p_owner_is_staff:false,p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
  const post=crypto.randomUUID(),comment=crypto.randomUUID(),review=crypto.randomUUID(),reviewReply=crypto.randomUUID(),experience=crypto.randomUUID(),experienceReply=crypto.randomUUID(),customer=crypto.randomUUID(),ticket=crypto.randomUUID();
  f.sql(`${service}update salon_settings set public_discovery_enabled=true where salon_id='${salon}';
   insert into beauty_posts(id,profile_id,author_user_id,caption,visibility) select '${post}',id,'${author.profileId}','Synthetic exact text parent','public' from beauty_profiles where user_id='${author.profileId}';
   insert into salon_profile_comments(id,beauty_post_id,author_user_id,author_display_name,body,status) values('${comment}','${post}','${author.profileId}','Fixture author','Synthetic exact comment','published');
   insert into salon_profile_reviews(id,salon_id,author_user_id,rating,body) values('${review}','${salon}','${author.profileId}',4,'Synthetic exact review');
   insert into salon_profile_review_replies(id,salon_id,review_id,author_user_id,created_by_user_id,body) values('${reviewReply}','${salon}','${review}','${replyAuthor.profileId}','${replyAuthor.profileId}','Synthetic exact review reply');
   insert into customers(id,location_id,customer_user_id,name) values('${customer}','${salon}','${author.profileId}','Synthetic customer');
   insert into pos_tickets(id,salon_id,customer_id,status,closed_at) values('${ticket}','${salon}','${customer}','closed',now());
   insert into customer_visit_experiences(id,salon_id,ticket_id,customer_id,author_user_id,feedback_state,body,issue_status,counts_toward_reputation) values('${experience}','${salon}','${ticket}','${customer}','${author.profileId}','issue','Synthetic exact experience','open',true);
   insert into visit_experience_replies(id,experience_id,author_user_id,request_id,body) values('${experienceReply}','${experience}','${replyAuthor.profileId}','${crypto.randomUUID()}','Synthetic exact experience reply');`);
  const submit=(kind,target,person=author)=>{
   const rid=f.rpc(person,'submit_user_support_case',{p_request_id:crypto.randomUUID(),p_category:'review_dispute',p_summary:'Synthetic exact text case',p_message:'Synthetic fixture report; no private customer material.',p_context:{path:'/explore',module:'social_content_report',content_type:kind,content_id:target}});
   // Keep the real five-per-hour admission guard intact. These isolated cases
   // represent separate historical reports, rather than flooding one hour.
   f.sql(`update platform_reports set created_at=now()-interval '2 hours' where id='${rid}'`);return rid;
  };
  const load=rid=>f.rpc(reviewer,'get_admin_exact_text_moderation',{p_report_id:rid});
  const decide=(rid,s,action='hide',requestId=crypto.randomUUID(),reason='Synthetic exact-text reason')=>f.rpc(reviewer,'set_admin_exact_text_visibility',{p_report_id:rid,p_request_id:requestId,p_expected_version:s.evidenceVersion,p_action:action,p_reason:reason});
  const publicExperiences=()=>f.rpc(null,'get_public_salon_profile_experiences',{target_salon_id:salon});
  const publicReviews=()=>f.rpc(null,'get_public_salon_profile_reviews',{target_salon_id:salon});
  const businessBefore=f.json(`select json_build_object('experience',(select row_to_json(e) from customer_visit_experiences e where id='${experience}'),'ticket',(select row_to_json(t) from pos_tickets t where id='${ticket}'))`);
  const reputationBefore=f.rpc(null,'get_public_salon_profile_reputation_summary',{target_salon_id:salon});
  for(const [kind,target]of [['comment',comment],['review',review],['review_reply',reviewReply],['experience',experience],['experience_reply',experienceReply]]){
   const rid=submit(kind,target),before=load(rid);assert.equal(before.canHide,true,kind);
   const requestId=crypto.randomUUID(),hidden=decide(rid,before,'hide',requestId);assert.equal(hidden.ok,true,kind);assert.equal(hidden.state.moderationStatus,'hidden');assert.equal(hidden.state.history.length,1);assert.equal(hidden.state.revision,1);
   assert.equal(decide(rid,before,'hide',requestId).ok,true,'same UUID lost-success replay');
   if(kind==='comment'){
    assert.equal(f.rpc(null,'count_public_post_comments',{p_target_type:'beauty_post',p_target_id:post}),0);
    assert.deepEqual(f.rpc(null,'get_public_post_comments',{p_target_type:'beauty_post',p_target_id:post}),[]);
    assert.deepEqual(f.rest(viewer,`/salon_profile_comments?id=eq.${target}&select=id,body`),[]);
    assert.deepEqual(f.rpc(null,'get_post_comment_identities',{p_comment_ids:[target]}),[]);
   }else if(kind==='review'){assert.ok(!publicReviews().some(r=>r.id===target));assert.ok(!publicExperiences().some(r=>r.id===target));assert.equal(f.rpc(null,'get_public_salon_profile_review_summary',{target_salon_id:salon})[0].review_count,0);}
   else if(kind==='experience'){
    assert.ok(!publicExperiences().some(r=>r.id===target));
    assert.ok(f.rpc(author,'get_my_visit_experiences',{p_limit:11,p_offset:0,p_experience:target}).some(r=>r.id===target&&r.body==='Synthetic exact experience'),'private own-history retained');
   }else{
    const parent=kind==='review_reply'?review:experience;
    const row=(kind==='review_reply'?publicReviews():publicExperiences()).find(r=>r.id===parent);assert.ok(row);assert.equal(row.reply_id,null);assert.equal(row.reply_body,null);assert.equal(row.reply_created_at,null);
   }
   assert.deepEqual(f.rpc(null,'get_public_salon_profile_reputation_summary',{target_salon_id:salon}),reputationBefore,'canonical reputation facts stay independent of public-item visibility');
   const restored=decide(rid,hidden.state,'restore');assert.equal(restored.ok,true);assert.equal(restored.state.moderationStatus,'visible');assert.equal(restored.state.history.length,2);
  }
  assert.deepEqual(f.json(`select json_build_object('experience',(select row_to_json(e) from customer_visit_experiences e where id='${experience}'),'ticket',(select row_to_json(t) from pos_tickets t where id='${ticket}'))`),businessBefore);
  for(const nativeStatus of ['hidden','withdrawn']){
   f.sql(`update salon_profile_reviews set moderation_status='${nativeStatus}' where id='${review}'`);
   assert.equal(f.rpc(null,'get_public_salon_profile_review_summary',{target_salon_id:salon})[0].review_count,0);
  }
  f.sql(`update salon_profile_reviews set moderation_status='visible' where id='${review}'`);
  f.rpc(viewer,'set_user_block',{p_user_id:author.profileId,p_blocked:true});
  assert.equal(f.rpc(viewer,'get_public_salon_profile_review_summary',{target_salon_id:salon})[0].review_count,0);
  f.rpc(viewer,'set_user_block',{p_user_id:author.profileId,p_blocked:false});
  f.sql(`update users set status='suspended' where id='${author.profileId}'`);
  const nativeSuspended=f.rest(null,`/salon_profile_reviews?id=eq.${review}&select=id`).length;
  assert.equal(f.rpc(null,'get_public_salon_profile_review_summary',{target_salon_id:salon})[0].review_count,nativeSuspended,'do not invent a new suspended-author rule absent from native RLS');
  f.sql(`update users set status='active' where id='${author.profileId}'`);

  const r1=submit('comment',comment),r2=submit('comment',comment);const s1=load(r1);load(r2);
  assert.equal(decide(r1,s1).ok,true);const second=load(r2);assert.equal(second.canHide,true);assert.equal(decide(r2,second).ok,true);
  const current=load(r1);assert.equal(current.otherHoldCount,1);const released=decide(r1,current,'restore');assert.equal(released.state.moderationStatus,'hidden');assert.equal(released.state.otherHoldCount,1);
  const forged=submit('comment',comment);assert.equal(load(forged).body,null,'unbound hidden-ID context does not authorize a quote');
  assert.equal(decide(r2,load(r2),'restore').ok,true);
  const privateCase=submit('own_experience_reply',experience);f.sql(`update salon_settings set public_discovery_enabled=false where salon_id='${salon}'`);
  const privateEvidence=load(privateCase);assert.equal(privateEvidence.body,'Synthetic exact experience reply');assert.equal(privateEvidence.canHide,false);assert.equal(privateEvidence.canRestore,false);
  assert.equal(load(submit('experience_reply',experienceReply)).body,null);
  assert.equal(load(submit('own_experience_reply',experience,viewer)).body,null);
  f.sql(`update salon_settings set public_discovery_enabled=true where salon_id='${salon}'`);
  for(const person of [null,viewer,reader])assert.ok(f.http(3000,'/rpc/set_admin_exact_text_visibility','POST',{p_report_id:r1,p_request_id:crypto.randomUUID(),p_expected_version:load(r1).evidenceVersion,p_action:'hide',p_reason:'Unauthorized fixture request'},person?.token).status>=400);
  assert.ok(f.http(3000,'/admin_text_decisions?select=*','GET',undefined,viewer.token).status>=400);
  assert.ok(f.http(3000,'/rpc/admin_text_source','POST',{kind:'comment',target:comment},viewer.token).status>=400);

  const docker=process.env.TEST_DOCKER_PATH||'C:/Program Files/Docker/Docker/resources/bin/docker.exe',context=process.env.TEST_DOCKER_CONTEXT||'desktop-linux';
  const args=['--context',context,'exec','-i',f.evidence.containers.db];
  function concurrent(sql){
   const child=cp.spawn(docker,[...args,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-At'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let error='';child.stderr.on('data',v=>error+=v);child.stdout.resume();child.stdin.end(sql);return new Promise((resolve,reject)=>child.on('exit',code=>code===0?resolve():reject(Error(f.redact(error)))));
  }
  async function marker(n){for(let i=0;i<40;i++){if(f.sql(`select exists(select 1 from pg_locks where locktype='advisory' and objid=${n} and granted)`)==='t')return;await new Promise(r=>setTimeout(r,30));}throw Error('Concurrent fixture did not reach lock checkpoint');}
  const raceCase=submit('comment',comment),old=load(raceCase),raceRequest=crypto.randomUUID();assert.equal(old.canHide,true,JSON.stringify({status:old.status,reason:old.blockedReason,own:old.heldByThisCase,others:old.otherHoldCount}));
  const parentLock=concurrent(`begin;${service}update beauty_posts set safety_hold=true where id='${post}';select pg_advisory_xact_lock(901101);select pg_sleep(3);commit;`);
  await marker(901101);const concurrentParent=decide(raceCase,old,'hide',raceRequest);await parentLock;
  assert.equal(concurrentParent.code,'unknown',JSON.stringify(concurrentParent));
  const afterParent=decide(raceCase,old,'hide',raceRequest);assert.equal(afterParent.code,'unavailable');assert.equal(afterParent.state.body,null);
  // Keep the first parent restriction intact. A separate fresh public scope is
  // required for the author-edit race; test setup must not force-clear a hold.
  const editPost=crypto.randomUUID(),editComment=crypto.randomUUID();
  f.sql(`${service}insert into beauty_posts(id,profile_id,author_user_id,caption,visibility) select '${editPost}',id,'${author.profileId}','Independent synthetic revision scope','public' from beauty_profiles where user_id='${author.profileId}';insert into salon_profile_comments(id,beauty_post_id,author_user_id,author_display_name,body,status) values('${editComment}','${editPost}','${author.profileId}','Fixture author','Independent exact text','published');`);
  const editCase=submit('comment',editComment),beforeEdit=load(editCase),editRequest=crypto.randomUUID();assert.equal(beforeEdit.canHide,true,JSON.stringify({status:beforeEdit.status,reason:beforeEdit.blockedReason}));assert.match(beforeEdit.evidenceVersion,/^[a-f0-9]{64}$/);
  const editLock=concurrent(`begin;${service}update salon_profile_comments set body='Synthetic concurrent revision' where id='${editComment}';select pg_advisory_xact_lock(901102);select pg_sleep(3);commit;`);
  await marker(901102);const concurrentEdit=decide(editCase,beforeEdit,'hide',editRequest);await editLock;assert.equal(concurrentEdit.code,'unknown',JSON.stringify(concurrentEdit));
  assert.equal(decide(editCase,beforeEdit,'hide',editRequest).code,'stale');assert.equal(load(editCase).moderationStatus,'visible');
  const final=f.evidence.migrationHashes.find(r=>r.file===migration.split('/').at(-1));assert.equal(final.sha256,crypto.createHash('sha256').update(fs.readFileSync(migration)).digest('hex'),'Migration changed after replay');
  f.save('admin-exact-text-acceptance.json',{passed:true,syntheticOnly:true,providerCalls:false,migrationCount:f.evidence.migrationHashes.length,migration:final,checks:['all5 targets current-return state/history','sameUUID replay before version check','anonymous public projections/counts and null reply envelope','direct outsider RLS denial','private own-history preserved','canonical business/reputation rows unchanged','multi-case independent hold release','forged/private/history contexts denied','read-only/nonadmin action denied','parent/privacy and author-edit concurrency returns unconfirmed then revalidates']});
 }catch(error){if(f)f.save('admin-exact-text-acceptance.json',{passed:false,error:f.redact(error.message)});throw error;
 }finally{if(f)f.close();}
});
