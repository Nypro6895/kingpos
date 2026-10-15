import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {cube} from '@electric-sql/pglite/contrib/cube';
import {earthdistance} from '@electric-sql/pglite/contrib/earthdistance';
test('actual suggestion SQL respects visibility, prefix, category and bounds without creating sessions',{timeout:120000},async()=>{
 const db=new PGlite({extensions:{pg_trgm,cube,earthdistance}});
 try{
  await db.exec(readFileSync('tests/fixtures/explore-search-session-bootstrap.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009052031_explore_search_sessions.sql','utf8'));
  await db.exec(`CREATE TABLE hidden_salons(id uuid PRIMARY KEY); CREATE FUNCTION public.salon_profile_public_salon_exists(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT NOT EXISTS(SELECT 1 FROM hidden_salons h WHERE h.id=$1)$$;
   INSERT INTO explore_salon_documents(salon_id,salon_name,salon_name_search,city,city_search,state_code,service_category_search_text,created_at)
   SELECT md5(i::text)::uuid,'King Nails '||i,'king nails '||i,'Milwaukee','milwaukee','WI','nails',now() FROM generate_series(1,20)i;
   INSERT INTO hidden_salons SELECT salon_id FROM explore_salon_documents ORDER BY salon_id LIMIT 1;`);
  await db.exec(readFileSync('supabase/migrations/20261009128031_explore_search_suggestions.sql','utf8'));
  const result=await db.query(`SELECT get_public_explore_search_suggestions('King','Nails','Milwaukee','WI',999) AS rows`);
  assert.ok(result.rows[0].rows.length>0);assert.ok(result.rows[0].rows.length<=8);
  const hidden=(await db.query('SELECT id FROM hidden_salons')).rows[0].id;
  assert.ok(result.rows[0].rows.every(row=>row.id!==hidden));
  assert.equal((await db.query(`SELECT get_public_explore_search_suggestions('King','Hair',NULL,'WI',8) AS rows`)).rows[0].rows.length,0);
  assert.equal((await db.query(`SELECT get_public_explore_search_suggestions('ing',NULL,NULL,NULL,8) AS rows`)).rows[0].rows.length,0,'prefix only');
  assert.equal((await db.query(`SELECT get_public_explore_search_suggestions('K',NULL,NULL,NULL,8) AS rows`)).rows[0].rows.length,0);
  assert.equal((await db.query(`SELECT get_public_explore_search_suggestions('Mil',NULL,NULL,NULL,8) AS rows`)).rows[0].rows[0].kind,'area');
  assert.equal((await db.query(`SELECT count(*)::int AS count FROM explore_search_sessions`)).rows[0].count,0);
  await db.exec(`INSERT INTO explore_salon_documents(salon_id,salon_name,salon_name_search,city,city_search,state_code,created_at) VALUES(md5('newcity')::uuid,'Future Salon','future salon','Madison','madison','WI',now()+interval '1 day');`);
  assert.equal((await db.query(`SELECT get_public_explore_search_suggestions('Future',NULL,NULL,NULL,8) AS rows`)).rows[0].rows.length,0);
  assert.equal((await db.query(`SELECT get_public_explore_search_suggestions('Mad',NULL,NULL,NULL,8) AS rows`)).rows[0].rows[0].label,'Madison, WI');
  await db.exec('SET ROLE anon');await assert.rejects(db.query('SELECT * FROM explore_search_area_names'));
 }finally{await db.close();}
});
