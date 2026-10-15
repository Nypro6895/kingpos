import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const schedulerMigration='supabase/migrations/20261009129031_explore_ranking_scheduler.sql';
export const schedulerBootstrap='tests/fixtures/explore-ranking-scheduler-bootstrap.sql';
const id=n=>`12900000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export async function verifyRankingScheduler(db) {
 const wake=async()=>(await db.query('SELECT public.wake_explore_search_rank_worker() request_id')).rows[0].request_id;
 const requests=async()=>Number((await db.query('SELECT count(*) count FROM net.requests')).rows[0].count);
 const reset=async()=>db.exec('TRUNCATE net.requests,public.explore_search_rank_jobs,public.explore_search_rank_sources,vault.secrets; UPDATE public.explore_search_rank_scheduler SET enabled=false,last_requested_at=NULL,last_request_id=NULL;');
 const enable=async()=>{await db.query("INSERT INTO vault.secrets(name,secret) VALUES('explore-search-ranking',$1)",['scheduler-test-only-credential-not-a-real-secret']);await db.exec('UPDATE public.explore_search_rank_scheduler SET enabled=true');};
 const job=async({lease=null,leasedAt=null,due="now()"}={})=>db.query(`INSERT INTO public.explore_search_rank_jobs(salon_id,next_attempt_at,lease,leased_at) VALUES($1,${due},$2,${leasedAt??'NULL'})`,[id(1),lease]);
 await reset();assert.equal(await wake(),null);assert.equal(await requests(),0);
 await enable();assert.equal(await wake(),null);assert.equal(await requests(),0,'empty queue must not call the HTTP stub');
 await job({due:"now()+interval '1 minute'"});assert.equal(await wake(),null);assert.equal(await requests(),0,'not-due jobs do not wake');
 await db.exec("UPDATE public.explore_search_rank_jobs SET next_attempt_at=now()");
 const first=await wake();assert.ok(first);assert.equal(await requests(),1);
 const receipt=(await db.query("SELECT url,body,timeout_milliseconds,headers->>'Content-Type' content_type,headers->>'Authorization' LIKE 'Bearer %' has_bearer FROM net.requests")).rows[0];
 assert.deepEqual(receipt,{url:'https://reylumi.com/api/internal/explore-ranking',body:{},timeout_milliseconds:55000,content_type:'application/json',has_bearer:true});
 assert.equal(await wake(),null);assert.equal(await requests(),1,'same-minute overlap is suppressed');
 await db.exec("UPDATE public.explore_search_rank_scheduler SET last_requested_at=now()-interval '54 seconds'");assert.equal(await wake(),null);assert.equal(await requests(),1);
 await db.exec("UPDATE public.explore_search_rank_scheduler SET last_requested_at=now()-interval '56 seconds'");assert.ok(await wake());assert.equal(await requests(),2,'wake resumes after cooldown');
 await reset();await enable();await job({lease:id(2),leasedAt:'now()'});assert.equal(await wake(),null);assert.equal(await requests(),0,'active lease is respected');
 await db.exec("UPDATE public.explore_search_rank_jobs SET leased_at=now()-interval '6 minutes'");assert.ok(await wake());assert.equal(await requests(),1,'expired lease permits a wake');
 await reset();await enable();await db.query('INSERT INTO public.explore_search_rank_sources(salon_id,ready,refresh_after) VALUES($1,true,now())',[id(3)]);assert.ok(await wake());assert.equal(await requests(),1,'due evidence refresh wakes without queue entries');
 await reset();await enable();await db.query('INSERT INTO public.explore_search_rank_sources(salon_id,ready,refresh_after) VALUES($1,false,now())',[id(3)]);assert.equal(await wake(),null);
 await db.exec('UPDATE public.explore_search_rank_sources SET ready=true,refresh_after=NULL');assert.equal(await wake(),null);
 await db.exec("UPDATE public.explore_search_rank_sources SET refresh_after=now()+interval '1 hour'");assert.equal(await wake(),null);assert.equal(await requests(),0);
 await reset();await job();await db.exec('UPDATE public.explore_search_rank_scheduler SET enabled=true');assert.equal(await wake(),null);assert.equal(await requests(),0,'missing private credential does not invoke HTTP');
 await db.query("INSERT INTO vault.secrets(name,secret) VALUES('explore-search-ranking','short')");assert.equal(await wake(),null);assert.equal(await requests(),0,'invalid private credential does not invoke HTTP');
 const grants=(await db.query("SELECT has_function_privilege('anon','public.wake_explore_search_rank_worker()','execute') anon_wake,has_function_privilege('authenticated','public.configure_explore_search_rank_scheduler(text)','execute') auth_config,has_function_privilege('service_role','public.configure_explore_search_rank_scheduler(text)','execute') service_config,has_function_privilege('service_role','public.wake_explore_search_rank_worker()','execute') service_wake,has_table_privilege('anon','public.explore_search_rank_scheduler','select') anon_state,has_table_privilege('authenticated','public.explore_search_rank_scheduler','update') auth_update")).rows[0];
 assert.deepEqual(grants,{anon_wake:false,auth_config:false,service_config:true,service_wake:false,anon_state:false,auth_update:false});
 await db.exec('SET ROLE anon');try{await assert.rejects(()=>db.query('SELECT public.wake_explore_search_rank_worker()'),/permission denied/i);await assert.rejects(()=>db.query("SELECT public.configure_explore_search_rank_scheduler('scheduler-test-only-credential')"),/permission denied/i);await assert.rejects(()=>db.query('SELECT * FROM public.explore_search_rank_scheduler'),/permission denied/i);}finally{await db.exec('RESET ROLE');}
 await assert.rejects(()=>db.query('SELECT public.configure_explore_search_rank_scheduler($1)',[null]),/Invalid scheduler credential/);
 await assert.rejects(()=>db.query('SELECT public.configure_explore_search_rank_scheduler($1)',['short']),/Invalid scheduler credential/);
 // No catalog mutation: isolated PG lacks the real hosted extensions.
 if(!(await db.query("SELECT 1 FROM pg_extension WHERE extname IN ('pg_net','pg_cron')")).rows.length)await assert.rejects(()=>db.query('SELECT public.configure_explore_search_rank_scheduler($1)',['scheduler-test-only-credential-not-a-real-secret']),/extensions are unavailable/);
 const source=readFileSync(schedulerMigration,'utf8');
 assert.match(source,/cron\.schedule\('kingpos-explore-ranking','\* \* \* \* \*','SELECT public\.wake_explore_search_rank_worker\(\);'\)/);
 assert.match(source,/jsonb_build_object\('configured',true,'jobId',job_id\)/);
 assert.match(source,/CREATE TABLE public\.explore_search_rank_scheduler[\s\S]*enabled boolean NOT NULL DEFAULT false/);
 assert.match(source,/vault\.create_secret\(p_secret/);assert.match(source,/vault\.update_secret\(secret_id,p_secret/);
 return {disabledAndNoQueue:true,notDueNoWake:true,dueQueueWake:true,cooldown:true,activeAndExpiredLeases:true,dueRefreshWake:true,missingOrShortCredentialSafe:true,privateGrants:true,noPublicCredentialResponse:true,configExtensionsUnavailableValidated:true};
}
test('actual disabled scheduler helper gates queue, leases, cooldown and private credentials',async()=>{
 const db=new PGlite();try{await db.exec(readFileSync(schedulerBootstrap,'utf8'));await db.exec(readFileSync(schedulerMigration,'utf8'));await verifyRankingScheduler(db);}finally{await db.close();}
});
