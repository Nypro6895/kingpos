import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const original = readFileSync('supabase/migrations/20261009120031_explore_organic_content_search.sql','utf8');
const migration = readFileSync('supabase/migrations/202610140004_explore_look_salon_keywords.sql','utf8');
const fn = name => original.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?END \\$\\$;`))[0];

test('salon names, titles, captions and summaries match only public regional posts and stay current', {timeout:60000}, async()=>{
 const db = new PGlite();
 try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA extensions;
   CREATE TABLE explore_salon_documents(salon_id uuid PRIMARY KEY,salon_name text,public_discovery_published_at timestamptz);
   CREATE TABLE salon_profile_looks(id uuid PRIMARY KEY,title text,caption text);
   CREATE TABLE salon_profile_updates(id uuid PRIMARY KEY,title text,caption text,summary text);
   CREATE TABLE beauty_posts(id uuid PRIMARY KEY,caption text);
   CREATE TABLE explore_social_content_documents(content_key text PRIMARY KEY,source_type text,content_id uuid,salon_id uuid,
    state_code text,city_search text,postal_code text,latitude float8,longitude float8,published_at timestamptz,
    category_search text DEFAULT 'nails',starting_price numeric DEFAULT 40,bookable boolean DEFAULT true);
   CREATE TABLE explore_social_content_keywords(content_key text PRIMARY KEY REFERENCES explore_social_content_documents ON DELETE CASCADE,
    search_terms tsvector,state_code text,city_search text,postal_code text,latitude float8,longitude float8,published_at timestamptz);
   CREATE TABLE explore_social_trending(content_key text);
   CREATE FUNCTION normalize_search_text(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT lower(coalesce(value,''))$$;
   CREATE FUNCTION explore_search_region_predicate(region jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT format('d.state_code=%L AND d.city_search=%L',region->>'state',region->>'city')$$;
  `);
  await db.exec(fn('refresh_explore_social_keywords'));
  await db.exec(fn('sync_explore_social_keywords'));
  await db.exec(fn('explore_social_filter_predicate'));
  await db.exec(fn('get_explore_social_keyword_matches'));
  await db.exec(`REVOKE ALL ON FUNCTION refresh_explore_social_keywords(text[]) FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION refresh_explore_social_keywords(text[]) TO service_role;
   CREATE TRIGGER keyword_insert AFTER INSERT ON explore_social_content_documents REFERENCING NEW TABLE AS keyword_new FOR EACH STATEMENT EXECUTE FUNCTION sync_explore_social_keywords();
   CREATE TRIGGER keyword_update AFTER UPDATE ON explore_social_content_documents REFERENCING NEW TABLE AS keyword_new FOR EACH STATEMENT EXECUTE FUNCTION sync_explore_social_keywords();`);
  await db.query('INSERT INTO explore_salon_documents VALUES($1,$2,now()),($3,$4,now()),($5,$6,now())', [id(1),'Brown Studio',id(2),'Other Nails',id(3),'Directory Only Nails']);
  await db.query('INSERT INTO salon_profile_looks VALUES($1,$2,$3),($4,$5,$6),($7,$8,$9)',[id(11),'Almond finish','Warm gloss',id(12),'Brown almond','Popular look',id(13),'Private brown almond','Unpublished']);
  const insert = async (n,salon,source='salon_profile_look',city='honolulu',state='HI') => db.query(`INSERT INTO explore_social_content_documents(content_key,source_type,content_id,salon_id,state_code,city_search,published_at) VALUES($1,$2,$3,$4,$5,$6,now())`,[`${source}:${id(n)}`,source,id(n),id(salon),state,city]);
  await insert(11,1);await insert(12,2,'salon_profile_look','milwaukee','WI');
  const matches = async query => (await db.query("SELECT get_explore_social_keyword_matches($1,$2,'local',now()) AS result",[{query,category:'Nails'},{kind:'city',city:'honolulu',state:'HI'}])).rows[0].result;
  assert.equal((await matches('brown almond')).length,0,'old projection lacks the salon name');
  const before=(await db.query("SELECT oid,proacl::text acl FROM pg_proc WHERE oid='refresh_explore_social_keywords(text[])'::regprocedure")).rows[0];
  await db.exec(migration);
  assert.deepEqual((await db.query("SELECT oid,proacl::text acl FROM pg_proc WHERE oid='refresh_explore_social_keywords(text[])'::regprocedure")).rows[0],before);
  assert.deepEqual((await matches('brown almond')).map(row=>row.contentId),[id(11)],'name and title combine without admitting out-of-area or unpublished posts');
  assert.equal((await matches('directory')).length,0,'a directory entry without a real post never becomes an organic match');
  assert.equal((await matches('brown almond missing')).length,0,'all required query terms still apply');
  assert.equal((await matches('warm gloss')).length,1,'caption-only matches');
  await db.query('INSERT INTO salon_profile_updates VALUES($1,$2,$3,$4)',[id(14),'Velvet finish','Shimmer caption','Holiday summary']);
  await insert(14,1,'salon_profile_update');
  assert.equal((await matches('velvet')).length,1);
  assert.equal((await matches('shimmer')).length,1);
  assert.equal((await matches('holiday')).length,1,'a nonempty caption does not hide the summary');
  await db.query('UPDATE explore_salon_documents SET salon_name=$1 WHERE salon_id=$2',['Cocoa Studio',id(1)]);
  assert.equal((await matches('brown almond')).length,0,'rename removes stale name terms');
  assert.deepEqual((await matches('cocoa almond')).map(row=>row.contentId),[id(11)]);
  await db.query('UPDATE salon_profile_looks SET caption=$1 WHERE id=$2',['Pearl finish',id(11)]);
  await db.query('UPDATE explore_social_content_documents SET published_at=published_at WHERE content_id=$1',[id(11)]);
  assert.equal((await matches('warm gloss')).length,0);
  assert.equal((await matches('pearl')).length,1);
  await db.query('DELETE FROM explore_social_content_documents WHERE content_id=$1',[id(11)]);
  assert.equal((await matches('cocoa almond')).length,0,'removed/hidden media leaves no keyword result');
  assert.equal((await db.query("SELECT has_function_privilege('anon','sync_explore_social_keyword_salon_names()','EXECUTE') allowed")).rows[0].allowed,false);
 } finally { await db.close(); }
});
