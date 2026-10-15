import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {cube} from '@electric-sql/pglite/contrib/cube';
import {earthdistance} from '@electric-sql/pglite/contrib/earthdistance';
import {verifyRankedSearch} from './fixtures/explore-ranked-search-verification.mjs';
export const rankStack=['20261009052031_explore_search_sessions.sql','20261009062031_explore_booking_rank_gate.sql','20261009064031_explore_region_index_predicates.sql','20261009065531_explore_session_publication_cutoff.sql','20261009071031_explore_candidate_seek_paths.sql','20261009123031_explore_gps_address_context.sql','20261009125031_explore_negative_fuzzy_guard.sql','20261009126031_explore_ranked_search.sql','20261009129032_explore_rank_safe_update.sql','20261009129033_explore_rank_batch_proof.sql'];
test('canonical ranked SQL freezes real revisions, seeks beyond UUID256 and honors live gates',{timeout:120000},async()=>{
 const db=new PGlite({extensions:{pg_trgm,cube,earthdistance}});
 try{
  await db.exec(readFileSync('tests/fixtures/explore-search-session-bootstrap.sql','utf8'));
  await db.exec('CREATE TABLE public.services(id uuid PRIMARY KEY,salon_id uuid,is_active boolean,online_booking_enabled boolean);CREATE TABLE public.pos_tickets(id uuid PRIMARY KEY,salon_id uuid,status text,closed_at timestamptz);CREATE INDEX pos_rank_fixture_idx ON public.pos_tickets(salon_id);');
  for(const file of rankStack)await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  await verifyRankedSearch(db);
 }finally{await db.close();}
});
