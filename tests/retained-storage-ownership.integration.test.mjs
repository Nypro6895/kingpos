import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {taxErasureFixture,seedPerson,personId} from './helpers/tax-erasure-fixture.mjs';

const migration=fs.readFileSync('supabase/migrations/20261116215000_retained_storage_ownership.sql','utf8');
const buckets=['salon-profile-media','pos-display-media','payroll-paystubs','support-evidence'];
async function fixture(){
 const db=await taxErasureFixture();
 try{
  await db.exec(`alter table storage.objects add column metadata jsonb default '{"eTag":"same-bytes","size":10,"mimetype":"application/pdf"}',add column version text default 'v1';
  create function storage.allow_only_operation(expected text) returns boolean language sql stable as $$select current_setting('storage.operation',true)=expected$$;`);
  await seedPerson(db,1);await seedPerson(db,2,'active');
  const user=personId(1),auth=(await db.query('select auth_user_id from users where id=$1',[user])).rows[0].auth_user_id;
  for(const bucket of buckets)await db.query('insert into storage.objects(bucket_id,name,owner,owner_id) values($1,$2,$3::uuid,($3::uuid)::text)',[bucket,'business/record.pdf',auth]);
  await db.exec(migration);
  await db.query('select finalize_account_deletion($1)',[user]);
  const job=(await db.query('select claim_account_erasure() result')).rows[0].result;
  await db.exec(`select set_config('request.jwt.claims','{"role":"service_role"}',false),set_config('storage.operation','object.copy',false)`);
  return {db,user,auth,job};
 }catch(e){await db.close();throw e;}
}
const ownership=async db=>(await db.query('select bucket_id,owner,owner_id,metadata from storage.objects order by bucket_id')).rows;

test('standalone shared migration detaches both owner fields for all four actual retained buckets and keeps strict checkpoints',async()=>{
 const {db,user,auth,job}=await fixture();try{
  const before=await ownership(db);assert.equal(before.length,4);
  for(const bucket of buckets){
   await db.query('update storage.objects set version=\'copied\' where bucket_id=$1',[bucket]);
   await db.query('select finish_account_erasure_object($1,$2,$3,$4)',[user,job.lease,bucket,'business/record.pdf']);
  }
  const after=await ownership(db);
  assert.ok(after.every(r=>r.owner===null&&r.owner_id===null));
  assert.deepEqual(after.map(r=>r.metadata),before.map(r=>r.metadata));
  await db.query('delete from auth.users where id=$1',[auth]);
  await db.query('select finish_account_erasure($1,$2,null)',[user,job.lease]);
  assert.equal((await db.query('select status from account_erasure_jobs where user_id=$1',[user])).rows[0].status,'complete');
 }finally{await db.close();}
});

test('shared correction does not detach outside exact service COPY, live lease, retained task, inactive owner and matching existing bytes',async()=>{
 const {db,user,auth}=await fixture();try{
  const check=async()=>assert.ok((await ownership(db)).every(r=>r.owner===auth&&r.owner_id===auth));
  for(const [setting,value] of [['storage.operation','object.upload'],['storage.operation','object.upload_signed'],['request.jwt.claims','{"role":"authenticated"}']]){
   await db.query('select set_config($1,$2,false)',[setting,value]);
   await db.exec('update storage.objects set version=\'probe\'');await check();
   await db.exec(`select set_config('request.jwt.claims','{"role":"service_role"}',false),set_config('storage.operation','object.copy',false)`);
  }
  await db.exec("update account_erasure_jobs set leased_until=now()-interval '1 minute'");
  await db.exec('update storage.objects set version=\'expired\'');await check();
  await db.exec("update account_erasure_jobs set leased_until=now()+interval '5 minutes';update account_erasure_objects set completed_at=now()");
  await db.exec('update storage.objects set version=\'completed\'');await check();
  await db.exec("update account_erasure_objects set completed_at=null,disposition='purge'");
  await db.exec('update storage.objects set version=\'purge\'');await check();
  await db.exec("update account_erasure_objects set disposition='retain_business';update users set status='active'");
  await db.exec('update storage.objects set version=\'active\'');await check();
  await db.exec("update users set status='deleted'");
  await db.exec("update storage.objects set metadata=jsonb_set(metadata,'{eTag}','\"different-bytes\"')");await check();
  await db.exec("update storage.objects set metadata=jsonb_set(metadata,'{size}','11')");await check();
  await db.exec("update storage.objects set metadata=jsonb_set(metadata,'{mimetype}','\"image/webp\"')");await check();
  await db.exec('delete from storage.objects');
  await db.query("insert into storage.objects(bucket_id,name,owner,owner_id) values('payroll-paystubs','business/record.pdf',$1::uuid,($1::uuid)::text)",[auth]);
  await check();
 }finally{await db.close();}
});
