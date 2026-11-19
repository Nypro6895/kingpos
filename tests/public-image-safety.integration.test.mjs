import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {taxErasureFixture,seedPerson,personId} from './helpers/tax-erasure-fixture.mjs';
const migration=fs.readFileSync('supabase/migrations/20261116220000_public_image_safety.sql','utf8');
const id=personId(101),user=personId(1),other=personId(2),salon=personId(90),hash='a'.repeat(64);
const mediaPath=`${user}/beauty/image/${id}.webp`,stagePath='beauty-profile-media/'+mediaPath;
const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
async function actor(db,uid=user,role='authenticated',operation='object.upload'){
 await db.exec('reset role');
 await db.query("select set_config('test.uid',$1,false),set_config('request.jwt.claims',$2,false),set_config('storage.operation',$3,false)",[uid,JSON.stringify({role}),operation]);
 await db.exec(`set role ${role}`);
}
async function fixture({apply=true}={}){
 const db=await taxErasureFixture();
 try{
 await db.exec(`alter role service_role bypassrls;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 alter table storage.objects add column id uuid default gen_random_uuid(),add column version text default 'v1',add column metadata jsonb default '{"mimetype":"image/webp","size":10,"eTag":"initial"}',add column user_metadata jsonb default '{}';
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant all on storage.objects to authenticated,service_role;
 create policy broad_old_storage on storage.objects for all to authenticated using(true) with check(true);
 create function storage.allow_only_operation(expected text) returns boolean language sql stable as $$select current_setting('storage.operation',true)=expected$$;
 create function storage.allow_any_operation(expected text[]) returns boolean language sql stable as $$select current_setting('storage.operation',true)=any(expected)$$;
 alter table beauty_posts add column profile_id uuid,add column safety_hold boolean default false;
 alter table beauty_post_media add column role text default 'image';
 alter table salon_profile_looks add column id uuid default gen_random_uuid(),add column salon_id uuid,add column created_by_user_id uuid,add column safety_hold boolean default false;
 alter table salon_profile_updates add column id uuid default gen_random_uuid(),add column salon_id uuid,add column created_by_user_id uuid,add column safety_hold boolean default false;
 create function current_user_can_post_salon_content(p uuid) returns boolean language sql stable as $$select p='${salon}' and current_public_user_id()='${user}'$$;
 create function user_has_salon_permission(p uuid,permissions text[]) returns boolean language sql stable as $$select current_user_can_post_salon_content(p)$$;
 `);
 await seedPerson(db,1,'active');await seedPerson(db,2,'active');await db.query('insert into locations values($1)',[salon]);
 if(apply)await db.exec(migration);
 return db;
 }catch(error){await db.close();throw error;}
}
async function reserve(db){await actor(db);return (await one(db,'select reserve_public_post_image($1,$2,$3,null) result',['beauty-profile-media',mediaPath,'image'])).result;}
async function promote(db){
 await actor(db,user,'service_role');
 await db.query("insert into storage.objects(bucket_id,name,user_metadata) values('beauty-profile-media',$1,$2)",[mediaPath,JSON.stringify({sha256:hash})]);
 return one(db,"select finish_public_post_image($1,$2,$3,100,100,10,'fixture','fixture-model','v1') result",['beauty-profile-media',mediaPath,hash]);
}

test('quarantine is private, owner/raw-upload scoped and immune to client metadata approval or public mutation',async()=>{
 const db=await fixture();try{
  const registered=await reserve(db);assert.equal(registered.quarantine_path,stagePath);
  await assert.rejects(db.query('select reserve_public_post_image($1,$2,$3,null)',['beauty-profile-media',`${user}/beauty/image/${'-'.repeat(36)}.webp`,'image']),/Invalid Beauty/);
  await db.query("insert into storage.objects(bucket_id,name) values('public-image-quarantine',$1)",[stagePath]);
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('beauty-profile-media',$1)",[mediaPath]),/row-level security|immutable/);
  await assert.rejects(db.query("update public_post_images set status='approved',sha256=$1 where object_path=$2",[hash,mediaPath]),/permission denied/);
  await actor(db,other,'authenticated','object.get_authenticated');
  assert.equal((await db.query("select * from storage.objects where bucket_id='public-image-quarantine'")).rows.length,0);
  await actor(db,user,'authenticated','object.sign');
  assert.equal((await db.query("select * from storage.objects where bucket_id='public-image-quarantine'")).rows.length,0);
  await actor(db,user,'authenticated','object.get_authenticated');
  assert.equal((await db.query("select * from storage.objects where bucket_id='public-image-quarantine'")).rows.length,1);
  assert.equal((await db.query("delete from storage.objects where bucket_id='public-image-quarantine' returning name")).rows.length,0);
  await promote(db);
  // Storage's signed-upload route escalates to service_role after bearer token
  // verification. It must still fail, even when RLS is bypassed by that role.
  await actor(db,user,'service_role','object.upload_signed');
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('beauty-profile-media',$1)",[`${user}/beauty/image/${personId(102)}.webp`]),/immutable/);
  await actor(db);
  assert.equal((await db.query("update storage.objects set version='replaced' where bucket_id='beauty-profile-media' returning name")).rows.length,0);
  assert.equal((await db.query("delete from storage.objects where bucket_id='beauty-profile-media' returning name")).rows.length,0);
  // Covers remain outside post-image safety, but cannot pass the post-media gate.
  await db.query("insert into storage.objects(bucket_id,name) values('beauty-profile-media',$1)",[`${user}/beauty/cover/${id}.webp`]);
 }finally{await db.close();}
});

test('service approval requires actual normalized hash/size and pins the immutable Storage identity',async()=>{
 const db=await fixture();try{
  await reserve(db);await actor(db,user,'service_role');
  await db.query("insert into storage.objects(bucket_id,name,user_metadata) values('beauty-profile-media',$1,$2)",[mediaPath,JSON.stringify({sha256:hash})]);
  for(const digest of ['b'.repeat(64),null])await assert.rejects(db.query("select finish_public_post_image($1,$2,$3,100,100,10,'fixture','fixture-model','v1')",['beauty-profile-media',mediaPath,digest]),/match Storage|Invalid image/);
  await db.query("select finish_public_post_image($1,$2,$3,100,100,10,'fixture','fixture-model','v1')",['beauty-profile-media',mediaPath,hash]);
  await db.query("select finish_public_post_image($1,$2,$3,100,100,10,'fixture','fixture-model','v1')",['beauty-profile-media',mediaPath,hash]);
  await db.exec('reset role');
  await db.query("insert into beauty_posts(id,author_user_id) values($1,$2)",[id,user]);
  await db.query("insert into beauty_post_media(post_id,bucket,object_path,role) values($1,'beauty-profile-media',$2,'image')",[id,mediaPath]);
  await db.query("update storage.objects set version='v2' where name=$1",[mediaPath]);
  await assert.rejects(db.query("insert into beauty_post_media(post_id,bucket,object_path,role) values($1,'beauty-profile-media',$2,'image')",[id,mediaPath]),/safety approval required/);
  await actor(db,user,'service_role');
  await assert.rejects(db.query("select finish_public_post_image($1,$2,$3,100,100,10,'fixture','fixture-model','v1')",['beauty-profile-media',mediaPath,hash]),/collision/);
 }finally{await db.close();}
});

test('publication is gated in SQL and frozen legacy registration does not grow on migration replay',async()=>{
 const db=await fixture({apply:false});try{
  await db.query("insert into beauty_profiles(id,user_id,visibility) values($1,$2,'public')",[id,user]);
  await db.query("insert into beauty_posts(id,profile_id,author_user_id,visibility,moderation_status) values($1,$1,$2,'public','visible')",[id,user]);
  await db.query("insert into beauty_post_media(post_id,bucket,object_path,role) values($1,'beauty-profile-media',$2,'image')",[id,mediaPath]);
  await db.query("insert into storage.objects(bucket_id,name) values('beauty-profile-media',$1)",[mediaPath]);
  await db.exec(migration);
  assert.equal((await one(db,"select status from public_post_images where object_path=$1",[mediaPath])).status,'legacy');
  const newPath=`${salon}/updates/${id}.webp`;
  await db.query("insert into salon_profile_updates(id,salon_id,author_user_id,status,media_path) values($1,$2,$3,'draft',$4)",[id,salon,user,newPath]);
  await assert.rejects(db.query("update salon_profile_updates set status='published' where id=$1",[id]),/safety approval required/);
  await db.query("insert into storage.objects(bucket_id,name) values('salon-profile-media',$1)",[newPath]);
  await db.exec('alter table salon_profile_updates disable trigger ac_post_image_approval');
  await db.query("update salon_profile_updates set status='published' where id=$1",[id]);
  await db.exec('alter table salon_profile_updates enable trigger ac_post_image_approval');
  await db.exec(migration);
  assert.equal((await one(db,"select count(*)::int count from public_post_images where object_path=$1",[newPath])).count,0,'replay cannot grandfather a later object');
  assert.equal((await one(db,"select count(*)::int count from public_post_images")).count,1);
 }finally{await db.close();}
});

test('account erasure collects unattached private and promoted personal paths without touching financial storage',async()=>{
 const db=await fixture({apply:false});try{
  const businessPath=`${salon}/updates/${personId(777)}.webp`;
  await db.query("insert into salon_profile_updates(id,salon_id,author_user_id,created_by_user_id,status,media_path) values($1,$2,null,$3,'published',$4)",[personId(777),salon,user,businessPath]);
  await db.query("insert into storage.objects(bucket_id,name,owner_id) select 'salon-profile-media',$1,auth_user_id::text from users where id=$2",[businessPath,user]);
  await db.exec(migration);
  assert.equal((await one(db,'select status from public_post_images where object_path=$1',[businessPath])).status,'legacy');
  await reserve(db);await promote(db);await db.exec('reset role');
  await db.query("insert into storage.objects(bucket_id,name) values('payroll-paystubs','business/retained.pdf')");
  await db.query("update users set status='pending_deletion' where id=$1",[user]);
  const result=(await one(db,'select finalize_account_deletion($1) result',[user])).result;assert.equal(result.ok,true,JSON.stringify(result));
  const tasks=(await db.query('select bucket_id,object_path,disposition from account_erasure_objects where user_id=$1 order by bucket_id',[user])).rows;
  assert.ok(tasks.some(t=>t.bucket_id==='public-image-quarantine'&&t.object_path===stagePath));
  assert.ok(tasks.some(t=>t.bucket_id==='beauty-profile-media'&&t.object_path===mediaPath));
  assert.ok(!tasks.some(t=>t.bucket_id==='payroll-paystubs'));
  assert.ok(tasks.some(t=>t.object_path===businessPath&&t.disposition==='retain_business'),'legacy creator snapshot must not override shipped business retention');
  assert.ok(!tasks.some(t=>t.bucket_id==='public-image-quarantine'&&t.object_path.endsWith(businessPath)));
  assert.equal((await one(db,"select count(*)::int count from storage.objects where bucket_id='payroll-paystubs'")).count,1);
 }finally{await db.close();}
});

test('service cancellation is owner-bound, terminal before approval, and cannot revoke an approved copy',async()=>{
 const db=await fixture();try{
  await reserve(db);
  await assert.rejects(db.query('select cancel_public_post_image($1,$2,$3)',['beauty-profile-media',mediaPath,user]),/permission denied/);
  await actor(db,user,'service_role');
  assert.equal((await one(db,'select cancel_public_post_image($1,$2,$3) result',['beauty-profile-media',mediaPath,other])).result,false);
  assert.equal((await one(db,'select cancel_public_post_image($1,$2,$3) result',['beauty-profile-media',mediaPath,user])).result,true);
  assert.equal((await one(db,'select cancel_public_post_image($1,$2,$3) result',['beauty-profile-media',mediaPath,user])).result,true);
  await assert.rejects(db.query("select finish_public_post_image($1,$2,$3,2,2,10,'fixture','fixture','v1')",['beauty-profile-media',mediaPath,hash]),/unavailable/);
  await actor(db);
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('public-image-quarantine',$1)",[stagePath]),/row-level security|Post image reservation is unavailable/);
 }finally{await db.close();}
 const db2=await fixture();try{
  await reserve(db2);await promote(db2);
  assert.equal((await one(db2,'select cancel_public_post_image($1,$2,$3) result',['beauty-profile-media',mediaPath,user])).result,false);
  assert.equal((await one(db2,'select status from public_post_images where object_path=$1',[mediaPath])).status,'approved');
 }finally{await db2.close();}
});

test('seven-day private staging sweep fences uploads, leases bounded batches and preserves approved public/legacy bytes',async()=>{
 const db=await fixture();try{
  const cases=[...Array.from({length:12},(_,i)=>[i,'staged',8]),[12,'approved',8],[13,'cancelled',8],[14,'rejected',8],[15,'legacy',8],[16,'staged',1]];
  for(const [n,status,age] of cases){
   const path=`${user}/beauty/image/${personId(200+n)}.webp`;
   await db.query("insert into public_post_images(bucket,object_path,quarantine_path,uploaded_by_user_id,purpose,status,created_at) values('beauty-profile-media',$1,'beauty-profile-media/'||$1,$2,'image',$3,now()-($4||' days')::interval)",[path,user,status,String(age)]);
   await db.query("insert into storage.objects(bucket_id,name) values('public-image-quarantine','beauty-profile-media/'||$1)",[path]);
   if(['approved','legacy'].includes(status))await db.query("insert into storage.objects(bucket_id,name) values('beauty-profile-media',$1)",[path]);
  }
  await actor(db);
  await assert.rejects(db.query('select * from claim_expired_public_image_staging(10)'),/permission denied/);
  await actor(db,user,'service_role');
  const first=(await db.query('select * from claim_expired_public_image_staging(100)')).rows;assert.equal(first.length,10);
  const second=(await db.query('select * from claim_expired_public_image_staging(100)')).rows;assert.equal(second.length,5);
  assert.equal(new Set([...first,...second].map(r=>r.object_path)).size,15);
  assert.ok([...first,...second].every(r=>r.status!=='staged'&&r.status!=='legacy'&&r.cleanup_claimed_until));
  assert.equal((await db.query('select * from claim_expired_public_image_staging(10)')).rows.length,0);
  const approved=[...first,...second].find(r=>r.status==='approved'),cancelled=first.find(r=>r.status==='cancelled');
  assert.equal((await one(db,'select finish_public_image_staging_expiry($1,$2) result',[approved.bucket,approved.object_path])).result,false,'checkpoint requires Storage metadata absence');
  await actor(db);await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('public-image-quarantine',$1)",[cancelled.quarantine_path]),/row-level security|Post image reservation is unavailable/);
  await actor(db,user,'service_role');
  await db.query("delete from storage.objects where bucket_id='public-image-quarantine' and name=$1",[approved.quarantine_path]);
  for(let n=0;n<2;n++)assert.equal((await one(db,'select finish_public_image_staging_expiry($1,$2) result',[approved.bucket,approved.object_path])).result,true);
  assert.equal((await one(db,'select status from public_post_images where object_path=$1',[approved.object_path])).status,'approved');
  assert.equal((await one(db,"select count(*)::int count from storage.objects where bucket_id='beauty-profile-media'")).count,2,'approved and legacy public objects survive');
  await db.query("update public_post_images set cleanup_claimed_until=now()-interval '1 minute' where object_path=$1",[cancelled.object_path]);
  assert.equal((await db.query('select * from claim_expired_public_image_staging(10)')).rows.length,1,'expired failed lease retries');
 }finally{await db.close();}
});

test('inactive authors cannot reserve, upload private bytes or promote a stale approved scan; trusted erasure deletes still work',async()=>{
 const db=await fixture();try{
  await reserve(db);await promote(db);await db.exec('reset role');
  await db.query("update users set status='pending_deletion' where id=$1",[user]);
  await actor(db);
  await assert.rejects(db.query('select reserve_public_post_image($1,$2,$3,null)',['beauty-profile-media',`${user}/beauty/image/${personId(501)}.webp`,'image']),/active account/);
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('public-image-quarantine',$1)",[stagePath]),/author is unavailable/);
  await actor(db,user,'service_role');
  await assert.rejects(db.query("update storage.objects set version='stale-scan-write' where bucket_id='beauty-profile-media' and name=$1",[mediaPath]),/author is unavailable/);
  await assert.rejects(db.query("select finish_public_post_image($1,$2,$3,100,100,10,'fixture','fixture','v1')",['beauty-profile-media',mediaPath,hash]),/author is unavailable/);
  await db.query("delete from storage.objects where bucket_id='beauty-profile-media' and name=$1",[mediaPath]);
  assert.equal((await one(db,"select count(*)::int count from storage.objects where name=$1",[mediaPath])).count,0);
 }finally{await db.close();}
});

test('historical retained business copy requires live lease, exact existing bytes and service copy operation',async()=>{
 const db=await fixture({apply:false});try{
  const path=`${salon}/updates/${personId(888)}.webp`;
  await db.query("insert into salon_profile_updates(id,salon_id,author_user_id,created_by_user_id,status,media_path) values($1,$2,null,$3,'published',$4)",[personId(888),salon,user,path]);
  await db.query("insert into storage.objects(bucket_id,name,owner_id) select 'salon-profile-media',$1,auth_user_id::text from users where id=$2",[path,user]);
  await db.exec(migration);
  await db.query("update users set status='pending_deletion' where id=$1",[user]);
  await db.query('select finalize_account_deletion($1)',[user]);
  await actor(db,user,'service_role','object.copy');
  await assert.rejects(db.query('update storage.objects set owner_id=null where name=$1',[path]),/author is unavailable/);
  const job=(await one(db,'select claim_account_erasure() result')).result;assert.equal(job.userId,user);
  await assert.rejects(db.query("update storage.objects set metadata=jsonb_set(metadata,'{size}','11') where name=$1",[path]),/author is unavailable/);
  await actor(db,user,'authenticated','object.copy');
  assert.equal((await db.query('update storage.objects set owner_id=null where name=$1 returning name',[path])).rows.length,0);
  await actor(db,user,'service_role','object.upload_signed');
  await assert.rejects(db.query('update storage.objects set owner_id=null where name=$1',[path]),/immutable/);
  await actor(db,user,'service_role','object.copy');
  await db.query('update storage.objects set owner_id=null where name=$1',[path]);
  assert.equal((await one(db,'select owner_id from storage.objects where name=$1',[path])).owner_id,null);
  await db.query("select finish_account_erasure_object($1,$2,'salon-profile-media',$3)",[user,job.lease,path]);
  await assert.rejects(db.query('update storage.objects set version=\'later\' where name=$1',[path]),/author is unavailable/,'completed task cannot authorize more copies');
  await db.query('delete from storage.objects where name=$1',[path]);
  await db.exec('reset role');
  await db.query('update account_erasure_objects set completed_at=null where object_path=$1',[path]);
  await actor(db,user,'service_role','object.copy');
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('salon-profile-media',$1)",[path]),/author is unavailable/,'maintenance cannot resurrect an absent object');
 }finally{await db.close();}
});
