// Owned synthetic PostgreSQL fixture. Executes product migrations; never opens a remote database.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const legacyMigrationStack = [
  '20261009052031_explore_search_sessions.sql', '20261009062031_explore_booking_rank_gate.sql',
  '20261009064031_explore_region_index_predicates.sql', '20261009065531_explore_session_publication_cutoff.sql',
  '20261009071031_explore_candidate_seek_paths.sql', '20261009123031_explore_gps_address_context.sql',
  '20261009125031_explore_negative_fuzzy_guard.sql', '20261009126031_explore_ranked_search.sql',
  '20261009129032_explore_rank_safe_update.sql', '20261009129033_explore_rank_batch_proof.sql',
];
export const unifiedMigrationStack = [
  '20261016010001_explore_unified_salon_search.sql', '20261017020000_explore_address_priority.sql',
  '20261017030000_explore_anywhere_search.sql', '20261017040000_explore_unified_query_performance.sql',
];
export const qualityMigration = '20261119042923_explore_local_quality_search.sql';
export const fixtureId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const productMigration = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
export const sourceHash = value => createHash('sha256').update(value).digest('hex');

export async function initializeNativeFixture(db, { scale, onStage = () => {} }) {
  const exec = sql => db.query(sql);
  await exec(readFileSync(new URL('./explore-social-bootstrap.sql', import.meta.url), 'utf8'));
  await exec(`CREATE TABLE pos_tickets(id uuid PRIMARY KEY,salon_id uuid,status text,closed_at timestamptz);
    CREATE INDEX pos_rank_fixture_idx ON pos_tickets(salon_id);
    ALTER TABLE salon_directory_listings ADD COLUMN reference_post_id uuid,ADD COLUMN claim_state text;
    ALTER TABLE locations ADD COLUMN status text DEFAULT 'active';
    ALTER TABLE salon_settings ADD COLUMN public_discovery_enabled boolean DEFAULT true;
    ALTER TABLE salon_profile_media_assets ADD COLUMN purpose text,ADD COLUMN bucket text DEFAULT 'salon-profile-media';
    CREATE TABLE explore_social_trending(content_key text PRIMARY KEY);
    CREATE TABLE fixture_user_blocks(actor uuid,subject uuid,PRIMARY KEY(actor,subject));
    CREATE FUNCTION current_public_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.viewer',true),'')::uuid$$;
    CREATE FUNCTION explore_preferred_categories() RETURNS text[] LANGUAGE sql STABLE AS $$SELECT '{}'::text[]$$;
    CREATE FUNCTION social_users_blocked(actor uuid,subject uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM fixture_user_blocks b WHERE b.actor=actor AND b.subject=subject OR b.actor=subject AND b.subject=actor)$$;
    CREATE FUNCTION salon_profile_public_salon_exists(target_salon_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM explore_salon_documents d JOIN locations l ON l.id=d.salon_id JOIN salon_settings s USING(salon_id) WHERE d.salon_id=target_salon_id AND d.has_public_profile AND l.status='active' AND s.public_discovery_enabled)$$;`);
  for (const file of legacyMigrationStack) await exec(productMigration(file));
  const region = productMigration('20261009127031_explore_coordinate_validity.sql').match(/CREATE OR REPLACE FUNCTION public\.explore_search_region\([\s\S]*?END \$\$;/)[0];
  await exec(region);
  await exec(productMigration('20261009121031_explore_query_area_lookup.sql'));
  await exec(productMigration('20261009128031_explore_search_suggestions.sql'));
  // Install the current schema while empty. Historical upgrade replay is not the request benchmark.
  for (const file of unifiedMigrationStack) await exec(productMigration(file));
  onStage('current unified schema ready');
  // Bulk source loading is setup, not importer throughput. Restore identical indexes before measurements.
  const seededSourceTables = ['explore_salon_documents', 'salon_profile_updates', 'salon_profile_looks', 'salon_directory_listings', 'salon_profile_media_assets'];
  for (const table of seededSourceTables) await exec(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
  const indexes = (await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='explore_salon_documents' AND indexname<>'explore_salon_documents_pkey'")).rows;
  for (const index of indexes) await exec(`DROP INDEX public."${index.indexname.replaceAll('"', '""')}"`);
  await db.query(`INSERT INTO locations(id,name)
    SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      CASE WHEN n%10000=0 THEN 'King Nails' WHEN n%10000=1 THEN 'Angel Beauty' ELSE 'Directory Nails '||n END
    FROM generate_series(1,$1::int)n`, [scale]);
  await exec('INSERT INTO salon_settings(salon_id) SELECT id FROM locations');
  await exec(`INSERT INTO explore_salon_documents(salon_id,salon_name,city,state,state_code,city_search,postal_code,country,
    latitude,longitude,profile_completeness,service_categories,service_names,service_category_search_text,service_search_text,
    created_at,public_discovery_published_at,has_public_profile,starting_price,salon_name_search,search_document,location_search_text,active_service_count)
    SELECT id,name,CASE n%4 WHEN 0 THEN 'Milwaukee' WHEN 1 THEN 'Madison' WHEN 2 THEN 'Green Bay' ELSE 'Los Angeles' END,
      CASE WHEN n%4=3 THEN 'CA' ELSE 'WI' END,CASE WHEN n%4=3 THEN 'CA' ELSE 'WI' END,
      CASE n%4 WHEN 0 THEN 'milwaukee' WHEN 1 THEN 'madison' WHEN 2 THEN 'green bay' ELSE 'los angeles' END,
      CASE n%4 WHEN 0 THEN '53202' WHEN 1 THEN '53703' WHEN 2 THEN '54301' ELSE '90001' END,'US',
      CASE WHEN n%4=0 THEN 43.0389+(n%1000)/100000.0 WHEN n%80=1 THEN 43.0731+(n%1000)/100000.0 WHEN n%4=3 THEN 34.0522 ELSE NULL END,
      CASE WHEN n%4=0 THEN -87.9065+(n%1000)/100000.0 WHEN n%80=1 THEN -89.4012+(n%1000)/100000.0 WHEN n%4=3 THEN -118.2437 ELSE NULL END,
      10+(n%90),ARRAY[CASE WHEN n%5=0 THEN 'hair' ELSE 'nails' END],
      ARRAY[CASE WHEN n%5=0 THEN 'Balayage hair color' ELSE 'Gel manicure dip powder pedicure' END],
      CASE WHEN n%5=0 THEN 'hair' ELSE 'nails' END,
      CASE WHEN n%5=0 THEN 'balayage hair color' ELSE 'gel manicure dip powder pedicure nails' END,
      '2026-01-01'::timestamptz,'2026-01-01'::timestamptz,true,25+(n%75),lower(name),
      lower(name)||' gel manicure dip powder pedicure nails balayage hair color',
      CASE n%4 WHEN 0 THEN 'milwaukee wi 53202' WHEN 1 THEN 'madison wi 53703' WHEN 2 THEN 'green bay wi 54301' ELSE 'los angeles ca 90001' END,1
    FROM (SELECT id,name,right(id::text,12)::int n FROM locations) source`);
  onStage('source documents inserted');
  for (const index of indexes) await exec(index.indexdef);
  await exec(`INSERT INTO salon_profile_updates(id,salon_id,title,caption,status,published_at)
      SELECT salon_id,salon_id,'Welcome to '||salon_name,'Local nail salon offering manicure and pedicure','published','2026-01-01' FROM explore_salon_documents;
    INSERT INTO salon_directory_listings(salon_id,reference_post_id,claim_state) SELECT salon_id,salon_id,'unclaimed' FROM explore_salon_documents;
    INSERT INTO services(id,salon_id,name,category,base_price,duration_minutes)
      SELECT salon_id,salon_id,service_names[1],service_categories[1],starting_price,45 FROM explore_salon_documents;
    `);
  // ~5.3% of salons have two organic posts: ~9.5% of all source posts are organic.
  // A twenty-post salon exercises capped activity quality and repeated source history.
  await exec(`INSERT INTO salon_profile_looks(id,salon_id,title,caption,media_path,status,published_at)
    SELECT post_id,salon_id,CASE WHEN k%2=1 THEN 'Red almond cat eye' ELSE 'Dip powder gel manicure' END,
      CASE WHEN k%2=1 THEN 'Red almond cat eye French nail design' ELSE 'Dip powder gel manicure pedicure service' END,
      salon_id::text||'/looks/'||post_id::text||'/fixture.webp','published',now()-make_interval(days=>(n%30)::int)
    FROM (SELECT salon_id,right(salon_id::text,12)::bigint n FROM explore_salon_documents) d
    CROSS JOIN LATERAL generate_series(1,CASE WHEN n=4 THEN 20 ELSE 2 END) k
    CROSS JOIN LATERAL(SELECT ('10000000-0000-4000-8000-'||lpad((n*100+k)::text,12,'0'))::uuid post_id) p
    WHERE n%19=0 OR n=4;
    INSERT INTO salon_profile_media_assets(id,salon_id,object_path,status,purpose,bucket)
      SELECT ('20000000-0000-4000-8000-'||right(id::text,12))::uuid,salon_id,media_path,'active','look','salon-profile-media' FROM salon_profile_looks;
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`);
  for (const table of seededSourceTables) await exec(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
  const historyIndexes = (await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('explore_unified_salon_history','explore_unified_content_history') AND indexname NOT LIKE '%_pkey'")).rows;
  if ((await db.query('SELECT (SELECT count(*) FROM explore_unified_salon_history)+(SELECT count(*) FROM explore_unified_content_history) AS n')).rows[0].n !== '0') throw new Error('Fixture bulk source load unexpectedly fired projection triggers.');
  for (const index of historyIndexes) await exec(`DROP INDEX public."${index.indexname.replaceAll('"', '""')}"`);
  onStage('source indexes/triggers restored; synthetic final read-model bulk seed (exact product fingerprints, no legacy refresh coordinator)');
  // The measured request path is exact product SQL. Setup deliberately bypasses the old
  // all-ID refresh coordinator and historical upgrades; trigger semantics have separate tests.
  await exec(`UPDATE explore_unified_search_clock SET revision=1 WHERE id;
    INSERT INTO explore_unified_salon_incarnations(salon_id) SELECT salon_id FROM explore_salon_documents;
    INSERT INTO explore_unified_salon_history
      SELECT d.salon_id,1,NULL,NULL,i.source_token,explore_unified_salon_fingerprint(d),coalesce(d.salon_name_search,''),coalesce(d.service_search_text,''),coalesce(d.service_category_search_text,''),
        d.state_code,d.city_search,d.postal_code,d.latitude,d.longitude,coalesce(d.profile_completeness,0),d.created_at,d.public_discovery_published_at,d.starting_price,
        explore_unified_has_real_cover(d),explore_unified_profile_text(d),regexp_replace(coalesce(d.phone,''),'[^0-9]','','g'),d.address_line1,d.address_line2,d.city
      FROM explore_salon_documents d JOIN explore_unified_salon_incarnations i USING(salon_id);
    INSERT INTO explore_unified_content_incarnations(content_key,salon_id) SELECT content_key,salon_id FROM explore_unified_content_source;
    INSERT INTO explore_unified_content_history
      SELECT c.content_key,1,NULL,NULL,i.source_token,md5(jsonb_build_array(c.salon_id,c.source_type,c.content_id,c.author_user_id,c.published_at,c.is_reference,c.search_terms,c.has_real_media)::text),
        c.salon_id,c.source_type,c.content_id,c.author_user_id,c.published_at,c.is_reference,c.search_terms,c.has_real_media
      FROM explore_unified_content_source c JOIN explore_unified_content_incarnations i USING(content_key,salon_id);`);
  for (const index of historyIndexes) await exec(index.indexdef);
  onStage('exact secondary projection indexes restored');
  await exec('ANALYZE');
  onStage('fixture ready');
}
