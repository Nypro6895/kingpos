import { verifyNegativeFuzzyGuard } from './fixtures/explore-negative-fuzzy-verification.mjs';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { cube } from '@electric-sql/pglite/contrib/cube';
import { earthdistance } from '@electric-sql/pglite/contrib/earthdistance';

const priorMigrations = ['20261009052031_explore_search_sessions.sql','20261009062031_explore_booking_rank_gate.sql','20261009064031_explore_region_index_predicates.sql','20261009065531_explore_session_publication_cutoff.sql','20261009071031_explore_candidate_seek_paths.sql','20261009123031_explore_gps_address_context.sql'];


test('global negative fuzzy guard preserves exact, partial, service, positive fuzzy and current-public cursor behavior',{timeout:120000},async()=>{
 const db=new PGlite({extensions:{pg_trgm,cube,earthdistance}});
 try{
  await db.exec(readFileSync('tests/fixtures/explore-search-session-bootstrap.sql','utf8'));
  for(const file of priorMigrations)await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec(readFileSync('tests/fixtures/explore-negative-fuzzy-guard.sql','utf8'));
  await verifyNegativeFuzzyGuard(db);
 }finally{await db.close();}
});
