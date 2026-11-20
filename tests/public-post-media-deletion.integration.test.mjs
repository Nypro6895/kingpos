import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import sharp from 'sharp';
import {build} from 'esbuild';
import {taxErasureFixture,seedPerson,personId} from './helpers/tax-erasure-fixture.mjs';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

const migration='supabase/migrations/20261118220000_public_post_media_deletion.sql';
const source=fs.readFileSync(migration,'utf8');
const user=personId(1),salon=personId(90),digest='a'.repeat(64);
const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
async function fixture(){
 const db=await taxErasureFixture();
 try{
  await db.exec(`
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   alter table storage.objects add column id uuid default gen_random_uuid(),add column version text default 'v1',add column metadata jsonb default '{"mimetype":"image/webp","size":10,"eTag":"initial"}',add column user_metadata jsonb default '{}';
   create function storage.allow_only_operation(expected text) returns boolean language sql stable as $$select current_setting('storage.operation',true)=expected$$;
   create function storage.allow_any_operation(expected text[]) returns boolean language sql stable as $$select current_setting('storage.operation',true)=any(expected)$$;
   alter table beauty_posts add column profile_id uuid,add column safety_hold boolean default false;
   alter table beauty_post_media add column role text default 'image';
   alter table salon_profile_looks add column id uuid default gen_random_uuid(),add column salon_id uuid,add column created_by_user_id uuid,add column safety_hold boolean default false;
   alter table salon_profile_updates add column id uuid default gen_random_uuid(),add column salon_id uuid,add column created_by_user_id uuid,add column safety_hold boolean default false;
   alter table post_safety_cases add column source_type text,add column source_id uuid,add column status text default 'pending';
   create table salon_settings(salon_id uuid,public_profile_cover_path text,public_profile_logo_path text);
   create table booking_inspirations(source_media_bucket text,source_media_path text);
   alter table salon_profile_media_assets add column id uuid default gen_random_uuid(),add column salon_id uuid;
   create schema market_platform;create table market_platform.published_groups(salon_id uuid,group_name text,data jsonb,published boolean default false);
   create function current_user_can_post_salon_content(uuid) returns boolean language sql as $$select true$$;
   create function user_has_salon_permission(uuid,text[]) returns boolean language sql as $$select true$$;
  `);
  await seedPerson(db,1,'active');await db.query('insert into locations values($1)',[salon]);
  await db.exec(fs.readFileSync('supabase/migrations/20261116220000_public_image_safety.sql','utf8'));
  await db.exec(source);
  await db.exec(`set request.jwt.claims='{"role":"service_role"}';set storage.operation='object.upload';`);
  return db;
 }catch(e){await db.close();throw e;}
}
async function image(db,n,{salonImage=false}={}){
 const id=personId(n),bucket=salonImage?'salon-profile-media':'beauty-profile-media';
 const path=salonImage?`${salon}/updates/${id}.webp`:`${user}/beauty/image/${id}.webp`;
 await db.query('select set_config(\'test.uid\',$1,false)',[user]);
 await db.query('select reserve_public_post_image($1,$2,$3,$4)',[bucket,path,salonImage?'update':'image',salonImage?salon:null]);
 await db.query('insert into storage.objects(bucket_id,name,user_metadata) values($1,$2,$3)',[bucket,path,JSON.stringify({sha256:digest})]);
 await db.query("select finish_public_post_image($1,$2,$3,2,2,10,'fixture','synthetic','test')",[bucket,path,digest]);
 if(salonImage)await db.query("insert into salon_profile_updates(id,salon_id,author_user_id,media_path,status) values($1,$2,$3,$4,'published')",[id,salon,user,path]);
 else{
  await db.query("insert into beauty_posts(id,author_user_id,visibility,moderation_status) values($1,$2,'public','visible')",[id,user]);
  await db.query("insert into beauty_post_media(post_id,bucket,object_path,role) values($1,$2,$3,'image')",[id,bucket,path]);
 }
 return {id,bucket,path,salonImage};
}
async function terminal(db,img){
 if(img.salonImage)await db.query('delete from salon_profile_updates where id=$1',[img.id]);
 else await db.query('update beauty_posts set deleted_at=now() where id=$1',[img.id]);
}
const claims=async db=>(await db.query('select * from claim_public_post_media_deletions(5)')).rows;
const job=async(db,img)=>one(db,'select * from public_post_media_deletions where bucket=$1 and object_path=$2',[img.bucket,img.path]);
const due=async db=>db.exec("update public_post_media_deletions set checked_at=null,leased_until=null");

test('terminal deletion captures immutable new approval transactionally; service-only receipts have no user/post FK',async()=>{
 const db=await fixture();try{
  const img=await image(db,101);await db.exec('begin');await terminal(db,img);
  assert.equal((await job(db,img)).sha256,digest);await db.exec('rollback');assert.equal(await job(db,img),undefined);
  await terminal(db,img);const saved=await job(db,img);
  assert.equal(saved.status,'queued');assert.equal(saved.bytes,10);assert.ok(saved.object_id);
  assert.equal((await one(db,"select count(*)::int n from pg_constraint where conrelid='public_post_media_deletions'::regclass and contype='f'")).n,0);
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);
   await assert.rejects(db.exec('select * from public_post_media_deletions'),/permission denied/);
   await assert.rejects(db.exec('select * from claim_public_post_media_deletions(5)'),/permission denied/);
   await db.exec('reset role');
  }
 }finally{await db.close();}
});

test('hold/archive never enqueue; legacy or incomplete object identities never enter this cleanup',async()=>{
 const db=await fixture();try{
  const img=await image(db,102);await db.query("update beauty_posts set safety_hold=true,visibility='self' where id=$1",[img.id]);
  assert.equal(await job(db,img),undefined);
  await db.query("update public_post_images set status='legacy' where object_path=$1",[img.path]);await terminal(db,img);assert.equal(await job(db,img),undefined);
  const incomplete=await image(db,103);await db.query('update public_post_images set object_etag=null where object_path=$1',[incomplete.path]);
  await terminal(db,incomplete);assert.equal(await job(db,incomplete),undefined);
 }finally{await db.close();}
});

test('shared post, Salon cover and independent booking history retain bytes until the exact last reference is detached',async()=>{
 const db=await fixture();try{
  const img=await image(db,104,{salonImage:true});
  await db.query('insert into salon_settings(salon_id,public_profile_cover_path) values($1,$2)',[salon,img.path]);
  await terminal(db,img);assert.deepEqual(await claims(db),[]);assert.equal((await job(db,img)).status,'referenced');
  await db.query('update salon_settings set public_profile_cover_path=null');
  await db.query('insert into booking_inspirations values($1,$2)',[img.bucket,img.path]);await due(db);assert.deepEqual(await claims(db),[]);
  await db.exec('delete from booking_inspirations');await due(db);assert.equal((await claims(db)).length,1);
  const shared=await image(db,105,{salonImage:true});
  await db.query("insert into salon_profile_updates(id,salon_id,author_user_id,media_path,status) values($1,$2,$3,$4,'archived')",[personId(205),salon,user,shared.path]);
  await terminal(db,shared);assert.deepEqual(await claims(db),[]);assert.equal((await job(db,shared)).status,'referenced');
 }finally{await db.close();}
});

test('saved Market photo selections retain their asset and cannot be created or redirected after a deletion fence',async()=>{
 const db=await fixture();try{
  const img=await image(db,111,{salonImage:true}),asset=personId(511);
  await db.query("insert into salon_profile_media_assets(id,salon_id,bucket,object_path,status) values($1,$2,$3,$4,'active')",[asset,salon,img.bucket,img.path]);
  await db.query("insert into market_platform.published_groups(salon_id,group_name,data) values($1,'media',$2)",[salon,JSON.stringify({images:[{assetId:asset}]})]);
  await terminal(db,img);assert.deepEqual(await claims(db),[]);assert.equal((await job(db,img)).status,'referenced');
  await db.exec('delete from market_platform.published_groups');await due(db);assert.equal((await claims(db)).length,1);
  await assert.rejects(db.query("insert into market_platform.published_groups(salon_id,group_name,data) values($1,'media',$2)",[salon,JSON.stringify({images:[{assetId:asset}]})]),/deleted photo/);
  await assert.rejects(db.query("insert into salon_profile_media_assets(id,salon_id,bucket,object_path,status) values($1,$2,$3,$4,'active')",[personId(512),salon,img.bucket,img.path]),/deleted photo/);
 }finally{await db.close();}
});

test('resolved/reopenable review evidence is retained; a new image reference cannot race a permanent deletion fence',async()=>{
 const db=await fixture();try{
  const reported=await image(db,106);await db.query("insert into post_safety_cases(source_type,source_id,status,content_snapshot) values('beauty_post',$1,'deleted','{}')",[reported.id]);
  await terminal(db,reported);assert.deepEqual(await claims(db),[]);assert.equal((await job(db,reported)).status,'review_evidence');
  const img=await image(db,107);await terminal(db,img);const [claimed]=await claims(db);assert.ok(claimed);
  await assert.rejects(db.query('update beauty_posts set deleted_at=null where id=$1',[img.id]),/deleted photo/);
  await assert.rejects(db.query("insert into post_safety_cases(source_type,source_id,status,content_snapshot) values('beauty_post',$1,'pending','{}')",[img.id]),/deleted photo/);
  await assert.rejects(db.query('update storage.objects set version=\'recreated\' where name=$1',[img.path]),/deleted photo/);
 }finally{await db.close();}
});

test('completion requires actual absence and the current lease; failure/reclaim never removes the permanent fence',async()=>{
 const db=await fixture();try{
  const img=await image(db,108);await terminal(db,img);const [claimed]=await claims(db);
  const finish=(lease,error=null)=>one(db,'select finish_public_post_media_deletion($1,$2,$3) done',[claimed.id,lease,error]);
  assert.equal((await finish(crypto.randomUUID())).done,false);assert.equal((await finish(claimed.lease_token)).done,false);
  await db.query("update public_post_media_deletions set leased_until=now()-interval '1 second' where id=$1",[claimed.id]);
  assert.equal((await finish(claimed.lease_token)).done,false,'expired lease cannot checkpoint');
  await due(db);const [renewed]=await claims(db);
  assert.equal((await finish(renewed.lease_token,'storage_remove_failed')).done,false);
  await due(db);const [retry]=await claims(db);assert.notEqual(retry.lease_token,claimed.lease_token);
  await db.query('delete from storage.objects where bucket_id=$1 and name=$2',[img.bucket,img.path]);
  assert.equal((await finish(claimed.lease_token)).done,false);
  assert.equal((await finish(retry.lease_token)).done,true);assert.equal((await finish(retry.lease_token)).done,true);
  await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[img.bucket,img.path]),/deleted photo/);
 }finally{await db.close();}
});

test('changed pinned Storage identity is blocked rather than deleting a replacement object',async()=>{
 const db=await fixture();try{
  const img=await image(db,112);await terminal(db,img);
  await db.query("update storage.objects set version='different-version' where bucket_id=$1 and name=$2",[img.bucket,img.path]);
  assert.deepEqual(await claims(db),[]);assert.equal((await job(db,img)).status,'identity_mismatch');
  assert.equal((await one(db,'select public_deletion_fenced_at from public_post_images where object_path=$1',[img.path])).public_deletion_fenced_at,null);
 }finally{await db.close();}
});

test('missing manifests consumed by erasure cannot starve later valid jobs behind the bounded candidate window',async()=>{
 const db=await fixture();try{
  const img=await image(db,113);await terminal(db,img);
  await db.query(`insert into public_post_media_deletions(bucket,object_path,uploaded_by_user_id,source_type,source_id,object_id,object_version,object_etag,sha256,bytes,created_at)
   select bucket,'consumed-by-erasure/'||n,uploaded_by_user_id,source_type,source_id,object_id,object_version,object_etag,sha256,bytes,now()-interval '1 day'
   from public_post_media_deletions cross join generate_series(1,40) n where object_path=$1`,[img.path]);
  const ready=await claims(db);assert.equal(ready.length,1);assert.equal(ready[0].object_path,img.path);
 }finally{await db.close();}
});

test('erasure retained-business tasks, unfinished purge and inactive users remain under existing erasure authority',async()=>{
 const db=await fixture();try{
  const images=[await image(db,109),await image(db,110)];
  for(const img of images)await terminal(db,img);
  await db.query('insert into account_erasure_jobs(user_id) values($1)',[user]);
  for(const [index,disposition] of ['retain_business','purge'].entries()){
   const img=images[index];
   await db.query('insert into account_erasure_objects(user_id,bucket_id,object_path,disposition) values($1,$2,$3,$4)',[user,img.bucket,img.path,disposition]);
  }
  assert.deepEqual(await claims(db),[]);
  for(const img of images)assert.equal((await job(db,img)).status,'erasure_owned');
  assert.equal((await one(db,'select count(*)::int n from storage.objects')).n,2);
  await db.exec(source); // migration replay preserves receipts and guards
  assert.equal((await one(db,'select count(*)::int n from public_post_media_deletions')).n,2);
 }finally{await db.close();}
});

test('real PostgreSQL lock races and real Storage API removal checkpoint',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async()=>{
 let f;
 const images=JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{"db":"public.ecr.aws/supabase/postgres:17.11.0.006","auth":"public.ecr.aws/supabase/gotrue:v2.197.0","storage":"public.ecr.aws/supabase/storage-api:v1.84.19","rest":"public.ecr.aws/supabase/postgrest:v16.5"}');
 try{
  f=await startIsolatedSupabase('post-media-deletion',images,{allowConcurrentFixtureCleanup:true});
  const person=f.person('post-media-author'),service={token:f.serviceToken};
  f.sql(`update auth.users set phone='15550001841',phone_confirmed_at=now() where id='${person.authId}';`);
  const serviceContext=`set request.jwt.claims='{"role":"service_role"}';`;
  const docker=process.env.TEST_DOCKER_PATH||'C:/Program Files/Docker/Docker/resources/bin/docker.exe';
  const context=process.env.TEST_DOCKER_CONTEXT||'desktop-linux';
  const args=['--context',context,'exec','-i',f.evidence.containers.db];
  const execute=(command,input)=>cp.execFileSync(docker,[...args,...command],{input,encoding:'utf8',windowsHide:true,timeout:30000});
  const imageBytes=await sharp({create:{width:2,height:2,channels:3,background:'#24693e'}}).webp().toBuffer();
  const sha=crypto.createHash('sha256').update(imageBytes).digest('hex'),file='/tmp/post-image-'+crypto.randomUUID()+'.webp';
  execute(['sh','-c','cat > '+file],imageBytes);
  const bucket='beauty-profile-media',path=`${person.profileId}/beauty/image/${crypto.randomUUID()}.webp`,post=crypto.randomUUID();
  f.rpc(person,'reserve_public_post_image',{p_bucket:bucket,p_path:path,p_purpose:'image'});
  const config=[`url = ${JSON.stringify('http://127.0.0.1:5000/object/'+bucket+'/'+path)}`,'request = "POST"','silent','show-error','fail','max-time = 20','header = "Content-Type: image/webp"',
   'header = '+JSON.stringify('Authorization: Bearer '+f.serviceToken),'header = '+JSON.stringify('x-metadata: '+Buffer.from(JSON.stringify({sha256:sha})).toString('base64')),'data-binary = '+JSON.stringify('@'+file)].join('\n');
  execute(['curl','--config','-'],config);
  f.rpc(service,'finish_public_post_image',{p_bucket:bucket,p_path:path,p_sha256:sha,p_width:2,p_height:2,p_bytes:imageBytes.length,p_provider:'synthetic',p_model:'fixture',p_policy_version:'test'});
  f.sql(`${serviceContext}insert into beauty_profiles(id,user_id) values('${crypto.randomUUID()}','${person.profileId}') on conflict(user_id) do nothing;insert into beauty_posts(id,profile_id,author_user_id,caption) select '${post}',id,'${person.profileId}','Synthetic cleanup fixture' from beauty_profiles where user_id='${person.profileId}';insert into beauty_post_media(post_id,bucket,object_path,role) values('${post}','${bucket}','${path}','image');update beauty_posts set deleted_at=now() where id='${post}';`);
  function concurrent(sql){
   const child=cp.spawn(docker,[...args,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-At'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
   let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);child.stdin.end(sql);
   return new Promise((resolve,reject)=>child.on('exit',code=>code===0?resolve(output):reject(Error(error))));
  }
  // A user-first finalization lock makes claim skip immediately, rather than
  // taking the queue first and waiting for the user in the opposite order.
  async function untilMarker(n){
   for(let i=0;i<30;i++){
    if(f.sql(`select exists(select 1 from pg_locks where locktype='advisory' and objid=${n} and granted)`) === 't')return;
    await new Promise(r=>setTimeout(r,30));
   }
   throw Error('Concurrent fixture did not reach its lock checkpoint');
  }
  const held=concurrent(`begin;select 1 from users where id='${person.profileId}' for update;select pg_advisory_xact_lock(900001);select pg_sleep(3);commit;`);
  await untilMarker(900001);assert.deepEqual(f.rpc(service,'claim_public_post_media_deletions',{p_limit:5}),[]);
  assert.throws(()=>f.sql(`${serviceContext}update beauty_posts set deleted_at=null where id='${post}'`),/could not obtain lock|lock not available/i);
  await held;
  // An attaching transaction holds the manifest until its reference commits.
  // Claim must skip that asset, then observe the newly committed reference.
  const attach=concurrent(`begin;${serviceContext}update beauty_posts set deleted_at=null where id='${post}';select pg_advisory_xact_lock(900002);select pg_sleep(3);commit;`);
  await untilMarker(900002);assert.deepEqual(f.rpc(service,'claim_public_post_media_deletions',{p_limit:5}),[]);await attach;
  assert.deepEqual(f.rpc(service,'claim_public_post_media_deletions',{p_limit:5}),[]);
  assert.equal(f.sql(`select status from public_post_media_deletions where object_path='${path}'`),'referenced');
  f.sql(`${serviceContext}update beauty_posts set deleted_at=now() where id='${post}';update public_post_media_deletions set checked_at=null;`);
  const [claimed]=f.rpc(service,'claim_public_post_media_deletions',{p_limit:5});assert.ok(claimed);
  assert.equal(f.rpc(service,'finish_public_post_media_deletion',{p_id:claimed.id,p_lease:claimed.lease_token}),false);
  assert.ok(f.http(3000,'/beauty_posts?id=eq.'+post,'PATCH',{deleted_at:null},f.serviceToken).status>=400);
  assert.equal(f.sql(`select deleted_at is not null from beauty_posts where id='${post}'`),'t');
  const workerSha256=crypto.createHash('sha256').update(fs.readFileSync('lib/public-post-media-deletion.ts')).digest('hex');
  const built=await build({entryPoints:['lib/public-post-media-deletion.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{
   name:'fixture-only-service',setup(api){
    api.onResolve({filter:/^(server-only|\.\/public-image-safety)$/},a=>({path:a.path,namespace:'stub'}));
    api.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export function publicImageServiceClient(){throw Error("Only isolated fixture adapter permitted");}'}));
   },
  }]});
  const {processPublicPostMediaDeletion}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  const adapter={async rpc(name,input){try{return {data:f.rpc(service,name,input),error:null};}catch{return {data:null,error:{message:'isolated RPC failed'}};}},storage:{from(target){return {async remove(paths){
   const result=f.http(5000,'/object/'+target,'DELETE',{prefixes:paths},f.serviceToken);
   return {error:result.status===200?null:{message:'isolated Storage removal failed'}};
  }};}}};
  assert.equal(await processPublicPostMediaDeletion(adapter,claimed,Date.now()+10000),'removed');
  assert.equal(f.sql(`select count(*) from storage.objects where bucket_id='${bucket}' and name='${path}'`),'0');
  assert.equal(f.rpc(service,'finish_public_post_media_deletion',{p_id:claimed.id,p_lease:claimed.lease_token}),true);
  assert.ok(f.http(5000,'/object/public/'+bucket+'/'+path).status>=400);

  // Finish must not wait for an asset writer that already owns its row before
  // taking the manifest. The real Storage call may succeed, but no DB receipt
  // is completed until the independent asset lock is gone.
  f.sql('update abuse_system_settings set require_signed_context=false where id;');
  const account=f.rpc(person,'ensure_personal_account_for_current_user',{p_account_name:'Deletion race fixture'})[0].account_id;
  const salonId=f.rpc(person,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'Deletion race fixture',p_owner_is_staff:false,p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
  const salonBucket='salon-profile-media',salonPath=`${salonId}/updates/${crypto.randomUUID()}.webp`,salonPost=crypto.randomUUID();
  const salonBytes=await sharp({create:{width:2,height:2,channels:3,background:'#3e2469'}}).webp().toBuffer();
  const salonSha=crypto.createHash('sha256').update(salonBytes).digest('hex');execute(['sh','-c','cat > '+file],salonBytes);
  f.rpc(person,'reserve_public_post_image',{p_bucket:salonBucket,p_path:salonPath,p_purpose:'update',p_salon_id:salonId});
  const salonConfig=config.replace(JSON.stringify('http://127.0.0.1:5000/object/'+bucket+'/'+path),JSON.stringify('http://127.0.0.1:5000/object/'+salonBucket+'/'+salonPath))
   .replace(Buffer.from(JSON.stringify({sha256:sha})).toString('base64'),Buffer.from(JSON.stringify({sha256:salonSha})).toString('base64'));
  execute(['curl','--config','-'],salonConfig);
  f.rpc(service,'finish_public_post_image',{p_bucket:salonBucket,p_path:salonPath,p_sha256:salonSha,p_width:2,p_height:2,p_bytes:salonBytes.length,p_provider:'synthetic',p_model:'fixture',p_policy_version:'test'});
  f.sql(`${serviceContext}insert into salon_profile_media_assets(salon_id,uploaded_by_user_id,bucket,object_path,purpose,status) values('${salonId}','${person.profileId}','${salonBucket}','${salonPath}','update','active');insert into salon_profile_updates(id,salon_id,created_by_user_id,author_user_id,title,caption,media_path,status) values('${salonPost}','${salonId}','${person.profileId}','${person.profileId}','Synthetic asset race','Synthetic asset race','${salonPath}','published');delete from salon_profile_updates where id='${salonPost}';`);
  const [salonJob]=f.rpc(service,'claim_public_post_media_deletions',{p_limit:5});assert.ok(salonJob);
  const assetHeld=concurrent(`begin;select 1 from salon_profile_media_assets where object_path='${salonPath}' for update;select pg_advisory_xact_lock(900003);select pg_sleep(3);commit;`);
  await untilMarker(900003);
  assert.equal(await processPublicPostMediaDeletion(adapter,salonJob,Date.now()+10000),'failed');
  assert.equal(f.sql(`select count(*) from storage.objects where bucket_id='${salonBucket}' and name='${salonPath}'`),'0');
  assert.equal(f.sql(`select completed_at is null from public_post_media_deletions where id='${salonJob.id}'`),'t');
  await assetHeld;
  assert.equal(f.rpc(service,'finish_public_post_media_deletion',{p_id:salonJob.id,p_lease:salonJob.lease_token}),true);
  assert.equal(f.sql(`select status from salon_profile_media_assets where object_path='${salonPath}'`),'deleted');
  const migrationSha256=crypto.createHash('sha256').update(fs.readFileSync(migration)).digest('hex');
  assert.equal(f.evidence.migrationHashes.find(m=>m.file===migration.split('/').at(-1)).sha256,migrationSha256,'Migration changed after replay');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync('lib/public-post-media-deletion.ts')).digest('hex'),workerSha256,'Worker changed after bundle');
  f.save('post-media-deletion-acceptance.json',{passed:true,migrations:f.evidence.migrationHashes.length,migrationSha256,workerSha256,checks:['user-first lock skip and writer NOWAIT','concurrent resurrection visibility','permanent reattachment fence','actual worker with isolated Storage API remove','SQL absence required before checkpoint','asset-row lock yields unconfirmed result then safe checkpoint','origin read unavailable after remove']});
 }finally{if(f)f.close();}
});
