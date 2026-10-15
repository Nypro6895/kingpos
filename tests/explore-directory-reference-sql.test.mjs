import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('directory reference RPC is bounded, current, public-only and excludes removed or future salons',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE TABLE explore_reference_favorites(user_id uuid,item_key text,created_at timestamptz,PRIMARY KEY(user_id,item_key));
   CREATE TABLE salon_directory_listings(listing_id text PRIMARY KEY,salon_id uuid UNIQUE);
   CREATE TABLE explore_salon_documents(salon_id uuid PRIMARY KEY,salon_name text,created_at timestamptz,public_discovery_published_at timestamptz);
   CREATE TABLE visibility(salon_id uuid PRIMARY KEY,is_public boolean);
   CREATE FUNCTION current_public_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
   CREATE FUNCTION salon_profile_public_salon_exists(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT is_public FROM visibility WHERE salon_id=id),false) $$;
   INSERT INTO explore_salon_documents SELECT ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Current name '||i,now()-interval '1 day',CASE WHEN i=3 THEN now()+interval '1 day' ELSE NULL END FROM generate_series(1,4) i;
   INSERT INTO salon_directory_listings SELECT 'wi-'||i,salon_id FROM explore_salon_documents CROSS JOIN LATERAL(SELECT right(salon_id::text,1)::int i) x;
   INSERT INTO visibility SELECT salon_id,right(salon_id::text,1)<>'2' FROM explore_salon_documents;`);
  await db.exec(readFileSync('supabase/migrations/20261009092031_explore_directory_references.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009095031_explore_favorite_identity_cursor.sql','utf8'));
  const refs=async(ids)=>(await db.query('SELECT * FROM get_public_explore_directory_references($1::text[])',[ids])).rows;
  const current=await refs(['wi-1','wi-2','wi-3','wi-4','wi-missing','wi-1']);
  assert.deepEqual(current.map(row=>row.listing_id).sort(),['wi-1','wi-4']);
  assert.equal(current.find(row=>row.listing_id==='wi-1').salon_name,'Current name 1');
  await db.exec("UPDATE explore_salon_documents SET salon_name='Edited current name' WHERE salon_id='10000000-0000-4000-8000-000000000001'");
  assert.equal((await refs(['wi-1']))[0].salon_name,'Edited current name');
  await db.exec("DELETE FROM explore_salon_documents WHERE salon_id='10000000-0000-4000-8000-000000000001'");
  assert.equal((await refs(['wi-1'])).length,0,'old directory source survives, but cannot resurrect a removed projection');
  assert.equal((await refs([])).length,0);
  await assert.rejects(refs(Array(41).fill('wi-1')),error=>error.code==='22023');
  await assert.rejects(refs([null]),error=>error.code==='22023');
  assert.equal((await db.query("SELECT has_function_privilege('anon','get_public_explore_directory_references(text[])','EXECUTE') allowed")).rows[0].allowed,true);
  assert.ok((await db.query("SELECT indexname FROM pg_indexes WHERE tablename='explore_reference_favorites'")).rows.some(row=>row.indexname==='explore_reference_favorites_cursor_idx'));
  await db.exec(`INSERT INTO explore_reference_favorites SELECT '10000000-0000-4000-8000-000000000001', 'directory:wi-'||lpad(i::text,4,'0'),now()-make_interval(mins=>i/10) FROM generate_series(1,300) i;
   INSERT INTO explore_reference_favorites VALUES('10000000-0000-4000-8000-000000000002','directory:private-other-user',now());
   SELECT set_config('test.actor','10000000-0000-4000-8000-000000000001',false);`);
  const favoritePage=async(time=null,key=null)=>(await db.query('SELECT * FROM get_my_explore_reference_favorites($1,$2,20)',[time,key])).rows;
  const all=[];let time=null,key=null;
  while(true){const page=await favoritePage(time,key);const shown=page.slice(0,20);all.push(...shown);if(page.length<=20)break;time=shown.at(-1).created_at;key=shown.at(-1).item_key;}
  assert.equal(all.length,300);assert.equal(new Set(all.map(row=>row.item_key)).size,300,'same-time cursor ties do not repeat or skip');
  assert.ok(all.every(row=>row.item_key!=='directory:private-other-user'));
  const boundary=all[150];await db.exec('SET enable_seqscan=off');
  const plan=(await db.query('EXPLAIN(FORMAT JSON) SELECT item_key,created_at FROM explore_reference_favorites WHERE user_id=$1 AND ROW(created_at,item_key)<ROW($2::timestamptz,$3::text) ORDER BY created_at DESC,item_key DESC LIMIT 21',['10000000-0000-4000-8000-000000000001',boundary.created_at,boundary.item_key])).rows[0]['QUERY PLAN'][0].Plan;
  const find=(node,key)=>[...(node[key]?[node[key]]:[]),...(node.Plans??[]).flatMap(child=>find(child,key))];
  assert.ok(find(plan,'Index Cond').some(value=>value.includes('ROW(created_at, item_key) <')),'deep favorite cursor enters its composite index condition');
  await db.exec('SET enable_seqscan=on');
  assert.equal((await db.query("SELECT has_function_privilege('anon','get_my_explore_reference_favorites(timestamptz,text,integer)','EXECUTE') allowed")).rows[0].allowed,false);
  await db.exec("SELECT set_config('test.actor','',false)");
  await assert.rejects(favoritePage(),error=>error.code==='28000');
 }finally{await db.close();}
});
