import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function setup(){const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;
 create table users(id uuid primary key,status text,display_name text,first_name text,last_name text);
 create table locations(id uuid primary key,name text,status text);
 create table salon_profile_comments(id uuid primary key default gen_random_uuid(),author_user_id uuid,author_display_name text,body text);
 create function current_public_user_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function user_has_salon_permission(uuid,text[]) returns boolean language sql as $$select $1='${id(10)}'::uuid and current_public_user_id()='${id(1)}'::uuid$$;
 create function current_user_staff_id_for_salon(uuid) returns uuid language sql as $$select case when $1='${id(10)}'::uuid and current_public_user_id()='${id(2)}'::uuid then '${id(100)}'::uuid end$$;
 insert into users values('${id(1)}','active','Owner',null,null),('${id(2)}','active','Nina',null,null),('${id(3)}','disabled','Blocked',null,null);
 insert into locations values('${id(10)}','King Nails','active'),('${id(11)}','Other salon','active'),('${id(12)}','Closed salon','inactive');
`);await db.exec(readFileSync('supabase/migrations/20261012020001_explore_social_layout.sql','utf8'));return db;}
async function actor(db,n){await db.query("select set_config('test.actor',$1,false)",[n?id(n):'']);}
test('salon love, save and hide remain independent, idempotent and private',async()=>{const db=await setup();try{
 await actor(db,1);await db.exec('set role authenticated');
 for(const field of ['loved','saved','hidden'])await db.query('select set_explore_salon_preference($1,$2,true)',[id(10),field]);
 await db.query("select set_explore_salon_preference($1,'saved',false)",[id(10)]);
 await db.query("select set_explore_salon_preference($1,'loved',true)",[id(10)]);
 assert.deepEqual((await db.query('select loved,saved,hidden from explore_salon_preferences')).rows,[{loved:true,saved:false,hidden:true}]);
 assert.equal((await db.query('select * from get_my_explore_salon_preferences()')).rows[0].salon_name,'King Nails');
 await assert.rejects(db.query("update explore_salon_preferences set hidden=false"),/permission denied/);
 await actor(db,2);assert.equal((await db.query('select * from explore_salon_preferences')).rows.length,0);
 assert.equal((await db.query('select * from get_my_explore_salon_preferences()')).rows.length,0);
 await db.query("select set_explore_salon_preference($1,'saved',true)",[id(10)]);
 assert.equal((await db.query('select * from explore_salon_preferences')).rows.length,1);
 await actor(db,3);await assert.rejects(db.query("select set_explore_salon_preference($1,'loved',true)",[id(10)]),/Sign in/);
 await actor(db,1);await assert.rejects(db.query("select set_explore_salon_preference($1,'following',true)",[id(10)]),/Invalid/);
 await assert.rejects(db.query("select set_explore_salon_preference($1,'loved',true)",[id(12)]),/unavailable/);
 await db.exec('reset role; set role anon');await assert.rejects(db.query("select set_explore_salon_preference($1,'saved',true)",[id(10)]),/permission denied/);
}finally{await db.close();}});
test('comment personas resolve canonical names and reject another salon or user',async()=>{const db=await setup();try{
 const insert=(who,role,salon)=>db.query("insert into salon_profile_comments(author_user_id,author_display_name,body,acting_role,acting_salon_id) values($1,'Forged name','Test',$2,$3) returning *",[id(who),role,salon?id(salon):null]);
 await actor(db,1);const salon=(await insert(1,'salon',10)).rows[0];assert.equal(salon.author_display_name,'King Nails');
 await assert.rejects(insert(1,'salon',11),/cannot comment/);await assert.rejects(insert(2,'salon',10),/Invalid comment identity/);
 await assert.rejects(db.query("update salon_profile_comments set acting_role='personal' where id=$1",[salon.id]),/cannot change/);
 await assert.rejects(db.query("update salon_profile_comments set author_display_name='Someone else' where id=$1",[salon.id]),/cannot change/);
 await actor(db,2);assert.equal((await insert(2,'staff',10)).rows[0].author_display_name,'Nina');
 assert.equal((await insert(2,'personal',null)).rows[0].author_display_name,'Nina');
 await assert.rejects(insert(2,'personal',10),/cannot claim/);await assert.rejects(insert(2,'staff',11),/cannot comment/);await assert.rejects(insert(2,'salon',10),/cannot comment/);
 await actor(db,3);await assert.rejects(insert(3,'personal',null),/unavailable/);
}finally{await db.close();}});
