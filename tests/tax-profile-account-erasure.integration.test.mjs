import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { authId, personId, seedPerson, taxErasureFixture, taxErasureMigration } from './helpers/tax-erasure-fixture.mjs';

const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const finalise = async (db, n) => (await one(db, 'select finalize_account_deletion($1) result', [personId(n)])).result;
const businessTables = ['tax_documents', 'tax_messages', 'tax_events', 'payroll_staff_lines', 'pos_payments'];
const businessSnapshot = async db => Object.fromEntries(await Promise.all(businessTables.map(async table => [table, (await db.query(`select to_jsonb(t) row from ${table} t order by id`)).rows])));
async function seedBusiness(db, n) {
  const id = personId(n);
  await db.query('insert into locations values($1)', [personId(90)]);
  await db.query('insert into staff(id) values($1)', [personId(91)]);
  await db.query('insert into payroll_runs values($1)', [personId(92)]);
  await db.query("insert into payroll_staff_lines values($1,'Retained legal name',1234.56)", [personId(93)]);
  await db.query("insert into pos_payments values($1,75,'Keep business receipt')", [personId(94)]);
  await db.query(`insert into tax_documents(salon_id,staff_id,recipient_user_id,payroll_run_id,kind,title,file_name,path,mime_type,size_bytes,uploaded_by,uploaded_role)
 values($1,$2,$3,$4,'paystub','Retained paystub','paystub.pdf','salon/retained.pdf','application/pdf',42,$3,'tax')`, [personId(90),personId(91),id,personId(92)]);
  await db.query("insert into tax_messages(salon_id,author_id,author_name,body) values($1,$2,'Business author','Keep business message')", [personId(90),id]);
  await db.query("insert into tax_events(salon_id,actor_id,actor_name,action,detail) values($1,$2,'Business actor','document_added','{\"business\":true}')", [personId(90),id]);
  await db.query("insert into storage.objects values('payroll-paystubs','salon/retained.pdf',$1::uuid,($1::uuid)::text)", [authId(n)]);
}

test('future due erasure removes only the personal Tax profile, composes Forum and preserves business records', async () => {
  const db = await taxErasureFixture({ apply: false });
  try {
    await seedPerson(db, 1); await seedPerson(db, 2, 'active');
    await seedPerson(db, 3, 'pending_deletion', false); await seedPerson(db, 4, 'active');
    await seedPerson(db, 5, 'deleted');
    await db.query('update users set anonymized_at=now(),deletion_finalized_at=now() where id=$1', [personId(5)]);
    await db.query("insert into account_erasure_jobs(user_id,status,completed_at) values($1,'complete',now())", [personId(5)]);
    await db.query("insert into forum_topics(id,author_id,title,body,state) values($1,$1,'Erase title','Erase topic','WI'),($2,$2,'Keep title','Keep topic','IL')", [personId(1),personId(2)]);
    await seedBusiness(db, 1);
    const business = await businessSnapshot(db);
    await db.exec(taxErasureMigration);
    assert.equal((await one(db, 'select count(*)::int count from tax_profiles')).count, 5, 'installing the migration performs no historical sweep');
    assert.equal((await finalise(db, 3)).reason, 'not_due');
    assert.equal((await finalise(db, 4)).reason, 'not_pending_deletion');
    await db.exec("set test.unresolved='1'");
    assert.equal((await finalise(db, 1)).reason, 'ownership_unresolved');
    assert.equal((await one(db, 'select count(*)::int count from tax_profiles where user_id=$1', [personId(1)])).count, 1);
    await db.exec("set test.unresolved='0'");
    assert.equal((await finalise(db, 1)).ok, true);
    assert.deepEqual((await db.query('select user_id from tax_profiles order by user_id')).rows.map(row => row.user_id), [2,3,4,5].map(personId));
    assert.equal((await one(db, 'select body from forum_topics where id=$1', [personId(1)])).body, '[Deleted]');
    assert.equal((await one(db, 'select body from forum_topics where id=$1', [personId(2)])).body, 'Keep topic');
    assert.deepEqual(await businessSnapshot(db), business);
    assert.equal((await one(db, "select count(*)::int count from storage.objects where bucket_id='payroll-paystubs'")).count, 1);
    assert.equal((await one(db, 'select deletion_finalized_at from users where id=$1', [personId(1)])).deletion_finalized_at, null, 'SQL scrubbing is not final provider completion');
    assert.equal((await finalise(db, 1)).changed, false);
    assert.equal((await finalise(db, 5)).changed, false, 'completed historical account stays outside this change');
  } finally { await db.close(); }
});

test('queued jobs created before installation scrub at the leased checkpoint, and completion refuses residual profile data', async () => {
  const db = await taxErasureFixture({ apply: false });
  try {
    await seedPerson(db, 1); await seedPerson(db, 2, 'deleted');
    assert.equal((await finalise(db, 1)).ok, true);
    assert.equal((await one(db, 'select count(*)::int count from tax_profiles where user_id=$1', [personId(1)])).count, 1, 'reproduces the pre-migration queued-job gap');
    await db.query("update users set anonymized_at=now(),deletion_finalized_at=now() where id=$1", [personId(2)]);
    await db.query("insert into account_erasure_jobs(user_id,status,completed_at) values($1,'complete',now())", [personId(2)]);
    await db.exec(taxErasureMigration);
    assert.equal((await finalise(db, 1)).changed, false);
    const job = (await one(db, 'select claim_account_erasure() result')).result;
    await assert.rejects(db.query('select finish_account_erasure($1,$2)', [personId(1),job.lease]), /Tax profile erasure is incomplete/);
    await assert.rejects(db.query('select account_erasure_batch($1,$2)', [personId(1),authId(50)]), /lease expired/i);
    await db.exec("select set_config('reylumi.account_erasure_user','marker-before-batch',false)");
    assert.deepEqual((await one(db, 'select account_erasure_batch($1,$2) result', [personId(1),job.lease])).result, []);
    assert.equal((await one(db, "select current_setting('reylumi.account_erasure_user') marker")).marker, 'marker-before-batch');
    assert.equal((await one(db, 'select count(*)::int count from tax_profiles where user_id=$1', [personId(1)])).count, 0);
    assert.equal((await one(db, 'select count(*)::int count from tax_profiles where user_id=$1', [personId(2)])).count, 1, 'completed historical account is deliberately untouched');
    await db.query('delete from auth.users where id=$1', [authId(1)]);
    await db.query('select finish_account_erasure($1,$2)', [personId(1),job.lease]);
    assert.equal((await one(db, 'select status from account_erasure_jobs where user_id=$1', [personId(1)])).status, 'complete');
  } finally { await db.close(); }
});

test('Tax delete failures roll back future finalization, preserve identity/Forum and remain retryable', async () => {
  const db = await taxErasureFixture();
  try {
    await seedPerson(db, 1);
    await db.query("insert into forum_topics(id,author_id,title,body) values($1,$1,'Keep on failure','Do not partially scrub')", [personId(1)]);
    await db.exec("create function fail_tax_delete() returns trigger language plpgsql as $$begin raise exception 'synthetic Tax scrub failure';end$$;create trigger fail_tax_delete before delete on tax_profiles for each row execute function fail_tax_delete();");
    const result = await finalise(db, 1);
    assert.equal(result.ok, false); assert.match(result.reason, /synthetic Tax scrub failure/);
    const user = await one(db, 'select status,email,auth_user_id from users where id=$1', [personId(1)]);
    assert.equal(user.status, 'pending_deletion'); assert.equal(user.email, 'person1@example.test'); assert.equal(user.auth_user_id, authId(1));
    assert.equal((await one(db, 'select body from forum_topics')).body, 'Do not partially scrub');
    assert.equal((await one(db, 'select count(*)::int count from account_erasure_jobs')).count, 0);
    await db.exec('drop trigger fail_tax_delete on tax_profiles');
    assert.equal((await finalise(db, 1)).ok, true);
  } finally { await db.close(); }
});

test('migration replay preserves original RPC ACLs and private helpers reject early or unauthorized calls', async () => {
  const db = await taxErasureFixture({ apply: false });
  try {
    const signatures = ['erase_account_personal_content(uuid,uuid)', 'account_erasure_batch(uuid,uuid)', 'finish_account_erasure(uuid,uuid,text)', 'tax_save_profile(text,text,text,text)'];
    const acls = async () => (await db.query('select oid::regprocedure::text signature,proacl::text acl from pg_proc where oid=any($1::regprocedure[]) order by signature', [signatures])).rows;
    const before = await acls();
    await db.exec(taxErasureMigration); await db.exec(taxErasureMigration);
    assert.deepEqual(await acls(), before);
    await seedPerson(db, 1, 'pending_deletion', false);
    await assert.rejects(db.query('select erase_tax_personal_profile($1)', [personId(1)]), /Due account erasure/);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec(`set role ${role}`);
      for (const [sql, args] of [
        ['select erase_tax_personal_profile($1)', [personId(1)]],
        ['select erase_tax_profile_for_leased_job($1,$2)', [personId(1),authId(1)]],
        ['select tax_profile_active_actor()', []],
      ]) await assert.rejects(db.query(sql, args), /permission denied/);
      await db.exec('reset role');
    }
    await db.query("select set_config('test.uid',$1,false)", [personId(1)]);
    await assert.rejects(db.query("select tax_save_profile('Changed','changed@example.test','','')"), /active Reylumi account/);
    await db.query("update users set status='active' where id=$1", [personId(1)]);
    await db.exec('set role authenticated');
    assert.equal((await one(db, "select tax_save_profile('Changed','changed@example.test','','') result")).result.display_name, 'Changed');
  } finally { await db.close(); }
});

test('an unknown erasure body aborts migration atomically rather than installing a partial hook', async () => {
  const db = await taxErasureFixture({ apply: false });
  try {
    await db.exec("create or replace function account_erasure_batch(p_user_id uuid,p_lease uuid) returns jsonb language plpgsql security definer as $$begin return '[]';end$$");
    const before = (await one(db, "select pg_get_functiondef('erase_account_personal_content(uuid,uuid)'::regprocedure) body")).body;
    await assert.rejects(db.exec(taxErasureMigration), /Erasure batch source changed/);
    await db.exec('rollback');
    assert.equal((await one(db, "select to_regprocedure('erase_tax_personal_profile(uuid)') helper")).helper, null);
    assert.equal((await one(db, "select pg_get_functiondef('erase_account_personal_content(uuid,uuid)'::regprocedure) body")).body, before);
  } finally { await db.close(); }
});

test('actual worker cannot delete Auth or mark completion after a queued Tax scrub fails', async () => {
  const db = await taxErasureFixture({ apply: false });
  try {
    await seedPerson(db, 1); await finalise(db, 1); await db.exec(taxErasureMigration);
    await db.exec("create function fail_tax_delete() returns trigger language plpgsql as $$begin raise exception 'synthetic Tax scrub failure';end$$;create trigger fail_tax_delete before delete on tax_profiles for each row execute function fail_tax_delete();");
    const built = await build({ entryPoints:['lib/account-erasure-worker.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':path.resolve('.')},plugins:[{name:'external-providers',setup(api){api.onResolve({filter:/^(server-only|@supabase\/supabase-js|\.\/support-email)$/},a=>({path:a.path,namespace:'stub'}));api.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export function createClient(){} export function getSupportEmailConfig(){} export function sendSupportEmail(){}'}));}}] });
    const { processAccountErasure } = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
    const calls=[];
    const client={ async rpc(name,args){calls.push(name);try {return {data:(await one(db,`select ${name}(${Object.keys(args).map((key,i)=>`${key} => $${i+1}`).join(',')}) result`,Object.values(args))).result};}catch(error){return {error};}},
      storage:{from(){return {async remove(){calls.push('storage.remove');return {error:null};}};}},
      auth:{admin:{async deleteUser(id){calls.push('auth.deleteUser');await db.query('delete from auth.users where id=$1',[id]);return {error:null};}}} };
    let job=(await one(db,'select claim_account_erasure() result')).result;
    assert.equal(await processAccountErasure(client,job,Date.now()+10000),false);
    assert.equal(calls.includes('auth.deleteUser'),false); assert.equal(calls.includes('storage.remove'),false);
    assert.equal((await one(db,'select status from account_erasure_jobs')).status,'pending');
    assert.equal((await one(db,'select count(*)::int count from auth.users')).count,1);
    await db.exec('drop trigger fail_tax_delete on tax_profiles;update account_erasure_jobs set next_attempt_at=now()');
    job=(await one(db,'select claim_account_erasure() result')).result;
    assert.equal(await processAccountErasure(client,job,Date.now()+10000),true);
    assert.equal((await one(db,'select status from account_erasure_jobs')).status,'complete');
    assert.equal((await one(db,'select count(*)::int count from tax_profiles')).count,0);
  } finally { await db.close(); }
});
