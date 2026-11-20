import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const ids={owner:'10000000-0000-4000-8000-000000000001',other:'10000000-0000-4000-8000-000000000002',staff:'10000000-0000-4000-8000-000000000003',mod:'10000000-0000-4000-8000-000000000004',admin:'10000000-0000-4000-8000-000000000005'};
async function database(){const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;
 create table users(id uuid primary key,status text default 'active',display_name text);
 create table roles(id uuid primary key default gen_random_uuid(),code text);
 create table salon_memberships(user_id uuid,role_id uuid,status text default 'active');
 create table platform_admin_permissions(id uuid primary key default gen_random_uuid(),code text unique,name text,category text);
 create table platform_admin_roles(id uuid primary key default gen_random_uuid(),slug text);
 create table platform_admin_memberships(user_id uuid,role_id uuid,status text default 'active');
 create table platform_admin_role_permissions(role_id uuid,permission_id uuid,unique(role_id,permission_id));
 create function current_public_user_id() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
 create function platform_admin_has_permission(text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from platform_admin_memberships m join users u on u.id=m.user_id join platform_admin_role_permissions rp on rp.role_id=m.role_id join platform_admin_permissions p on p.id=rp.permission_id where m.user_id=current_public_user_id() and m.status='active' and u.status='active' and p.code=$1) $$;
 insert into roles(code) values('OWNER'),('STAFF');
 insert into platform_admin_roles(slug) values('platform_owner'),('operations_admin'),('moderator'),('support_agent');
 `);
 for(const [name,id] of Object.entries(ids))await db.query('insert into users(id,display_name) values($1,$2)',[id,name]);
 await db.exec(`insert into salon_memberships(user_id,role_id) select u.id,r.id from users u cross join roles r where (u.display_name in ('owner','other') and r.code='OWNER') or (u.display_name='staff' and r.code='STAFF');
 insert into platform_admin_memberships(user_id,role_id) select u.id,r.id from users u cross join platform_admin_roles r where (u.display_name='mod' and r.slug='moderator') or (u.display_name='admin' and r.slug='platform_owner');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261103180000_owner_forum.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261103181500_forum_feed_indexes.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261103183500_forum_numeric_order.sql','utf8'));
 return db;
}
async function as(db,user){await db.exec('reset role');await db.query("select set_config('test.user_id',$1,false)",[user??'']);await db.exec('set role authenticated');}
async function rpc(db,fn,input){return (await db.query(`select ${fn}($1::jsonb) result`,[JSON.stringify(input)])).rows[0].result;}
const read=(db,x)=>rpc(db,'forum_read',x),write=(db,x)=>rpc(db,'forum_write',x);
async function cooldown(db){await db.exec("reset role;update forum_rate_limits set last_at=now()-interval '2 minutes';set role authenticated");}

test('starter discussions preserve authentication, visibility and moderation boundaries',async()=>{
 const db=await database();
 try {
  const usersBefore=(await db.query('select count(*)::int n from users')).rows[0].n;
  await db.exec(fs.readFileSync('supabase/migrations/20261103190000_forum_starter_discussions.sql','utf8'));
  assert.equal((await db.query('select count(*)::int n from users')).rows[0].n,usersBefore,'personas never create sign-in accounts');
  assert.deepEqual((await db.query('select count(*)::int n from forum_topics group by section_id')).rows.map(x=>x.n),[3,3,3,3,3]);
  assert.equal((await db.query('select count(*)::int n from forum_replies')).rows[0].n,30);
  await as(db,ids.owner);
  const feed=await read(db,{mode:'feed'});assert.equal(feed.length,15);
  assert.ok(feed.every(t=>t.author_id===null&&t.author_name!=='Owner'&&t.author_avatar.startsWith('/brand/forum/')));
  const detail=await read(db,{mode:'topic',id:feed[0].id});assert.equal(detail.replies.length,2);
  assert.ok(detail.replies.every(r=>r.author_avatar&&r.author_name!=='Owner'));
  await assert.rejects(db.query('select * from forum_seed_personas'),/permission denied/);
  await assert.rejects(write(db,{op:'edit_topic',id:feed[0].id,title:'Cannot impersonate persona',body:'blocked'}),/own|author/i);
  await cooldown(db);
  const own=await write(db,{op:'topic',section:feed[0].section_id,title:'A real owner question',body:'Real authenticated owner',seed_persona_id:'mai',author_id:null});
  assert.equal((await read(db,{mode:'topic',id:own.id})).topic.author_id,ids.owner);
  assert.equal((await read(db,{mode:'topic',id:own.id})).topic.author_avatar,null);
  await as(db,ids.mod);await write(db,{op:'delete',kind:'topic',id:feed[0].id,reason:'Moderate starter content'});
  await as(db,ids.owner);await assert.rejects(read(db,{mode:'topic',id:feed[0].id}),/not found/);
  await as(db,ids.mod);await write(db,{op:'restore',kind:'topic',id:feed[0].id,reason:'Restore starter content'});
  await as(db,ids.staff);await assert.rejects(read(db,{mode:'feed'}),/salon owners/);
 } finally {await db.close();}
});

test('forum database security, moderation and pagination',async t=>{
 const db=await database();let section,topic,reply,chat,report;
 try{
 await t.test('owners use their existing account; moderators inherit platform team permissions',async()=>{
  await as(db,ids.owner);const c=await read(db,{mode:'context'});section=c.sections[0].id;assert.equal(c.user_id,ids.owner);assert.equal(c.can_moderate,false);assert.equal(c.sections.length,5);
  await as(db,ids.mod);const m=await read(db,{mode:'context'});assert.equal(m.can_moderate,true);assert.equal(m.can_manage,false);
  await as(db,ids.admin);assert.equal((await read(db,{mode:'context'})).can_manage,true);
 });
 await t.test('guests, staff and suspended accounts cannot read or write',async()=>{
  for(const user of [null,ids.staff]){await as(db,user);await assert.rejects(read(db,{}),/active account|salon owners/);await assert.rejects(write(db,{op:'chat',body:'unauthorized'}));}
  await db.exec(`reset role;update users set status='suspended' where id='${ids.owner}'`);await as(db,ids.owner);await assert.rejects(read(db,{}),/active account/);await db.exec(`reset role;update users set status='active' where id='${ids.owner}'`);
 });
 await t.test('direct tables, helper RPCs and moderation are denied to owners',async()=>{
  await as(db,ids.owner);for(const table of ['forum_topics','forum_chat','forum_restrictions','forum_audit'])await assert.rejects(db.query(`select * from ${table}`),/permission denied/);
  await assert.rejects(db.query('select forum_actor()'),/permission denied/);
  await assert.rejects(write(db,{op:'restrict',id:ids.other,reason:'test restriction'}),/Moderator permission/);
 });
 await t.test('create, search, filter and bookmark topics with server-owned identity',async()=>{
  await as(db,ids.owner);topic=(await write(db,{op:'topic',section,title:'Weekend turn fairness',body:'Discuss fair turns and busy weekends.',state:'TX',author_id:ids.other})).id;
  const feed=await read(db,{mode:'feed'});assert.equal(feed[0].author_id,ids.owner);assert.equal(feed[0].id,topic);assert.equal((await read(db,{mode:'feed',state:'CA'})).length,0);assert.equal((await read(db,{mode:'feed',q:'fairness'})).length,1);
  await write(db,{op:'bookmark',id:topic,enabled:true});assert.equal((await read(db,{mode:'saved'})).length,1);
  await as(db,ids.other);assert.equal((await read(db,{mode:'saved'})).length,0);assert.equal((await read(db,{mode:'mine'})).length,0);
 });
 await t.test('rate limit and text limits are enforced by the database',async()=>{
  await as(db,ids.owner);await assert.rejects(write(db,{op:'topic',section,title:'Another valid title',body:'too fast'}),/wait/);
  await cooldown(db);await assert.rejects(write(db,{op:'chat',body:'x'.repeat(2001)}),/check constraint/);
  await assert.rejects(write(db,{op:'topic',section,title:'Valid title',body:'valid',state:'ZZ'}),/valid state/);
 });
 await t.test('reply, locked discussion, deletion and restore cannot be bypassed',async()=>{
  await as(db,ids.other);reply=(await write(db,{op:'reply',id:topic,body:'Agree rules before each shift.'})).id;
  await as(db,ids.mod);await write(db,{op:'lock',kind:'topic',id:topic,reason:'Pause heated discussion'});
  await as(db,ids.owner);await assert.rejects(write(db,{op:'reply',id:topic,body:'Locked reply'}),/locked/);
  await as(db,ids.mod);await write(db,{op:'delete',kind:'reply',id:reply,reason:'Off topic response'});
  await as(db,ids.owner);assert.equal((await read(db,{mode:'topic',id:topic})).replies.length,0);
  await as(db,ids.mod);assert.equal((await read(db,{mode:'topic',id:topic})).replies.length,1);await write(db,{op:'restore',kind:'reply',id:reply,reason:'Appeal accepted'});
  await write(db,{op:'delete',kind:'topic',id:topic,reason:'Review discussion'});
  await as(db,ids.owner);assert.equal((await read(db,{mode:'feed'})).length,0);await assert.rejects(read(db,{mode:'topic',id:topic}),/not found/);
  await as(db,ids.mod);assert.equal((await read(db,{mode:'removed'})).length,1);await write(db,{op:'restore',kind:'topic',id:topic,reason:'Review complete'});await write(db,{op:'unlock',kind:'topic',id:topic,reason:'Discussion may continue'});
 });
 await t.test('reports are unique, visible to moderators and never auto-hide content',async()=>{
  await as(db,ids.owner);await write(db,{op:'report',kind:'topic',id:topic,reason:'Please review this discussion'});await cooldown(db);await write(db,{op:'report',kind:'topic',id:topic.toUpperCase(),reason:'Duplicate report'});assert.equal((await read(db,{mode:'feed'})).length,1);await assert.rejects(read(db,{mode:'reports'}),/Moderator/);
  await as(db,ids.mod);const reports=await read(db,{mode:'reports'});assert.equal(reports.length,1);assert.equal(reports[0].author_id,ids.owner);report=reports[0].id;await write(db,{op:'resolve',id:report,reason:'No violation found'});assert.equal((await read(db,{mode:'reports'})).length,0);
 });
 await t.test('forum bans block scoped writes without suspending salon account',async()=>{
  await as(db,ids.mod);await write(db,{op:'restrict',id:ids.other,scope:'chat',days:'1',reason:'Repeated chat spam'});
  await as(db,ids.other);await assert.rejects(write(db,{op:'chat',body:'bypass'}),/restricted/);await cooldown(db);await write(db,{op:'reply',id:topic,body:'Allowed reply while chat restricted'});
  await as(db,ids.mod);await write(db,{op:'restrict',id:ids.other,scope:'all',reason:'Repeated violations'});
  await as(db,ids.other);await cooldown(db);await assert.rejects(write(db,{op:'reply',id:topic,body:'bypass'}),/restricted/);assert.equal((await read(db,{mode:'context'})).restriction.scope,'all');
  await db.exec('reset role');assert.equal((await db.query('select status from users where id=$1',[ids.other])).rows[0].status,'active');
  await as(db,ids.mod);await write(db,{op:'unrestrict',id:ids.other,reason:'Appeal accepted'});await assert.rejects(write(db,{op:'restrict',id:ids.admin,reason:'Bad escalation'}),/team accounts/);await assert.rejects(write(db,{op:'restrict',id:ids.mod,reason:'Self ban'}),/team accounts/);
 });
 await t.test('expired restrictions and moderator revocation take effect immediately',async()=>{
  await as(db,ids.mod);await write(db,{op:'restrict',id:ids.other,scope:'chat',days:'1',reason:'Temporary restriction'});await db.exec(`reset role;update forum_restrictions set expires_at=now()-interval '1 second';update platform_admin_memberships set status='revoked' where user_id='${ids.mod}'`);
  await as(db,ids.other);await cooldown(db);chat=(await write(db,{op:'chat',body:'Allowed after expiry'})).id;assert.equal(typeof chat,'string');
  await as(db,ids.mod);await assert.rejects(write(db,{op:'delete',kind:'chat',id:chat,reason:'Revoked moderator'}),/salon owners/);await db.exec(`reset role;update platform_admin_memberships set status='active' where user_id='${ids.mod}'`);
 });
 await t.test('section create, reorder, archive, move and audit are manager-only',async()=>{
  await as(db,ids.mod);await assert.rejects(write(db,{op:'section_save',name:'New category',reason:'Create category'}),/manager permission/);
  await as(db,ids.admin);await write(db,{op:'section_save',name:'New category',description:'New owner discussions',reason:'Create category'});let c=await read(db,{mode:'context'});const id=c.sections.at(-1).id;
  await write(db,{op:'section_move',id,direction:'up',reason:'Reorder sections'});c=await read(db,{mode:'context'});assert.equal(c.sections.at(-2).id,id);
  await write(db,{op:'move',kind:'topic',id:topic,section:id,reason:'Better section fit'});assert.equal((await read(db,{mode:'topic',id:topic})).topic.section_id,id);
  await write(db,{op:'section_save',id,name:'New category',archived:true,reason:'Archive category'});
  await as(db,ids.owner);assert.equal((await read(db,{mode:'context'})).sections.some(x=>x.id===id),false);await cooldown(db);await assert.rejects(write(db,{op:'topic',section:id,title:'Archived section',body:'not allowed'}),/active section/);
  await as(db,ids.mod);assert.ok((await read(db,{mode:'audit'})).length>8);
 });
 await t.test('keyset pagination handles identical timestamps without gaps; chat history is bounded',async()=>{
  await db.exec('reset role');await db.query("insert into forum_topics(author_id,section_id,title,body,created_at) select $1,$2,'Page topic '||i,'page body','2026-11-01'::timestamptz from generate_series(1,55) i",[ids.owner,section]);
  await as(db,ids.owner);const found=new Set();let input={mode:'feed'};for(let page=0;page<4;page++){const rows=await read(db,input),shown=rows.slice(0,20);for(const r of shown){assert.equal(found.has(r.id),false);found.add(r.id)}if(rows.length<=20)break;const last=shown.at(-1);input={mode:'feed',before:last.created_at,cursor_id:last.id};}assert.equal(found.size,56);
  await db.exec('reset role');await db.query("insert into forum_chat(author_id,body) select $1,'Chat '||i from generate_series(1,120) i",[ids.owner]);await as(db,ids.owner);const first=await read(db,{mode:'chat'});assert.equal(first.length,41);for(let i=1;i<first.length;i++)assert.ok(BigInt(first[i].id)>BigInt(first[i-1].id),'messages stay chronological across 99/100');const older=await read(db,{mode:'chat',before_id:first[1].id});assert.ok(older.every(x=>BigInt(x.id)<BigInt(first[1].id)));
 });
 await t.test('authors can edit and remove their own content without moderator authority',async()=>{
  await as(db,ids.other);await cooldown(db);await assert.rejects(write(db,{op:'edit_topic',id:topic,title:'Unauthorized edit',body:'Not my topic'}),/Only the author/);
  await as(db,ids.owner);await cooldown(db);await write(db,{op:'edit_topic',id:topic,title:'Updated weekend turn discussion',body:'Updated by the original owner'});assert.equal((await read(db,{mode:'topic',id:topic})).topic.body,'Updated by the original owner');
  await as(db,ids.other);await cooldown(db);await assert.rejects(write(db,{op:'remove_own',kind:'topic',id:topic}),/Only the author/);
  await as(db,ids.owner);await cooldown(db);await write(db,{op:'remove_own',kind:'topic',id:topic});await assert.rejects(read(db,{mode:'topic',id:topic}),/not found/);
  await as(db,ids.mod);await write(db,{op:'restore',kind:'topic',id:topic,reason:'Restore for pagination test'});
 });
 await t.test('pinned topics sort first without breaking keyset pagination',async()=>{
  await as(db,ids.mod);const rows=await read(db,{mode:'feed'});const pinned=rows.at(-1).id;await write(db,{op:'pin',kind:'topic',id:pinned,reason:'Useful owner guide'});
  await as(db,ids.owner);const first=await read(db,{mode:'feed'});assert.equal(first[0].id,pinned);const seen=new Set();let input={mode:'feed'};
  for(let page=0;page<4;page++){const a=await read(db,input),shown=a.slice(0,20);for(const x of shown){assert.equal(seen.has(x.id),false);seen.add(x.id)}if(a.length<=20)break;const last=shown.at(-1);input={mode:'feed',before:last.created_at,cursor_id:last.id,before_pinned:last.pinned};}assert.equal(seen.size,56);
  await as(db,ids.mod);const audit=await read(db,{mode:'audit'});assert.ok(audit.length>10);for(let i=1;i<audit.length;i++)assert.ok(BigInt(audit[i].id)<BigInt(audit[i-1].id),'audit is newest-first across 9/10');
 });
 }finally{await db.close()}
});
