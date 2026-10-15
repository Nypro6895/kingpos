import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedRankFixture,id} from './explore-ranked-search-verification.mjs';
export const safeUpdateCorrection='20261009129032_explore_rank_safe_update.sql';
export async function verifyRankSafeUpdate(db,{transactional=false,optimizeBatch=false}={}){
 await seedRankFixture(db,100);
 if(optimizeBatch)await db.query("INSERT INTO public.pos_tickets VALUES($1,$2,'closed',now()+interval '1 day')",[id(10000),id(1)]);
 await db.exec(`CREATE FUNCTION public.explore_fixture_safe_update() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE context text;BEGIN
 GET DIAGNOSTICS context=PG_CONTEXT;
 IF context ~* 'UPDATE public\\.explore_search_rank_clock SET revision=revision\\+1,as_of=now\\(\\) RETURNING' THEN
  RAISE EXCEPTION 'UPDATE requires a WHERE clause' USING ERRCODE='21000';
 END IF;RETURN NULL;END $$;
 CREATE TRIGGER explore_fixture_safe_update BEFORE UPDATE ON public.explore_search_rank_clock FOR EACH STATEMENT EXECUTE FUNCTION public.explore_fixture_safe_update();`);
 const identity=(await db.query("SELECT 'public.publish_explore_search_rank_jobs(jsonb)'::regprocedure::oid::int oid,has_function_privilege('anon','public.publish_explore_search_rank_jobs(jsonb)','execute') anon,has_function_privilege('service_role','public.publish_explore_search_rank_jobs(jsonb)','execute') service")).rows[0];
 const jobs=(await db.query('SELECT * FROM public.claim_explore_search_rank_jobs(100)')).rows;assert.equal(jobs.length,100);
 const payload=jobs.map(j=>({...j,rule_version:'lumi-trust-v2',evidence_as_of:new Date().toISOString(),trust_score:0,empty_evidence:true,bookable:false}));
 if(transactional)await db.query('SAVEPOINT production_protection');
 await assert.rejects(()=>db.query('SELECT public.publish_explore_search_rank_jobs($1::jsonb) result',[JSON.stringify(payload)]),error=>error.code==='21000'&&/WHERE clause/.test(error.message));
 if(transactional)await db.query('ROLLBACK TO SAVEPOINT production_protection');
 assert.equal(Number((await db.query('SELECT revision FROM public.explore_search_rank_clock WHERE singleton=true')).rows[0].revision),0,'failed singleton update must leave revision/cache unchanged');
 await db.exec(readFileSync('supabase/migrations/'+safeUpdateCorrection,'utf8'));
 if(optimizeBatch){
  await db.exec(readFileSync('supabase/migrations/20261009129033_explore_rank_batch_proof.sql','utf8'));
  const oldPolicy=(await db.query("SELECT pg_get_functiondef('public.get_explore_rank_refresh_policy(uuid[])'::regprocedure) definition")).rows[0].definition;
  await db.exec(oldPolicy.replace('CREATE OR REPLACE FUNCTION public.get_explore_rank_refresh_policy','CREATE FUNCTION public.explore_fixture_rank_policy_core'));
  await db.exec(`CREATE TABLE public.explore_fixture_rank_policy_calls(batch_size integer);
   CREATE OR REPLACE FUNCTION public.get_explore_rank_refresh_policy(p_ids uuid[]) RETURNS TABLE(salon_id uuid,may_skip_decay boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
   BEGIN INSERT INTO public.explore_fixture_rank_policy_calls VALUES(cardinality(p_ids));RETURN QUERY SELECT * FROM public.explore_fixture_rank_policy_core(p_ids);END $$;`);
 }

 const result=(await db.query('SELECT public.publish_explore_search_rank_jobs($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;assert.equal(result.published,100);assert.equal(result.rankVersion,1);
 assert.equal(Number((await db.query('SELECT revision FROM public.explore_search_rank_clock WHERE singleton=true')).rows[0].revision),1,'one batch advances once, not once per shop');
 assert.equal(Number((await db.query('SELECT count(*) n FROM public.explore_search_rank_sources WHERE ready')).rows[0].n),100);
 assert.equal(Number((await db.query('SELECT count(*) n FROM public.explore_search_rank_jobs')).rows[0].n),0);
 const after=(await db.query("SELECT 'public.publish_explore_search_rank_jobs(jsonb)'::regprocedure::oid::int oid,has_function_privilege('anon','public.publish_explore_search_rank_jobs(jsonb)','execute') anon,has_function_privilege('service_role','public.publish_explore_search_rank_jobs(jsonb)','execute') service")).rows[0];assert.deepEqual(after,identity);assert.equal(after.anon,false);assert.equal(after.service,true);
 if(optimizeBatch){
  assert.deepEqual((await db.query('SELECT batch_size FROM public.explore_fixture_rank_policy_calls')).rows,[{batch_size:100}],'raw-ticket no-decay proof is executed once for the accepted batch');
  assert.ok((await db.query('SELECT refresh_after FROM public.explore_search_rank_sources WHERE salon_id=$1',[id(1)])).rows[0].refresh_after,'future closed ticket requires decay despite zero payload');
  assert.equal(Number((await db.query('SELECT count(*) n FROM public.explore_search_rank_sources WHERE refresh_after IS NULL')).rows[0].n),99);
 }
 return {published:result.published,rankVersion:result.rankVersion,oidPreserved:true,aclPreserved:true,guardReproducedCode:'21000'};
}
