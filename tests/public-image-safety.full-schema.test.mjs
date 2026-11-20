import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import sharp from 'sharp';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('actual private upload, service promotion, SQL post approval and immutable legacy-token boundary',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async()=>{
 let f;
 const images=JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{"db":"public.ecr.aws/supabase/postgres:17.11.0.006","auth":"public.ecr.aws/supabase/gotrue:v2.197.0","storage":"public.ecr.aws/supabase/storage-api:v1.84.19","rest":"public.ecr.aws/supabase/postgrest:v16.5"}');
 try{
  f=await startIsolatedSupabase('public-image-safety',images,{allowConcurrentFixtureCleanup:true});
  f.save('public-image-safety-acceptance.json',{passed:false,stage:'running',migrationCount:f.evidence.migrationHashes.length,newMigrations:f.evidence.migrationHashes.filter(m=>m.file>='20261116215000')});
  const user=f.person('image-author'),other=f.person('image-outsider'),service={token:f.serviceToken};
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#5fb761'}}).webp().toBuffer();
  const sha=crypto.createHash('sha256').update(bytes).digest('hex'),file='/tmp/image-'+crypto.randomUUID()+'.webp';
  const docker=process.env.TEST_DOCKER_PATH||'C:/Program Files/Docker/Docker/resources/bin/docker.exe',context=process.env.TEST_DOCKER_CONTEXT||'desktop-linux';
  const execute=(args,input)=>cp.execFileSync(docker,['--context',context,'exec','-i',f.evidence.containers.db,...args],{input,encoding:'utf8',windowsHide:true,timeout:30000});
  execute(['sh','-c','cat > '+file],bytes);
  function upload(url,token,metadata,method='POST'){
   const config=[`url = ${JSON.stringify('http://127.0.0.1:5000'+url)}`,`request = ${JSON.stringify(method)}`,'silent','show-error','include','max-time = 20',
    'header = "Content-Type: image/webp"','header = "x-upsert: false"',token?'header = '+JSON.stringify('Authorization: Bearer '+token):'',
    metadata?'header = '+JSON.stringify('x-metadata: '+Buffer.from(JSON.stringify(metadata)).toString('base64')):'',
    'data-binary = '+JSON.stringify('@'+file)].filter(Boolean).join('\n');
   const raw=execute(['curl','--config','-'],config),separator=raw.includes('\r\n\r\n')?'\r\n\r\n':'\n\n',position=raw.indexOf(separator);
   let data;try{data=JSON.parse(raw.slice(position+separator.length));}catch{data={};}
   return {status:Number(raw.match(/^HTTP\/\S+ (\d+)/)?.[1]),data};
  }
  function downloadSha(bucket,path){
   const target='/tmp/retained-hash-'+crypto.randomUUID()+'.webp';
   const config=[`url = ${JSON.stringify('http://127.0.0.1:5000/object/authenticated/'+bucket+'/'+path)}`,'silent','show-error','fail','max-time = 20',
    'header = '+JSON.stringify('Authorization: Bearer '+f.serviceToken),'output = '+JSON.stringify(target)].join('\n');
   execute(['curl','--config','-'],config);
   return execute(['sha256sum',target]).trim().split(/\s/)[0];
  }
  const objectPath=`${user.profileId}/beauty/image/${crypto.randomUUID()}.webp`,bucket='beauty-profile-media';
  const reserved=f.rpc(user,'reserve_public_post_image',{p_bucket:bucket,p_path:objectPath,p_purpose:'image'});
  const staged=upload('/object/public-image-quarantine/'+reserved.quarantine_path,user.token);
  assert.equal(staged.status,200,JSON.stringify(staged));
  assert.ok(f.http(5000,'/object/public/public-image-quarantine/'+reserved.quarantine_path).status>=400);
  assert.ok(f.http(5000,'/object/authenticated/public-image-quarantine/'+reserved.quarantine_path,'GET',undefined,other.token).status>=400);
  assert.ok(f.http(5000,'/object/sign/public-image-quarantine/'+reserved.quarantine_path,'POST',{expiresIn:1000},user.token).status>=400);
  assert.ok(upload('/object/'+bucket+'/'+objectPath,user.token,{sha256:sha}).status>=400);
  const promoted=upload('/object/'+bucket+'/'+objectPath,f.serviceToken,{sha256:sha});
  assert.equal(promoted.status,200,JSON.stringify(promoted));
  const approved=f.rpc(service,'finish_public_post_image',{p_bucket:bucket,p_path:objectPath,p_sha256:sha,p_width:2,p_height:2,p_bytes:bytes.length,p_provider:'isolated-fixture',p_model:'synthetic',p_policy_version:'test-v1'});
  assert.equal(approved.status,'approved');assert.ok(approved.object_id);
  assert.equal(f.http(5000,'/object/public/'+bucket+'/'+objectPath).status,200);
  // This token has the same bearer upload mechanism as one issued before the
  // migration. New RLS alone cannot be assumed to revoke that mechanism.
  const legacyPath=`${user.profileId}/beauty/image/${crypto.randomUUID()}.webp`;
  f.rpc(user,'reserve_public_post_image',{p_bucket:bucket,p_path:legacyPath,p_purpose:'image'});
  const token=f.http(5000,'/object/upload/sign/'+bucket+'/'+legacyPath,'POST',{},f.serviceToken);
  assert.equal(token.status,200,JSON.stringify(token.data));
  const signedUploadPath=token.data.url??token.data.signedURL??token.data.signedUrl;
  assert.equal(typeof signedUploadPath,'string');
  const legacyAttempt=upload(signedUploadPath,user.token,{sha256:sha},'PUT');
  assert.ok(legacyAttempt.status>=400,'Bearer upload bypassed the public-object mutation guard');
  assert.ok(f.http(5000,'/object/public/'+bucket+'/'+legacyPath).status>=400);

  // Exercise the real canonical Beauty RPC and once-wrapper; only fixture phone
  // verification and signed-context admission are seeded, with no message send.
  f.sql(`update auth.users set phone='15550001817',phone_confirmed_at=now() where id='${user.authId}';update abuse_system_settings set require_signed_context=false where id;`);
  const requestId=crypto.randomUUID(),input={postType:'regular',caption:'Synthetic integration photo',media:[{objectPath,role:'image',mimeType:'image/webp',bytes:bytes.length,width:2,height:2}],salonId:null,staffId:null,attributionSource:'customer_claimed'};
  const rawInput={...input,media:input.media.map(m=>({...m,width:20,height:20,bytes:1234}))};
  assert.equal(f.rpc(user,'lookup_beauty_post_submission',{p_request_id:requestId,p_input:rawInput}),null);
  const first=f.rpc(user,'create_beauty_post_once',{p_request_id:requestId,p_input:input,p_request_input:rawInput});
  assert.equal(first.ok,true,JSON.stringify(first));
  // A saved receipt is resolved before redoing phone/abuse admission or image
  // normalization. Original intent is stable even if transport dimensions vary.
  f.sql(`update auth.users set phone_confirmed_at=null where id='${user.authId}';update abuse_system_settings set require_signed_context=true where id;`);
  assert.deepEqual(f.rpc(user,'lookup_beauty_post_submission',{p_request_id:requestId,p_input:rawInput}),first);
  const repeated=f.rpc(user,'create_beauty_post_once',{p_request_id:requestId,p_input:{...input,media:[]},p_request_input:rawInput});assert.deepEqual(repeated,first);
  const changed=f.http(3000,'/rpc/create_beauty_post_once','POST',{p_request_id:requestId,p_input:input,p_request_input:{...rawInput,caption:'Different'}},user.token);assert.ok(changed.status>=400);
  const counts=f.json(`select json_build_object('posts',(select count(*) from beauty_posts where id='${first.postId}'),'media',(select count(*) from beauty_post_media where post_id='${first.postId}'))`);
  assert.deepEqual(counts,{posts:1,media:1});
  f.sql(`update beauty_posts set deleted_at=now() where id='${first.postId}'`);
  assert.ok(f.http(3000,'/rpc/lookup_beauty_post_submission','POST',{p_request_id:requestId,p_input:rawInput},user.token).status>=400);
  assert.ok(f.http(3000,'/rpc/create_beauty_post_once','POST',{p_request_id:requestId,p_input:input,p_request_input:rawInput},user.token).status>=400);

  f.sql(`update auth.users set phone_confirmed_at=now() where id='${user.authId}';update abuse_system_settings set require_signed_context=false where id;`);
  const account=f.rpc(user,'ensure_personal_account_for_current_user',{p_account_name:'Public image fixture'})[0].account_id;
  const salon=f.rpc(user,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'Public image fixture',p_owner_is_staff:false,p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
  for(const kind of ['look','update']){
   const request=crypto.randomUUID(),path=kind==='look'?`${salon}/looks/${request}/${crypto.randomUUID()}.webp`:`${salon}/updates/${crypto.randomUUID()}.webp`;
   const manifest=f.rpc(user,'reserve_public_post_image',{p_bucket:'salon-profile-media',p_path:path,p_purpose:kind,p_salon_id:salon});
   assert.equal(upload('/object/public-image-quarantine/'+manifest.quarantine_path,user.token).status,200);
   f.sql(`insert into salon_profile_media_assets(salon_id,uploaded_by_user_id,bucket,object_path,purpose) values('${salon}','${user.profileId}','salon-profile-media','${path}','${kind}')`);
   const raw={salonId:salon,contentType:kind,caption:'Synthetic '+kind,imagePath:path},row={salon_id:salon,author_user_id:user.profileId,created_by_user_id:user.profileId,title:'Synthetic '+kind,caption:raw.caption,media_path:path,palette:[],update_type:'announcement'};
   const args={p_request_id:request,p_request:raw,p_kind:kind,p_row:row,p_hashtags:['fixture'+kind],p_booking:{bookingCtaEnabled:false}};
   // Failed approval rolls back draft, attachment, hashtags and request claim.
   assert.ok(f.http(3000,'/rpc/publish_salon_post_once','POST',args,user.token).status>=400);
   assert.equal(Number(f.sql(`select count(*) from salon_post_submission_requests where request_id='${request}'`)),0);
   assert.equal(Number(f.sql(`select count(*) from salon_profile_${kind==='look'?'looks':'updates'} where id='${request}'`)),0);
   assert.equal(f.sql(`select status from salon_profile_media_assets where object_path='${path}'`),'pending');
   assert.equal(upload('/object/salon-profile-media/'+path,f.serviceToken,{sha256:sha}).status,200);
   f.rpc(service,'finish_public_post_image',{p_bucket:'salon-profile-media',p_path:path,p_sha256:sha,p_width:2,p_height:2,p_bytes:bytes.length,p_provider:'isolated-fixture',p_model:'synthetic',p_policy_version:'test-v1'});
   const badConfig=f.http(3000,'/rpc/publish_salon_post_once','POST',{...args,p_booking:{primaryServiceId:crypto.randomUUID()}},user.token);
   assert.ok(badConfig.status>=400,'bad booking config must roll back even with approved bytes');
   assert.equal(Number(f.sql(`select count(*) from salon_post_submission_requests where request_id='${request}'`)),0);
   assert.equal(Number(f.sql(`select count(*) from salon_profile_${kind==='look'?'looks':'updates'} where id='${request}'`)),0);
   assert.equal(f.sql(`select status from salon_profile_media_assets where object_path='${path}'`),'pending');
   // Model an existing safety decision that arrives in a BEFORE INSERT
   // trigger. The RPC must not acknowledge publication or leave partial data.
   const postTable=`salon_profile_${kind==='look'?'looks':'updates'}`;
   f.sql(`create function fixture_insert_hold() returns trigger language plpgsql as $$begin new.safety_hold:=true;return new;end$$;create trigger ab_fixture_insert_hold before insert on ${postTable} for each row execute function fixture_insert_hold()`);
   try{
    assert.ok(f.http(3000,'/rpc/publish_salon_post_once','POST',args,user.token).status>=400);
    assert.equal(Number(f.sql(`select count(*) from salon_post_submission_requests where request_id='${request}'`)),0);
    assert.equal(Number(f.sql(`select count(*) from ${postTable} where id='${request}'`)),0);
    assert.equal(Number(f.sql(`select count(*) from salon_profile_${kind==='look'?'look':'update'}_hashtags where ${kind}_id='${request}'`)),0);
    assert.equal(f.sql(`select status from salon_profile_media_assets where object_path='${path}'`),'pending');
   }finally{f.sql(`drop trigger ab_fixture_insert_hold on ${postTable};drop function fixture_insert_hold()`);}
   const published=f.rpc(user,'publish_salon_post_once',args);assert.equal(published.id,request);assert.equal(published.status,'published');
   const retry=f.rpc(user,'publish_salon_post_once',{...args,p_row:{...row,title:'Server metadata changed'}});assert.deepEqual(retry,published);
   const lookup=f.rpc(user,'lookup_salon_post_submission',{p_request_id:request,p_request:raw});assert.equal(lookup.row.id,request);
   assert.equal(Number(f.sql(`select count(*) from salon_profile_${kind==='look'?'look':'update'}_hashtags where ${kind}_id='${request}'`)),1);
   assert.equal(f.sql(`select status from salon_profile_media_assets where object_path='${path}'`),'active');
   assert.ok(f.http(3000,'/rpc/publish_salon_post_once','POST',{...args,p_request:{...raw,caption:'Different'}},user.token).status>=400);
   f.sql(`update salon_profile_${kind==='look'?'looks':'updates'} set safety_hold=true where id='${request}'`);
   assert.ok(f.http(3000,'/rpc/lookup_salon_post_submission','POST',{p_request_id:request,p_request:raw},user.token).status>=400);
   assert.ok(f.http(3000,'/rpc/publish_salon_post_once','POST',args,user.token).status>=400);
   f.sql(`update salon_profile_${kind==='look'?'looks':'updates'} set status='archived' where id='${request}'`);
   assert.ok(f.http(3000,'/rpc/lookup_salon_post_submission','POST',{p_request_id:request,p_request:raw},user.token).status>=400);
   assert.ok(f.http(3000,'/rpc/publish_salon_post_once','POST',args,user.token).status>=400);
  }
  const abandonedPath=`${user.profileId}/beauty/image/${crypto.randomUUID()}.webp`,abandoned=f.rpc(user,'reserve_public_post_image',{p_bucket:bucket,p_path:abandonedPath,p_purpose:'image'});
  assert.equal(upload('/object/public-image-quarantine/'+abandoned.quarantine_path,user.token).status,200);
  f.sql(`update public_post_images set created_at=now()-interval '8 days' where object_path in ('${objectPath}','${abandonedPath}')`);
  const expiry=f.rpc(service,'claim_expired_public_image_staging',{p_limit:10});assert.equal(expiry.length,2);
  for(const image of expiry){
   assert.equal(f.rpc(service,'finish_public_image_staging_expiry',{p_bucket:image.bucket,p_path:image.object_path}),false);
   const removed=f.http(5000,'/object/public-image-quarantine','DELETE',{prefixes:[image.quarantine_path]},f.serviceToken);assert.equal(removed.status,200);
   assert.equal(f.rpc(service,'finish_public_image_staging_expiry',{p_bucket:image.bucket,p_path:image.object_path}),true);
  }
  assert.ok(upload('/object/public-image-quarantine/'+abandoned.quarantine_path,user.token).status>=400);
  assert.equal(f.sql(`select status from public_post_images where object_path='${objectPath}'`),'approved');
  assert.equal(f.http(5000,'/object/public/'+bucket+'/'+objectPath).status,200);
  // A second real PostgreSQL session finalizes erasure while holding the user
  // row. Actual service Storage upload must wait for that transaction and deny
  // its stale scan after the planner has collected and removed the manifest.
  const racing=f.person('deletion-upload-race'),racePath=`${racing.profileId}/beauty/image/${crypto.randomUUID()}.webp`;
  const raceManifest=f.rpc(racing,'reserve_public_post_image',{p_bucket:bucket,p_path:racePath,p_purpose:'image'});
  const deletion=cp.spawn(docker,['--context',context,'exec','-i',f.evidence.containers.db,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-At'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let deletionOutput='';
  const deletionDone=new Promise((resolve,reject)=>{deletion.once('error',reject);deletion.once('exit',code=>code===0?resolve():reject(new Error('Isolated erasure transaction failed')));});
  const locked=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{deletion.kill();reject(new Error('Isolated erasure lock was not acquired'));},10000);
   deletion.stdout.on('data',chunk=>{deletionOutput+=chunk.toString();if(deletionOutput.includes('ERASURE_LOCKED')){clearTimeout(timer);resolve();}});
   deletion.once('error',error=>{clearTimeout(timer);reject(error);});
   deletion.once('exit',()=>{if(!deletionOutput.includes('ERASURE_LOCKED')){clearTimeout(timer);reject(new Error('Isolated erasure exited before lock'));}});
  });
  deletion.stderr.resume();
  deletion.stdin.end(`begin;\nselect id from users where id='${racing.profileId}' for update;\nupdate users set status='pending_deletion',deletion_scheduled_for=now()-interval '1 day' where id='${racing.profileId}';\nselect finalize_account_deletion('${racing.profileId}');\n\\echo ERASURE_LOCKED\nselect pg_sleep(3);\ncommit;\n`);
  await locked;
  const latePublic=upload('/object/'+bucket+'/'+racePath,f.serviceToken,{sha256:sha});assert.ok(latePublic.status>=400,'late service upload resurrected erased image');
  await deletionDone;
  assert.ok(upload('/object/public-image-quarantine/'+raceManifest.quarantine_path,racing.token).status>=400);
  assert.ok(f.http(5000,'/object/public/'+bucket+'/'+racePath).status>=400);
  assert.equal(Number(f.sql(`select count(*) from storage.objects where bucket_id='${bucket}' and name='${racePath}'`)),0);
  assert.equal(Number(f.sql(`select count(*) from public_post_images where uploaded_by_user_id='${racing.profileId}'`)),0);
  assert.equal(Number(f.sql(`select count(*) from account_erasure_objects where user_id='${racing.profileId}' and disposition='purge' and object_path in ('${racePath}','${raceManifest.quarantine_path}')`)),2);

  const businessAuthor=f.person('legacy-business-creator'),businessPath=`${salon}/updates/${crypto.randomUUID()}.webp`,businessId=crypto.randomUUID();
  f.sql(`update auth.users set phone='15550001818',phone_confirmed_at=now() where id='${businessAuthor.authId}'`);
  // Model an old published business image whose author is NULL but creator and
  // Auth storage owner point at the deleting account. Legacy registration must
  // not turn its original retain_business plan into personal purge.
  f.sql(`insert into public_post_images(bucket,object_path,quarantine_path,uploaded_by_user_id,salon_id,purpose) values('salon-profile-media','${businessPath}','salon-profile-media/${businessPath}','${businessAuthor.profileId}','${salon}','update')`);
  assert.equal(upload('/object/salon-profile-media/'+businessPath,f.serviceToken,{sha256:sha}).status,200);
  f.rpc(service,'finish_public_post_image',{p_bucket:'salon-profile-media',p_path:businessPath,p_sha256:sha,p_width:2,p_height:2,p_bytes:bytes.length,p_provider:'isolated-fixture',p_model:'synthetic',p_policy_version:'test-v1'});
  const retainedFiles=[{bucket:'salon-profile-media',path:businessPath}];
  for(const retainedBucket of ['pos-display-media','payroll-paystubs','support-evidence']){
   const path=`${salon}/retained/${crypto.randomUUID()}.webp`;
   assert.equal(upload('/object/'+retainedBucket+'/'+path,f.serviceToken,{sha256:sha}).status,200);
   f.sql(`update storage.objects set owner='${businessAuthor.authId}',owner_id='${businessAuthor.authId}' where bucket_id='${retainedBucket}' and name='${path}'`);
   retainedFiles.push({bucket:retainedBucket,path});
  }
  for(const item of retainedFiles){
   assert.equal(downloadSha(item.bucket,item.path),sha);
   if(['payroll-paystubs','support-evidence'].includes(item.bucket)){
    assert.ok(f.http(5000,'/object/authenticated/'+item.bucket+'/'+item.path,'GET',undefined,other.token).status>=400);
    assert.ok(f.http(5000,'/object/public/'+item.bucket+'/'+item.path).status>=400);
   }
  }
  f.sql(`select set_config('request.jwt.claims','{"role":"service_role"}',false);update public_post_images set status='legacy' where object_path='${businessPath}';insert into salon_profile_updates(id,salon_id,author_user_id,created_by_user_id,title,status,media_path) values('${businessId}','${salon}',null,'${businessAuthor.profileId}','Historical business photo','published','${businessPath}');update storage.objects set owner='${businessAuthor.authId}',owner_id='${businessAuthor.authId}' where bucket_id='salon-profile-media' and name='${businessPath}';update users set status='pending_deletion',deletion_scheduled_for=now()-interval '1 day' where id='${businessAuthor.profileId}';select finalize_account_deletion('${businessAuthor.profileId}');`);
  assert.equal(f.sql(`select disposition from account_erasure_objects where user_id='${businessAuthor.profileId}' and object_path='${businessPath}'`),'retain_business');
  assert.equal(Number(f.sql(`select count(*) from public_post_images where uploaded_by_user_id='${businessAuthor.profileId}'`)),0);
  const copyArgs={bucketId:'salon-profile-media',sourceKey:businessPath,destinationKey:businessPath,copyMetadata:true};
  assert.ok(f.http(5000,'/object/copy','POST',copyArgs,f.serviceToken,['x-upsert: true']).status>=400,'no lease must not authorize a copy');
  let businessJob;
  for(let n=0;n<4&&!businessJob;n++){const job=f.rpc(service,'claim_account_erasure');if(job?.userId===businessAuthor.profileId)businessJob=job;}
  assert.ok(businessJob);
  f.sql(`update account_erasure_jobs set leased_until=now()-interval '1 minute' where user_id='${businessAuthor.profileId}'`);
  assert.ok(f.http(5000,'/object/copy','POST',copyArgs,f.serviceToken,['x-upsert: true']).status>=400,'expired lease must not authorize a copy');
  f.sql(`update account_erasure_jobs set leased_until=now()+interval '5 minutes' where user_id='${businessAuthor.profileId}'`);
  assert.ok(f.http(5000,'/object/copy','POST',copyArgs,user.token,['x-upsert: true']).status>=400,'authenticated user cannot use maintenance exception');
  for(const item of retainedFiles){
   const copied=f.http(5000,'/object/copy','POST',{bucketId:item.bucket,sourceKey:item.path,destinationKey:item.path,copyMetadata:true},f.serviceToken,['x-upsert: true']);assert.equal(copied.status,200,JSON.stringify(copied.data));
   assert.equal(Number(f.sql(`select count(*) from storage.objects where bucket_id='${item.bucket}' and name='${item.path}' and (owner='${businessAuthor.authId}' or owner_id='${businessAuthor.authId}')`)),0);
   assert.equal(downloadSha(item.bucket,item.path),sha);
   if(['payroll-paystubs','support-evidence'].includes(item.bucket)){
    assert.ok(f.http(5000,'/object/authenticated/'+item.bucket+'/'+item.path,'GET',undefined,other.token).status>=400);
    assert.ok(f.http(5000,'/object/public/'+item.bucket+'/'+item.path).status>=400);
   }
   f.rpc(service,'finish_account_erasure_object',{p_user_id:businessJob.userId,p_lease:businessJob.lease,p_bucket:item.bucket,p_path:item.path});
  }
  assert.ok(f.http(5000,'/object/copy','POST',copyArgs,f.serviceToken,['x-upsert: true']).status>=400,'completed task cannot authorize another copy');
  const deletedAuth=f.http(9999,'/admin/users/'+businessAuthor.authId,'DELETE',{should_soft_delete:false},f.serviceToken);assert.ok(deletedAuth.status>=200&&deletedAuth.status<300);
  f.rpc(service,'finish_account_erasure',{p_user_id:businessJob.userId,p_lease:businessJob.lease,p_error:null});
  assert.equal(f.sql(`select status from account_erasure_jobs where user_id='${businessAuthor.profileId}'`),'complete');
  f.save('public-image-safety-acceptance.json',{passed:true,migrationCount:f.evidence.migrationHashes.length,newMigrations:f.evidence.migrationHashes.filter(m=>m.file>='20261116215000'),privateUploadStatus:staged.status,servicePromotionStatus:promoted.status,clientPublicUploadDenied:true,privateAnonymousReadDenied:true,otherAuthorReadDenied:true,clientSigningDenied:true,legacySignedUploadDenied:legacyAttempt.status,exactStorageHashPinned:true,canonicalBeautyPublished:true,replayReturnedSamePost:true,reusedDifferentIntentDenied:true,rawIntentReceiptBeforeFreshAdmission:true,deletedBeautyNotResurrected:true,salonLookAndUpdateAtomicPublication:true,salonDraftRollbackOnMissingApproval:true,salonRollbackOnBadBookingConfig:true,salonHeldAndArchivedNotResurrected:true,sevenDayPrivateExpiryRemovedSourceOnly:true,concurrentErasureRejectsLateServiceUpload:true,legacyBusinessRetentionUnchanged:true,leasedSamePathServiceCopyDetachedAuthOwner:true,unleasedExpiredCompletedAndAuthenticatedCopiesDenied:true,retainedStorageBuckets:retainedFiles.map(r=>r.bucket),retainedByteSha256Unchanged:true,privateUnauthorizedReadsStillDenied:true,authHardDeleteAndStrictErasureCompletion:true,productionUsed:false,classifier:'Synthetic trusted verifier fixture; no provider call or real media'});
 }catch(error){if(f)f.save('public-image-safety-acceptance.json',{passed:false,stage:'failed',error:error.message,migrationCount:f.evidence.migrationHashes.length,newMigrations:f.evidence.migrationHashes.filter(m=>m.file>='20261116215000')});throw error;}finally{if(f)f.close();}
});
