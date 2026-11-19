import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

const migration='supabase/migrations/20261118210000_moderation_operations.sql';
const blockSource='supabase/migrations/202610140002_user_blocking.sql';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1),B=id(2),C=id(3),S=id(4);
function definition(file,name){
 const source=fs.readFileSync(file,'utf8');
 const start=source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`,'i'));
 assert.ok(start>=0,`Missing actual source definition ${name}`);
 const end=source.indexOf('$$;',start);assert.ok(end>start);
 return source.slice(start,end+3);
}
function policy(name){
 const source=fs.readFileSync('supabase/migrations/202608280001_unified_post_comments.sql','utf8');
 const start=source.indexOf(`create policy "${name}"`);assert.ok(start>=0);
 return source.slice(start,source.indexOf(';',start)+1);
}
async function fixture(){
 const db=new PGlite();
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const one=async(sql,args=[])=>(await q(sql,args))[0];
 const actor=async(uid,role='authenticated')=>db.exec(`reset role;set test.uid='${uid}';set role ${role};`);
 await db.exec(`
  create role anon;create role authenticated;create role service_role;
  create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  create table users(id uuid primary key,status text not null default 'active',display_name text);
  create table beauty_profiles(id uuid primary key,user_id uuid,visibility text default 'public');
  create table beauty_posts(id uuid primary key,profile_id uuid,author_user_id uuid,visibility text default 'public',moderation_status text default 'visible',deleted_at timestamptz,safety_hold boolean not null default false);
  create table locations(id uuid primary key,is_public boolean not null default true);
  create function salon_profile_public_salon_exists(uuid) returns boolean language sql stable security definer as $$select exists(select 1 from locations where id=$1 and is_public)$$;
  create table salon_profile_looks(id uuid primary key,salon_id uuid,author_user_id uuid,created_by_user_id uuid,status text default 'published',safety_hold boolean not null default false);
  create table salon_profile_updates(like salon_profile_looks including all);
  create table salon_profile_comments(id uuid primary key,salon_id uuid,look_id uuid,update_id uuid,beauty_post_id uuid,parent_comment_id uuid,root_comment_id uuid,reply_depth integer default 0,author_user_id uuid,author_display_name text,body text,is_salon_reply boolean default false,created_at timestamptz default now(),updated_at timestamptz default now(),edited_at timestamptz,status text default 'published');
  create table beauty_profile_follows(profile_id uuid,user_id uuid);
  create table app_notifications(recipient_user_id uuid,event_key text);
  create table user_blocks(blocker_user_id uuid references users(id),blocked_user_id uuid references users(id),created_at timestamptz default now(),primary key(blocker_user_id,blocked_user_id),check(blocker_user_id<>blocked_user_id));
  create table canonical_business_records(id uuid primary key,amount numeric,member_role text);
  create function user_has_salon_permission(uuid,text[]) returns boolean language sql stable as $$select false$$;
  insert into users(id,display_name) values('${A}','Author'),('${B}','Viewer'),('${C}','Other');
  insert into beauty_profiles(id,user_id) select id,id from users;
  insert into locations values('${S}',true);
  insert into beauty_posts(id,profile_id,author_user_id) values('${A}','${A}','${A}');
  insert into salon_profile_looks(id,salon_id,author_user_id) values('${A}','${S}','${A}');
  insert into salon_profile_updates(id,salon_id,author_user_id) values('${A}','${S}','${A}');
  insert into salon_profile_comments(id,beauty_post_id,author_user_id,body) values('${id(20)}','${A}','${C}','Beauty comment');
  insert into salon_profile_comments(id,salon_id,look_id,author_user_id,body) values('${id(21)}','${S}','${A}','${C}','Look comment');
  insert into salon_profile_comments(id,salon_id,update_id,author_user_id,body) values('${id(22)}','${S}','${A}','${C}','Update comment');
  insert into beauty_profile_follows values('${A}','${B}'),('${B}','${A}');
  insert into app_notifications values('${B}','post_comment_created:${id(20)}:${B}');
  insert into canonical_business_records values('${S}',123.45,'owner');
  grant usage on schema public to anon,authenticated;
  grant select,insert on salon_profile_comments to anon,authenticated;
  alter table salon_profile_comments enable row level security;
  alter table user_blocks enable row level security;
 `);
 await db.exec(definition('supabase/migrations/202608100005_beauty_profile_social_timeline.sql','beauty_public_post_exists'));
 for(const name of ['social_users_blocked','social_user_is_blocked','social_post_author','set_user_block','post_user_block','get_my_blocked_users','post_comment_target_is_public','count_public_post_comments','get_public_post_comments']) await db.exec(definition(blockSource,name));
 await db.exec(policy('public_read_visible_comments')+policy('authenticated_create_own_comments'));
 await db.exec(`revoke all on function social_users_blocked(uuid,uuid),social_post_author(text,uuid) from public,anon,authenticated;
  revoke all on function set_user_block(uuid,boolean),get_my_blocked_users() from public,anon;
  grant execute on function set_user_block(uuid,boolean),get_my_blocked_users() to authenticated;`);
 return {db,q,one,actor};
}

test('actual SQL reproduces held-parent comment leak then denies RPC/count/RLS/inserts for all three surfaces',async()=>{
 const {db,q,one,actor}=await fixture();
 try{
  await db.exec(`update beauty_posts set safety_hold=true;update salon_profile_looks set safety_hold=true;update salon_profile_updates set safety_hold=true;`);
  await actor(B);
  assert.equal((await q('select * from salon_profile_comments')).length,3,'baseline direct RLS leaks held parents');
  for(const type of ['beauty_post','salon_profile_look','salon_profile_update'])assert.equal((await one('select count_public_post_comments($1,$2) n',[type,A])).n,1);
  await db.exec('reset role;'+fs.readFileSync(migration,'utf8'));
  for(const role of ['anon','authenticated']){
   await actor(role==='anon'?'':B,role);
   assert.deepEqual(await q('select * from salon_profile_comments'),[]);
   for(const type of ['beauty_post','salon_profile_look','salon_profile_update']){
    assert.equal((await one('select count_public_post_comments($1,$2) n',[type,A])).n,0);
    assert.deepEqual(await q('select * from get_public_post_comments($1,$2)',[type,A]),[]);
   }
  }
  await actor(B);
  await assert.rejects(q('insert into salon_profile_comments(id,beauty_post_id,author_user_id,body) values($1,$2,$3,$4)',[id(30),A,B,'no leak']),/row-level security/);
  await actor(A);
  assert.equal((await one(`select count_public_post_comments('beauty_post',$1) n`,[A])).n,0,'author access does not turn a held thread public');
  await db.exec('reset role;update beauty_posts set safety_hold=false;update salon_profile_looks set safety_hold=false;update salon_profile_updates set safety_hold=false;');
  await actor(B);
  assert.equal((await q('select * from salon_profile_comments')).length,3,'eligible public content stays available');
  await q('insert into salon_profile_comments(id,beauty_post_id,author_user_id,body) values($1,$2,$3,$4)',[id(30),A,B,'valid comment']);
  assert.equal((await one(`select count_public_post_comments('beauty_post',$1) n`,[A])).n,2);
 }finally{await db.close();}
});

test('private post ID cannot expose its author through block list; own successful public block remains retryable',async()=>{
 const {db,q,one,actor}=await fixture();
 try{
  await db.exec("update beauty_posts set visibility='self'");await actor(B);
  await q(`select post_user_block('beauty_post',$1,true)`,[A]);
  assert.deepEqual((await q('select user_id,display_name from get_my_blocked_users()')),[{user_id:A,display_name:'Author'}],'source baseline reproduces author lookup');
  await q('select set_user_block($1,false)',[A]);
  await db.exec('reset role;'+fs.readFileSync(migration,'utf8'));await actor(B);
  assert.deepEqual((await one(`select post_user_block('beauty_post',$1,false) r`,[A])).r,{canBlock:false,blocked:false});
  await assert.rejects(q(`select post_user_block('beauty_post',$1,true)`,[A]),/Post is unavailable/);
  assert.deepEqual(await q('select * from get_my_blocked_users()'),[]);
  await db.exec("reset role;update beauty_posts set visibility='public'");await actor(B);
  assert.deepEqual((await one(`select post_user_block('beauty_post',$1,true) r`,[A])).r,{canBlock:true,blocked:true});
  assert.deepEqual((await one(`select post_user_block('beauty_post',$1,true) r`,[A])).r,{canBlock:true,blocked:true});
  assert.equal((await q('select * from get_my_blocked_users()')).length,1);
  assert.equal((await one(`select count_public_post_comments('beauty_post',$1) n`,[A])).n,0);
  await assert.rejects(q('select social_post_author($1,$2)',['beauty_post',A]),/permission denied/);
  await assert.rejects(q('select * from user_blocks'),/permission denied/);
  await actor(A);
  assert.deepEqual((await one(`select post_user_block('beauty_post',$1,false) r`,[B])).r,{canBlock:false,blocked:false});
  await q('select set_user_block($1,false)',[B]); // cannot remove the other person's block
  await actor(B);assert.equal((await q('select * from get_my_blocked_users()')).length,1);
  await q('select set_user_block($1,false)',[A]);
  assert.equal((await one(`select count_public_post_comments('beauty_post',$1) n`,[A])).n,1);
  await db.exec('reset role;');
  assert.deepEqual(await q('select * from canonical_business_records'),[{id:S,amount:'123.45',member_role:'owner'}]);
  assert.equal((await one('select count(*)::int n from beauty_profile_follows')).n,0,'unblock does not resurrect removed social follows');
 }finally{await db.close();}
});

test('unavailable/held/deleted/private profiles and salons never permit block writes, even with a previous own block',async()=>{
 const {db,q,one,actor}=await fixture();
 try{
  await db.exec(fs.readFileSync(migration,'utf8'));
  for(const [type,changes,restore] of [
   ['beauty_post',"update beauty_posts set safety_hold=true","update beauty_posts set safety_hold=false"],
   ['beauty_post',"update beauty_posts set deleted_at=now()","update beauty_posts set deleted_at=null"],
   ['beauty_post',"update beauty_posts set moderation_status='hidden'","update beauty_posts set moderation_status='visible'"],
   ['beauty_post',"update beauty_profiles set visibility='self'","update beauty_profiles set visibility='public'"],
   ['salon_profile_look',"update salon_profile_looks set status='draft'","update salon_profile_looks set status='published'"],
   ['salon_profile_look',"update salon_profile_looks set safety_hold=true","update salon_profile_looks set safety_hold=false"],
   ['salon_profile_update',"update salon_profile_updates set safety_hold=true","update salon_profile_updates set safety_hold=false"],
   ['salon_profile_update',"update locations set is_public=false","update locations set is_public=true"],
  ]){
   await db.exec('reset role;'+changes);await actor(B);
   assert.deepEqual((await one('select post_user_block($1,$2,false) r',[type,A])).r,{canBlock:false,blocked:false});
   await assert.rejects(q('select post_user_block($1,$2,true)',[type,A]),/Post is unavailable/);
   await db.exec('reset role;'+restore);
  }
  await actor(B);await q(`select post_user_block('beauty_post',$1,true)`,[A]);
  await db.exec('reset role;update beauty_posts set safety_hold=true');await actor(B);
  await assert.rejects(q(`select post_user_block('beauty_post',$1,true)`,[A]),/Post is unavailable/);
  await actor(A);await q('select set_user_block($1,true)',[C]);await actor(C);
  await assert.rejects(q(`select post_user_block('salon_profile_look',$1,true)`,[A]),/Post is unavailable/);
  assert.deepEqual(await q('select * from get_my_blocked_users()'),[],'reverse-only block is never converted into a probing own block');
  await db.exec(`reset role;delete from beauty_profiles where id='${A}'`);await actor(B);
  assert.equal((await one('select beauty_public_post_exists($1) n',[A])).n,false);
  await assert.rejects(q(`select post_user_block('beauty_post',$1,true)`,[A]),/Post is unavailable/);
 }finally{await db.close();}
});

test('anonymous/inactive/null/self boundaries, explicit grants and safe search_path remain enforced',async()=>{
 const {db,q,one,actor}=await fixture();
 try{
  await db.exec(fs.readFileSync(migration,'utf8'));
  for(const role of ['anon','authenticated']){
   await actor('',role);
   assert.deepEqual((await one(`select post_user_block('beauty_post',$1,false) r`,[A])).r,{canBlock:false,blocked:false});
   await assert.rejects(q(`select post_user_block('beauty_post',$1,true)`,[A]),/Sign in with an active account/);
  }
  await db.exec(`reset role;update users set status='suspended' where id='${B}'`);await actor(B);
  assert.deepEqual((await one(`select post_user_block('beauty_post',$1,false) r`,[A])).r,{canBlock:false,blocked:false});
  await assert.rejects(q(`select post_user_block('beauty_post',$1,true)`,[A]),/active account/);
  await actor(A);assert.equal((await one(`select post_user_block('beauty_post',$1,false) r`,[A])).r.canBlock,false);
  await assert.rejects(q(`select post_user_block('beauty_post',$1,true)`,[A]),/Invalid block request/);
  for(const args of [[null,A,false],['unknown',A,false],['beauty_post',null,false],['beauty_post',A,null]])await assert.rejects(q('select post_user_block($1,$2,$3)',args),/Invalid block request/);
  await db.exec('reset role');
  const funcs=await q(`select proname,prosecdef,proconfig from pg_proc where proname in ('beauty_public_post_exists','post_comment_target_is_public','post_user_block') order by proname`);
  assert.equal(funcs.length,3);for(const f of funcs){assert.equal(f.prosecdef,true);assert.deepEqual(f.proconfig,['search_path=pg_catalog, public']);}
  const grants=await q(`select proname,has_function_privilege('anon',oid,'execute') a,has_function_privilege('authenticated',oid,'execute') b,coalesce(array_to_string(proacl,','),'') acl from pg_proc where proname in ('beauty_public_post_exists','post_comment_target_is_public','post_user_block')`);
  for(const f of grants){assert.equal(f.a,true);assert.equal(f.b,true);assert.doesNotMatch(f.acl,/(?:^|,)=X/);}
 }finally{await db.close();}
});

test('full current schema: real Auth/RPC/RLS report, block, reviewer takedown and reconsideration authority',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async()=>{
 let f;
 try{
  f=await startIsolatedSupabase('moderation-operations',{
   db:'public.ecr.aws/supabase/postgres:17.11.0.006',auth:'public.ecr.aws/supabase/gotrue:v2.197.0',
   storage:'public.ecr.aws/supabase/storage-api:v1.84.19',rest:'public.ecr.aws/supabase/postgrest:v16.5',
  },{allowConcurrentFixtureCleanup:true});
  const author=f.person('mod-author'),viewer=f.person('mod-viewer'),outsider=f.person('mod-outsider'),reader=f.person('mod-reader'),reviewer=f.person('mod-reviewer');
  // Synthetic admission only: no outbound SMS/email or real production roles.
  f.sql(`update abuse_system_settings set require_signed_context=false where id;
   update auth.users set phone='15550001918',phone_confirmed_at=now() where id='${author.authId}';
   insert into platform_admin_roles(slug,name) values('fixture-report-reader','Fixture reader'),('fixture-report-reviewer','Fixture reviewer');
   insert into platform_admin_role_permissions(role_id,permission_id) select r.id,p.id from platform_admin_roles r cross join platform_admin_permissions p
   where r.slug in ('fixture-report-reader','fixture-report-reviewer') and (p.code in ('admin.access','admin.reports.read') or (r.slug='fixture-report-reviewer' and p.code='admin.reports.update'));
   insert into platform_admin_memberships(user_id,role_id) select '${reader.profileId}',id from platform_admin_roles where slug='fixture-report-reader';
   insert into platform_admin_memberships(user_id,role_id) select '${reviewer.profileId}',id from platform_admin_roles where slug='fixture-report-reviewer';
   insert into beauty_profiles(user_id) values('${author.profileId}') on conflict(user_id) do nothing;`);
  const post=crypto.randomUUID(),privatePost=crypto.randomUUID(),heldPost=crypto.randomUUID(),comment=crypto.randomUUID(),monitor=crypto.randomUUID();
  f.sql(`select set_config('request.jwt.claims','{"role":"service_role"}',false);
   insert into beauty_posts(id,profile_id,author_user_id,caption,visibility)
   select x.id,b.id,'${author.profileId}',x.caption,x.visibility from beauty_profiles b cross join (values
    ('${post}'::uuid,'Synthetic report target','public'),('${privatePost}'::uuid,'Private author probe','self'),
    ('${heldPost}'::uuid,'Held comment parent','public'),('${monitor}'::uuid,'Synthetic sexual keyword monitor','public')) x(id,caption,visibility) where b.user_id='${author.profileId}';
   insert into salon_profile_comments(id,beauty_post_id,author_user_id,author_display_name,body,status)
   values('${comment}','${heldPost}','${author.profileId}','Synthetic author','Held parent comment','published');
   update beauty_posts set safety_hold=true where id='${heldPost}';`);
  assert.equal(f.rpc(viewer,'count_public_post_comments',{p_target_type:'beauty_post',p_target_id:heldPost}),0);
  assert.deepEqual(f.rpc(null,'get_public_post_comments',{p_target_type:'beauty_post',p_target_id:heldPost}),[]);
  assert.deepEqual(f.rest(viewer,`/salon_profile_comments?id=eq.${comment}&select=id,body`),[]);
  assert.ok(f.http(3000,'/rpc/post_user_block','POST',{p_type:'beauty_post',p_id:privatePost,p_block:true},viewer.token).status>=400);
  assert.deepEqual(f.rpc(viewer,'get_my_blocked_users'),[]);
  assert.deepEqual(f.rpc(viewer,'post_user_block',{p_type:'beauty_post',p_id:post,p_block:true}),{canBlock:true,blocked:true});
  assert.deepEqual(f.rpc(viewer,'post_user_block',{p_type:'beauty_post',p_id:post,p_block:true}),{canBlock:true,blocked:true});
  f.rpc(viewer,'set_user_block',{p_user_id:author.profileId,p_blocked:false});
  const monitorState=f.json(`select json_build_object('hold',safety_hold,'visibility',visibility,'cases',(select count(*) from post_safety_cases where source_id='${monitor}' and origin='automatic')) from beauty_posts where id='${monitor}'`);
  assert.deepEqual(monitorState,{hold:false,visibility:'public',cases:1},'keyword monitoring does not create a routine human approval queue');
  const report={p_type:'beauty_post',p_id:post,p_action:'report',p_payload:{reason:'harassment',author_user_id:outsider.profileId}};
  assert.equal(f.rpc(viewer,'post_safety_action',report).hidden,true);
  assert.equal(f.rpc(viewer,'post_safety_action',report).hidden,true);
  const c=f.json(`select row_to_json(c) from (select id,platform_report_id,author_user_id,reporter_user_id,status from post_safety_cases where source_id='${post}' and origin='user') c`);
  assert.equal(c.author_user_id,author.profileId);assert.equal(c.reporter_user_id,viewer.profileId);assert.equal(c.status,'pending');
  assert.equal(f.sql(`select count(*) from post_safety_cases where source_id='${post}' and origin='user'`),'1');
  assert.deepEqual(f.json(`select json_build_object('visibility',visibility,'deleted',deleted_at is not null,'hold',safety_hold) from beauty_posts where id='${post}'`),{visibility:'public',deleted:false,hold:false});
  assert.equal(f.sql(`select count(*) from post_safety_hidden where user_id='${outsider.profileId}' and source_id='${post}'`),'0');
  const review={p_case_id:c.id,p_action:'delete',p_reason:'Synthetic violation confirmed',p_public_message:'Synthetic reviewer explanation.',p_request_id:crypto.randomUUID()};
  for(const person of [viewer,reader])assert.ok(f.http(3000,'/rpc/review_post_safety_with_message','POST',review,person.token).status>=400);
  assert.ok(f.http(3000,'/rpc/review_post_safety_with_message','POST',{...review,p_action:'block'},reviewer.token).status>=400,'reports.update never grants account suspension');
  assert.equal(f.sql(`select status from users where id='${author.profileId}'`),'active');
  assert.equal(f.rpc(reviewer,'review_post_safety_with_message',review).ok,true);
  assert.equal(f.rpc(reviewer,'review_post_safety_with_message',review).ok,true,'same request is idempotent');
  assert.deepEqual(f.json(`select json_build_object('deleted',deleted_at is not null,'decisions',(select count(*) from post_safety_decisions where case_id='${c.id}' and action='delete')) from beauty_posts where id='${post}'`),{deleted:true,decisions:1});
  assert.equal(f.sql(`select count(*) from account_memberships where user_id='${reviewer.profileId}'`),'0','moderation does not create salon/business authority');
  const conversation=f.rpc(viewer,'get_my_post_report_conversation',{p_type:'beauty_post',p_id:post});assert.ok(conversation);
  assert.ok(f.http(3000,'/rpc/get_support_conversation','POST',{p_report_id:conversation},outsider.token).status>=400);
  assert.ok(f.http(3000,'/rpc/reopen_content_report_review','POST',{p_case_id:c.id},viewer.token).status>=400);
  assert.ok(f.http(3000,'/rpc/reopen_content_report_review','POST',{p_case_id:c.id},reviewer.token).status>=400,'closed case needs new reporter evidence');
  // Simulate new-evidence workflow state without copying private conversation data.
  f.sql(`update platform_reports set status='under_review' where id='${conversation}'`);
  f.rpc(reviewer,'reopen_content_report_review',{p_case_id:c.id});
  assert.equal(f.sql(`select status from post_safety_cases where id='${c.id}'`),'pending');
  assert.equal(f.sql(`select deleted_at is not null from beauty_posts where id='${post}'`),'t','reconsideration never resurrects deleted content');
  f.save('moderation-operations-acceptance.json',{passed:true,syntheticOnly:true,providerCalls:false,migrationCount:f.evidence.migrationHashes.length,
   migration:f.evidence.migrationHashes.find(m=>m.file==='20261118210000_moderation_operations.sql'),
   checks:['held-parent RPC/count/direct-RLS denial','private author-probe denied','public block idempotency','keyword monitor preserves publication','report dedup and canonical subject','reports-read and reporter cannot take down','reports-update cannot suspend','explicit takedown idempotent','Support outsider denied','reconsideration requires new evidence and does not restore','no salon authority added']});
 }catch(error){if(f)f.save('moderation-operations-acceptance.json',{passed:false,error:f.redact(error.message)});throw error;}
 finally{if(f)f.close();}
});
