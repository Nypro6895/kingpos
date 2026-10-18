import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const oldMigration=readFileSync('supabase/migrations/20261017020000_explore_address_priority.sql','utf8');
const start=oldMigration.indexOf('CREATE OR REPLACE FUNCTION public.refresh_explore_unified_search(');
const oldFn=oldMigration.slice(start,oldMigration.indexOf('END $$;',start)+7);
const newFn=readFileSync('supabase/migrations/20261018234500_service_save_scoped_search_refresh.sql','utf8');
const ddl=readFileSync('supabase/migrations/20261016010001_explore_unified_salon_search.sql','utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(fn){
 const db=new PGlite();
 await db.exec(`create schema extensions;create table explore_salon_documents(salon_id uuid primary key,salon_name_search text,service_search_text text,service_category_search_text text,state_code text,city_search text,postal_code text,latitude float8,longitude float8,profile_completeness int,created_at timestamptz,public_discovery_published_at timestamptz,starting_price numeric,phone text,address_line1 text,address_line2 text,city text);`);
 for(const table of ['explore_unified_search_clock','explore_unified_salon_incarnations','explore_unified_content_incarnations','explore_unified_salon_history','explore_unified_content_history']){
  const a=ddl.indexOf('CREATE TABLE public.'+table+'('),b=ddl.indexOf(';',a);await db.exec(ddl.slice(a,b+1));
 }
 await db.exec(`insert into explore_unified_search_clock default values;
 alter table explore_unified_salon_history add profile_search_text text not null default '',add phone_search_digits text not null default '',add address_line1 text,add address_line2 text,add city text;
 create table explore_unified_content_source(content_key text primary key,salon_id uuid,source_type text,content_id uuid,author_user_id uuid,published_at timestamptz,is_reference boolean,search_terms tsvector,has_real_media boolean);
 create function explore_unified_salon_fingerprint(explore_salon_documents) returns text language sql stable as $$select md5(row_to_json($1)::text)$$;
 create function explore_unified_has_real_cover(explore_salon_documents) returns boolean language sql stable as $$select false$$;
 create function explore_unified_profile_text(explore_salon_documents) returns text language sql immutable as $$select ''::text$$;`);
 await db.exec(fn);
 for(let n=1;n<=3;n++){
  await db.query(`insert into explore_salon_documents(salon_id,salon_name_search,service_search_text,created_at) values($1,$2,'nails','2026-10-01')`,[id(n),'Salon '+n]);
  await db.query(`insert into explore_unified_content_source values($1,$2,'look',$3,null,'2026-10-01',false,to_tsvector('english','gel nails'),true)`,['look:'+n,id(n),id(n+10)]);
 }
 await db.query('select refresh_explore_unified_search($1)',[[id(1),id(2),id(3)]]);
 return db;
}
async function snapshot(db){return (await db.query(`select content_key,valid_from,valid_to,retired_at is not null retired,salon_id,source_type,content_id,published_at,is_reference,search_terms::text,has_real_media from explore_unified_content_history order by content_key,valid_from`)).rows;}
test('scoped refresh preserves add/edit/retire/recreate history, revision no-ops and unaffected salons',async()=>{
 const dbs=await Promise.all([fixture(oldFn),fixture(newFn)]);
 try{
  const apply=async(sql,params=[])=>{for(const db of dbs)await db.query(sql,params)};
  const refresh=async(ids)=>{await apply('select refresh_explore_unified_search($1)',[ids]);assert.deepEqual(await snapshot(dbs[0]),await snapshot(dbs[1]));};
  await refresh([id(1)]);
  assert.equal((await dbs[1].query('select revision from explore_unified_search_clock')).rows[0].revision,1);
  await apply("update explore_unified_content_source set search_terms=to_tsvector('english','new gel') where salon_id=$1",[id(1)]);
  await refresh([id(1)]);
  const other=(await snapshot(dbs[1])).filter(x=>x.salon_id===id(2));assert.equal(other.length,1);assert.equal(other[0].valid_to,null);
  await apply('delete from explore_unified_content_source where salon_id=$1',[id(1)]);await refresh([id(1)]);
  assert.equal((await snapshot(dbs[1])).filter(x=>x.salon_id===id(1)&&x.valid_to===null).length,0);
  await apply("insert into explore_unified_content_source values('look:1',$1,'look',$2,null,'2026-10-02',true,to_tsvector('english','reference'),false)",[id(1),id(11)]);await refresh([id(1)]);
  await apply("update explore_unified_content_source set search_terms=to_tsvector('english','both salons') where salon_id=any($1)",[[id(1),id(2)]]);await refresh([id(1),id(2)]);
  const before=await snapshot(dbs[1]);await refresh([]);assert.deepEqual(await snapshot(dbs[1]),before);
  await apply('begin');await apply("update explore_unified_content_source set has_real_media=false where salon_id=$1",[id(3)]);await refresh([id(3)]);await apply('rollback');assert.deepEqual(await snapshot(dbs[1]),before);
 }finally{for(const db of dbs)await db.close()}
});
