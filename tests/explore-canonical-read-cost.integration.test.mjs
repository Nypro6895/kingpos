import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const databaseUrl=process.env.EXPLORE_CANONICAL_TEST_DATABASE_URL;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const read=file=>readFileSync(file,'utf8');
const code={exports:{}};
vm.runInNewContext(ts.transpileModule(read('lib/reylumi-trust.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:code.exports,module:code,Intl});

test('canonical selected RPCs preserve LUMI v2 evidence and protect the operating runner', {skip:!databaseUrl,timeout:60000}, async()=>{
 const endpoint=new URL(databaseUrl);
 assert.ok(['127.0.0.1','localhost'].includes(endpoint.hostname)&&endpoint.pathname==='/explore_load_canonical','refuse all remote, production or shared benchmark databases');
 const {Pool}=createRequire(path.resolve('work/explore-load-runtime/package.json'))('pg');
 const db=new Pool({connectionString:databaseUrl,max:1});
 try {
  await db.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await db.query(read('tests/fixtures/explore-canonical-bootstrap.sql'));
  await db.query(read('supabase/migrations/202610050001_lumi_trust_return_evidence.sql'));
  await db.query('ALTER FUNCTION public.get_public_lumi_trust_signals(uuid[]) RENAME TO get_public_lumi_trust_signals_reference');
  await db.query(read('supabase/migrations/20261009093031_explore_operating_public_runner.sql'));
  await db.query(read('supabase/migrations/20261009094031_lumi_trust_selected_read_cost.sql'));
  await db.query('BEGIN');
  for(let n=1;n<=6;n++){
   await db.query("INSERT INTO locations VALUES($1,$2,$3,$4,now()-interval '2 days')",[id(n),id(100+n),`Shop${n}`,n===4?'permanently_closed':'active']);
   await db.query("INSERT INTO salon_settings VALUES($1,$2,CASE WHEN $3 THEN now()+interval '1 day' ELSE now()-interval '1 day' END,$4)",[id(n),n!==3,n===2,n===5?'Invalid/Zone':n===6?'Pacific/Apia':'America/Chicago']);
  }
  await db.query("INSERT INTO locations VALUES($1,$2,'Future created','active',now()+interval '1 day');",[id(7),id(107)]);
  await db.query("INSERT INTO salon_settings VALUES($1,true,now()-interval '1 day','America/Chicago')",[id(7)]);
  await db.query('INSERT INTO salon_operating_hours VALUES($1,$2,1,\'09:00\',\'17:00\',0,true),($3,$2,2,\'09:00\',\'17:00\',1,false)',[id(300),id(1),id(301)]);
  await db.query("INSERT INTO salon_special_hours VALUES($1,$2,current_date,'closed',NULL,NULL,'Today',true),($3,$2,current_date+60,'closed',NULL,NULL,'Future',true)",[id(310),id(1),id(311)]);
  for(const role of ['anon','authenticated','service_role']){
   await db.query(`SET LOCAL ROLE ${role}`);
   const visible=(await db.query('SELECT * FROM get_public_salon_operating_status_inputs($1)',[[id(1),id(2),id(3),id(4),id(7)]])).rows;
   assert.deepEqual(visible.map(r=>r.salon_id).sort(),[id(1),id(4)]);
   assert.equal(visible.find(r=>r.salon_id===id(1)).weekly_hours.length,1);
   assert.equal(visible.find(r=>r.salon_id===id(1)).special_hours.length,1);
   assert.equal((await db.query('SELECT * FROM get_public_salon_operating_status_inputs($1)',[Array.from({length:51},()=>id(1))])).rows.length,0);
   assert.equal((await db.query('SELECT * FROM get_public_salon_operating_status_inputs($1)',[[]])).rows.length,0);
   assert.equal((await db.query('SELECT * FROM get_public_salon_operating_status_inputs(NULL)')).rows.length,0);
   await db.query('RESET ROLE');
  }
  assert.equal((await db.query("SELECT has_table_privilege('anon','lumi_trust_time_zone_names','select') AS value")).rows[0].value,false);
  assert.equal((await db.query("SELECT has_function_privilege('anon','refresh_lumi_trust_time_zone_names()','execute') AS value")).rows[0].value,false);
  assert.equal((await db.query('SELECT count(*)::int AS value FROM lumi_trust_time_zone_names')).rows[0].value,(await db.query('SELECT count(*)::int AS value FROM pg_timezone_names')).rows[0].value);

  for(let n=1;n<=45;n++)await db.query('INSERT INTO customers VALUES($1,$2,$3)',[id(1000+n),id(n>40?5:1),n===40?null:id(2000+Math.ceil(n/2))]);
  await db.query("INSERT INTO salon_memberships VALUES($1,$2,'inactive')",[id(1),id(2001)]);
  await db.query("INSERT INTO account_memberships VALUES($1,$2,'active')",[id(101),id(2002)]);
  await db.query('INSERT INTO staff VALUES($1,$2,$3,NULL),($4,$2,NULL,$5)',[id(4000),id(1),id(2003),id(4001),id(2004)]);
  // Old lifetime history, same-person customer aliases, split local-day tickets,
  // young/fully matured cohorts, free corrections, outsiders and all feedback states.
  for(let n=1;n<=720;n++){
   const customer=n%45+1,shop=customer>40?5:1,days=n%601,closed=n%47===0?null:days===0?"now()+interval '1 day'":`now()-interval '${days} days'-interval '${n%24} hours'`;
   await db.query(`INSERT INTO pos_tickets VALUES($1,$2,$3,$4,${closed??'NULL'})`,[id(5000+n),id(shop),id(1000+customer),n%43===0?'void':n%29===0?'cancelled':'closed']);
   await db.query('INSERT INTO pos_ticket_items VALUES($1,$2,$3,$4)',[id(6000+n),id(5000+n),id(shop),n%17===0?0:n%31===0?-5:35]);
   if(n%3===0)await db.query("INSERT INTO customer_visit_experiences VALUES($1,$2,$3,$4,$5,$6,'resolved',now()-interval '1 minute')",[id(7000+n),id(5000+n),id(shop),id(1000+customer),n%19===0?id(2999):id(2000+Math.ceil(customer/2)),n%2===0?'issue':'good']);
  }
  // Exact evidence keeps the first valid ticket of a local day at window boundaries.
  await db.query("INSERT INTO pos_tickets VALUES($1,$2,$3,'closed',now()-interval '100 days'),($4,$2,$3,'closed',now()-interval '10 days'),($5,$2,$3,'closed',now()-interval '10 days'+interval '1 minute')",[id(9001),id(1),id(1011),id(9002),id(9003)]);
  for(const ticket of [9001,9002,9003])await db.query('INSERT INTO pos_ticket_items VALUES($1,$2,$3,40)',[id(9100+ticket),id(ticket),id(1)]);
  await db.query("INSERT INTO pos_tickets VALUES($1,$2,$3,'closed','2026-03-08 07:30:00+00'),($4,$2,$3,'closed','2026-03-08 08:30:00+00')",[id(9201),id(1),id(1013),id(9202)]);
  for(const ticket of [9201,9202])await db.query('INSERT INTO pos_ticket_items VALUES($1,$2,$3,40)',[id(9100+ticket),id(ticket),id(1)]);
  const requested=[id(1),id(3),id(5),id(6)];
  const before=(await db.query('SELECT * FROM get_public_lumi_trust_signals_reference($1) ORDER BY salon_id',[requested])).rows;
  const after=(await db.query('SELECT * FROM get_public_lumi_trust_signals($1) ORDER BY salon_id',[requested])).rows;
  assert.deepEqual(after,before,'all lifetime/window/local-day/independent-customer evidence must remain exact');
  const evidence=row=>({ruleVersion:row.rule_version,asOf:row.as_of.toISOString(),feedbackDays:row.feedback_days,returnDays:row.return_days,cohortDays:row.cohort_days,
   verifiedVisitCount:Number(row.verified_visit_count),uniqueVisitorCount:Number(row.unique_visitor_count),feedbackCustomerCount:Number(row.feedback_customer_count),goodFeedbackCount:Number(row.good_feedback_count),issueFeedbackCount:Number(row.issue_feedback_count),eligibleReturnCustomerCount:Number(row.eligible_return_customer_count),returningCustomerCount:Number(row.returning_customer_count)});
  for(let n=0;n<before.length;n++){
   const summary=row=>code.exports.buildReylumiTrustSummary({trustEvidence:evidence(row),averageRating:null,noIssueRate:null,sharedExperienceCount:0,uniqueCustomerCount:0,verifiedVisitCount:0});
   assert.deepEqual(JSON.parse(JSON.stringify(summary(after[n]))),JSON.parse(JSON.stringify(summary(before[n]))),'canonical trust level/score/facts remain unchanged');
  }
  assert.ok(Number(after.find(r=>r.salon_id===id(1)).verified_visit_count)>Number(after.find(r=>r.salon_id===id(1)).unique_visitor_count),'lifetime evidence was not clipped to the cohort');
  assert.equal(after.some(r=>r.salon_id===id(3)),false);
  await db.query('ROLLBACK');
 }finally{await db.end();}
});
