import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import sharp from 'sharp';
import {build} from 'esbuild';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

const migration='supabase/migrations/20261119010000_rights_image_evidence.sql';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('real isolated rights evidence: full schema, actual Storage, authorization, retention and lock races',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async t=>{
 let f;const receipt={passed:false,checks:[],productionOperations:false,providerRequests:false};
 try{
  f=await startIsolatedSupabase('rights-image-evidence',{
   db:'public.ecr.aws/supabase/postgres:17.11.0.006',auth:'public.ecr.aws/supabase/gotrue:v2.197.0',
   storage:'public.ecr.aws/supabase/storage-api:v1.84.19',rest:'public.ecr.aws/supabase/postgrest:v16.5',
  },{allowConcurrentFixtureCleanup:true});
  receipt.migrations=f.evidence.migrationHashes;receipt.sqlSha256=sha(fs.readFileSync(migration));
  const author=f.person('rights-author'),reviewer=f.person('rights-reviewer'),reader=f.person('rights-reader'),stranger=f.person('rights-stranger');
  const service={token:f.serviceToken},svc=`set request.jwt.claims='{"role":"service_role"}';`;
  f.sql(`update auth.users set phone='15550001881',phone_confirmed_at=now() where id='${author.authId}';
   insert into platform_admin_roles(slug,name) values('rights-fixture-reviewer','Fixture reviewer'),('rights-fixture-reader','Fixture reader');
   insert into platform_admin_role_permissions(role_id,permission_id) select r.id,p.id from platform_admin_roles r cross join platform_admin_permissions p
   where r.slug in('rights-fixture-reviewer','rights-fixture-reader') and(p.code in('admin.access','admin.reports.read')or(r.slug='rights-fixture-reviewer'and p.code='admin.reports.update'));
   insert into platform_admin_memberships(user_id,role_id) select '${reviewer.profileId}',id from platform_admin_roles where slug='rights-fixture-reviewer';
   insert into platform_admin_memberships(user_id,role_id) select '${reader.profileId}',id from platform_admin_roles where slug='rights-fixture-reader';
   insert into beauty_profiles(user_id) values('${author.profileId}') on conflict(user_id) do nothing;`);
  const membership=f.sql(`select id from platform_admin_memberships where user_id='${reviewer.profileId}'`);
  const docker='C:/Program Files/Docker/Docker/resources/bin/docker.exe',args=['--context','desktop-linux','exec','-i',f.evidence.containers.db];
  const execute=(cmd,input)=>cp.execFileSync(docker,[...args,...cmd],{input,encoding:'utf8',windowsHide:true,timeout:30000});
  const bytes=await sharp({create:{width:3,height:2,channels:3,background:'#31765d'}}).webp().toBuffer(),tmp='/tmp/rights-fixture.webp';
  execute(['sh','-c','cat > '+tmp],bytes);
  function upload(bucket,path,data=bytes,token=f.serviceToken){
   execute(['sh','-c','cat > '+tmp],data);
   const cfg=[`url = ${JSON.stringify('http://127.0.0.1:5000/object/'+bucket+'/'+path)}`,'request = "POST"','silent','show-error','fail','max-time = 20',
    'header = "Content-Type: image/webp"','header = '+JSON.stringify('Authorization: Bearer '+token),
    'header = '+JSON.stringify('x-metadata: '+Buffer.from(JSON.stringify({sha256:sha(data)})).toString('base64')),'data-binary = '+JSON.stringify('@'+tmp)].join('\n');
   return execute(['curl','--config','-'],cfg);
  }
  function download(bucket,path,token=f.serviceToken){
   const cfg=[`url = ${JSON.stringify('http://127.0.0.1:5000/object/authenticated/'+bucket+'/'+path)}`,'silent','show-error','fail','max-time = 20',
    'header = '+JSON.stringify('Authorization: Bearer '+token),'output = "/tmp/rights-download.webp"'].join('\n');
   execute(['curl','--config','-'],cfg);return Buffer.from(execute(['base64','-w','0','/tmp/rights-download.webp']),'base64');
  }
  const row=id=>f.json(`select row_to_json(e) from rights_image_evidence e where id='${id}'`);
  const due=()=>f.sql('update rights_image_evidence set checked_at=null;');
  let imageNumber=0,salonId=null;
  async function image({risk='ordinary',reason='intellectual_property',legacy=false,identicalTo=null,salonImage=false}={}){
   imageNumber++;
   const imageBytes=identicalTo?.imageBytes??await sharp({create:{width:3,height:2,channels:3,background:{r:20+imageNumber*7,g:70,b:100}}}).webp().toBuffer(),imageDigest=sha(imageBytes);
   if(salonImage&&!salonId){
    f.sql('update abuse_system_settings set require_signed_context=false where id;');
    const account=f.rpc(author,'ensure_personal_account_for_current_user',{p_account_name:'Rights image fixture'})[0].account_id;
    salonId=f.rpc(author,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'Rights image fixture',p_owner_is_staff:false,p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
   }
   const bucket=salonImage?'salon-profile-media':'beauty-profile-media',kind=salonImage?'salon_profile_update':'beauty_post';
   const path=salonImage?`${salonId}/updates/${crypto.randomUUID()}.webp`:`${author.profileId}/beauty/image/${crypto.randomUUID()}.webp`,post=crypto.randomUUID();
   f.rpc(author,'reserve_public_post_image',{p_bucket:bucket,p_path:path,p_purpose:salonImage?'update':'image',p_salon_id:salonImage?salonId:null});
   upload(bucket,path,imageBytes);
   const approved=f.rpc(service,'finish_public_post_image',{p_bucket:bucket,p_path:path,p_sha256:imageDigest,p_width:3,p_height:2,p_bytes:imageBytes.length,p_provider:'synthetic',p_model:'fixture',p_policy_version:'test'});
   if(salonImage)f.sql(`${svc}insert into salon_profile_updates(id,salon_id,created_by_user_id,author_user_id,title,caption,media_path,status) values('${post}','${salonId}','${author.profileId}','${author.profileId}','Synthetic rights image','Synthetic rights image','${path}','published')`);
   else f.sql(`${svc}insert into beauty_posts(id,profile_id,author_user_id,caption) select '${post}',id,'${author.profileId}','Synthetic rights image' from beauty_profiles where user_id='${author.profileId}';
    insert into beauty_post_media(post_id,bucket,object_path,role) values('${post}','${bucket}','${path}','image');`);
   f.rpc(stranger,'post_safety_action',{p_type:kind,p_id:post,p_action:'report',p_payload:{reason}});
   const c=f.json(`select row_to_json(c) from post_safety_cases c where source_id='${post}' order by created_at desc limit 1`);
   const report=f.sql(`select coalesce((select report_id from review_support_links where kind='post_report' and request_id='${c.id}'),'${c.platform_report_id}'::uuid)`);
   f.sql(`update platform_reports set assigned_membership_id='${membership}',created_at=now()-interval '2 hours' where id='${report}';update post_safety_cases set created_at=now()-interval '2 hours' where id='${c.id}';`);
   if(legacy)f.sql(`update public_post_images set status='legacy' where object_path='${path}'`);
   const input={p_case_id:c.id,p_object_id:approved.object_id,p_request_id:crypto.randomUUID(),p_safety_classification:risk,p_reason:'Synthetic authorized rights request',p_remove_origin:false};
   return {post,path,bucket,salonId,caseId:c.id,report,objectId:approved.object_id,input,imageBytes,digest:imageDigest};
  }
  const request=img=>f.rpc(reviewer,'request_rights_image_evidence',img.input);
  const claim=stage=>f.rpc(service,'claim_rights_image_evidence',{p_stage:stage,p_limit:1});
  const api={async rpc(name,input){try{return{data:f.rpc(service,name,input),error:null};}catch{return{data:null,error:{message:'Fixture RPC rejected'}};}},storage:{from(bucket){return{
   async download(path){try{return{data:new Blob([download(bucket,path)],{type:'image/webp'}),error:null};}catch{return{data:null,error:{message:'Fixture download rejected'}};}},
   async upload(path,data){try{upload(bucket,path,Buffer.from(data));return{data:{path},error:null};}catch{return{data:null,error:{message:'Fixture upload rejected'}};}},
   async remove(paths){const r=f.http(5000,'/object/'+bucket,'DELETE',{prefixes:paths},f.serviceToken);return{data:r.data,error:r.status===200?null:{message:'Fixture remove rejected'}};},
  };}}};
  receipt.workerSha256=sha(fs.readFileSync('lib/rights-evidence-worker.ts'));receipt.storageHelperSha256=sha(fs.readFileSync('lib/rights-evidence-storage.ts'));
  const built=await build({entryPoints:['lib/rights-evidence-worker.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'fixture-only',setup(b){
   b.onResolve({filter:/^server-only$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:''}));
  }}]});
  const worker=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  assert.equal(sha(fs.readFileSync('lib/rights-evidence-worker.ts')),receipt.workerSha256);assert.equal(sha(fs.readFileSync('lib/rights-evidence-storage.ts')),receipt.storageHelperSha256);
  const process=(job,stage)=>worker.processRightsImageEvidence(api,job,stage,Date.now()+45000);
  const accessBuilt=await build({entryPoints:['lib/rights-evidence-access.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'fixture-access',setup(b){
   b.onResolve({filter:/^(server-only|@\/lib\/supabase\/server)$/},a=>({path:a.path,namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='server-only'?'':'export async function createAuthenticatedSupabaseServerClient(){throw Error("Only injected fixture client allowed");}'}));
  }}]});
  const access=await import('data:text/javascript;base64,'+Buffer.from(accessBuilt.outputFiles[0].text).toString('base64'));
  const check=async(name,fn)=>{let passed=true;await t.test(name,async()=>{try{await fn();}catch(error){passed=false;throw error;}});receipt.checks.push({name,passed});f.save('rights-image-evidence-acceptance.json',receipt);assert.ok(passed,name);};

  await check('policy starts disabled; no invented operators; reporter/guest/reader cannot request or read paths',async()=>{
   assert.equal(f.sql('select enabled from rights_image_evidence_policy'),'f');
   const img=await image(),res=request(img);assert.equal(res.status,'blocked_policy');
   assert.deepEqual(claim('capture'),[]);assert.equal(f.rpc(reviewer,'authorize_rights_image_evidence_read',{p_id:res.id}),null);
   for(const p of [null,author,stranger,reader])assert.ok(f.http(3000,'/rpc/request_rights_image_evidence','POST',img.input,p?.token).status>=400);
   assert.ok(f.http(3000,'/rights_image_evidence?select=*','GET',undefined,stranger.token).status>=400);
   assert.ok(f.http(3000,'/rpc/claim_rights_image_evidence','POST',{p_stage:'capture'},reviewer.token).status>=400);
   assert.throws(()=>upload('rights-review-evidence',row(res.id).evidence_path));
   f.sql('update rights_image_evidence_policy set enabled=true where id;');due();
   const [job]=claim('capture');assert.equal(job.id,res.id);assert.equal(job.retain_until,null);
   assert.equal(f.rpc(service,'finish_rights_image_evidence_capture',{p_id:job.id,p_lease:job.lease_token}),false);
   assert.equal(await process(job,'capture'),'captured');
   assert.equal(sha(download(job.evidence_bucket,job.evidence_path)),img.digest);
   assert.ok(f.rpc(reviewer,'authorize_rights_image_evidence_read',{p_id:res.id}));
   f.sql("create policy rights_fixture_broad_read on storage.objects for select to anon,authenticated using(bucket_id='rights-review-evidence');");
   assert.ok(f.http(5000,'/object/authenticated/'+job.evidence_bucket+'/'+job.evidence_path,'GET',undefined,reviewer.token).status>=400);
   assert.ok(f.http(5000,'/object/sign/'+job.evidence_bucket+'/'+job.evidence_path,'POST',{expiresIn:60},reviewer.token).status>=400);
   const streamed=await access.serveRightsImageEvidence(new Request('https://fixture.invalid/evidence/'+res.id),res.id,{authenticatedClient:{async rpc(name,input){return{data:f.rpc(reviewer,name,input),error:null};}},serviceClient:api});
   assert.equal(streamed.status,200);assert.equal(sha(Buffer.from(await streamed.arrayBuffer())),img.digest);assert.ok(streamed.headers.get('cache-control').includes('no-store'));
   for(const p of [null,author,stranger,reader]){
    const grant=f.http(3000,'/rpc/authorize_rights_image_evidence_read','POST',{p_id:res.id},p?.token);
    assert.ok(grant.status>=400||grant.data===null);
    assert.ok(f.http(5000,'/object/authenticated/'+job.evidence_bucket+'/'+job.evidence_path,'GET',undefined,p?.token).status>=400);
    assert.ok(f.http(5000,'/object/sign/'+job.evidence_bucket+'/'+job.evidence_path,'POST',{expiresIn:60},p?.token).status>=400);
   }
   assert.equal(await process(job,'capture'),'blocked','old lease cannot capture again');
   assert.throws(()=>upload(job.evidence_bucket,job.evidence_path),'no immutable-key upsert');
   const replay=request(img);assert.equal(replay.id,res.id);
   assert.throws(()=>f.rpc(reviewer,'request_rights_image_evidence',{...img.input,p_reason:'Different request content'}));
   f.sql(`update platform_admin_memberships set status='revoked' where id='${membership}'`);
   assert.equal(f.rpc(reviewer,'authorize_rights_image_evidence_read',{p_id:res.id}),null);
   f.sql(`update platform_admin_memberships set status='active' where id='${membership}'`);
  });

  await check('canonical exact-case pinning rejects foreign objects, legacy and special illegal-risk material without byte operations',async()=>{
   const a=await image(),b=await image();
   assert.throws(()=>f.rpc(reviewer,'request_rights_image_evidence',{...a.input,p_object_id:b.objectId}));
   const old=await image({legacy:true});assert.throws(()=>request(old));
   for(const risk of ['unknown','suspected_csam','known_csam']){
    const img=await image({risk}),e=request(img);assert.equal(e.status,'escalation_required');
    assert.equal(f.rpc(reviewer,'authorize_rights_image_evidence_read',{p_id:e.id}),null);
   }
   const minor=await image({reason:'minor_safety'});assert.equal(request(minor).status,'escalation_required');
   const duplicate=await image({identicalTo:minor});request(duplicate);due();assert.deepEqual(claim('capture'),[],'known identical minor-safety object cannot use an ordinary case download');
   due();const jobs=claim('capture');assert.ok(!jobs.some(j=>row(j.id).status==='escalation_required'));
  });

  await check('actual public origin removal requires exact private receipt, terminal deletion and no shared references; tombstone prevents recreation',async()=>{
   const img=await image({salonImage:true}),res=request(img);due();
   const [job]=claim('capture');assert.equal(job.id,res.id);assert.equal(await process(job,'capture'),'captured');
   due();assert.deepEqual(claim('remove_origin'),[],'capture is not removal authorization');
   let current=f.rpc(reviewer,'get_admin_rights_image_evidence_state',{p_id:res.id});assert.equal(current.removalBlockedReason,'shared_references');
   f.sql(`${svc}delete from salon_profile_updates where id='${img.post}';update salon_settings set public_profile_cover_path='${img.path}' where salon_id='${img.salonId}';`);
   due();assert.deepEqual(claim('remove_origin'),[],'business/profile cover retained');
   f.sql(`${svc}update salon_settings set public_profile_cover_path=null where salon_id='${img.salonId}'`);due();
   const previousVersion=current.version;current=f.rpc(reviewer,'get_admin_rights_image_evidence_state',{p_id:res.id});assert.equal(current.canRequestRemoval,true);
   const decision={p_evidence_id:res.id,p_request_id:crypto.randomUUID(),p_expected_version:current.version,p_reason:'Synthetic separately reviewed exact origin removal'};
   assert.equal(f.rpc(reviewer,'request_rights_origin_removal',{...decision,p_expected_version:previousVersion}).code,'stale');
   const authorized=f.rpc(reviewer,'request_rights_origin_removal',decision);assert.equal(authorized.ok,true);assert.equal(authorized.state.removalBlockedReason,'already_requested');
   assert.deepEqual(f.rpc(reviewer,'request_rights_origin_removal',decision),authorized,'lost success replays immutable receipt before current-version check');
   assert.equal(f.rpc(reviewer,'request_rights_origin_removal',{...decision,p_reason:'Conflicting replay reason'}).code,'conflict');
   assert.throws(()=>f.sql('update rights_origin_removal_requests set reason=\'Rewrite history\''),/immutable/i);
   const [remove]=claim('remove_origin');assert.equal(remove.id,res.id);
   assert.equal(f.rpc(service,'finish_rights_image_evidence_removal',{p_id:remove.id,p_lease:remove.lease_token}),false);
   assert.throws(()=>f.sql(`${svc}update salon_settings set public_profile_cover_path='${img.path}' where salon_id='${img.salonId}'`));
   assert.equal(await process(remove,'remove_origin'),'removed');
   assert.equal(f.sql(`select count(*) from storage.objects where bucket_id='${img.bucket}' and name='${img.path}'`),'0');
   assert.ok(f.http(5000,'/object/public/'+img.bucket+'/'+img.path).status>=400);
   assert.throws(()=>upload(img.bucket,img.path));
   f.sql(`${svc}update post_safety_cases set status='dismissed',resolution='Synthetic case metadata update' where id='${img.caseId}'`);
   assert.equal(row(res.id).status,'origin_removed');
  });

  await check('resolved is not closed; closed+30days deadline, reopen and explicit hold cancel or block purge safely',async()=>{
   const img=await image({remove:false}),res=request(img);due();const [job]=claim('capture');assert.equal(job.id,res.id);assert.equal(await process(job,'capture'),'captured');
   f.rpc(reviewer,'review_post_safety_with_message',{p_case_id:img.caseId,p_action:'keep_public',p_reason:'Synthetic case reviewed without a violation',p_public_message:'Synthetic reviewer explanation for this isolated case',p_request_id:crypto.randomUUID()});
   f.sql(`update platform_reports set status='resolved',resolved_at=now()-interval '60 days' where id='${img.report}'`);due();
   assert.deepEqual(claim('purge'),[]);assert.equal(f.rpc(reviewer,'authorize_rights_image_evidence_read',{p_id:res.id}).retain_until,null);
   f.sql(`update platform_reports set status='closed',closed_at=now()-interval '29 days' where id='${img.report}'`);due();assert.deepEqual(claim('purge'),[]);
   f.sql(`update platform_reports set closed_at=now()-interval '31 days' where id='${img.report}'`);due();
   const [purge]=claim('purge');assert.equal(purge.id,res.id);
   assert.throws(()=>f.sql(`update platform_reports set status='under_review',closed_at=null where id='${img.report}'`),/purge is in progress/i);
   f.sql(`insert into rights_image_evidence_holds(case_id,reason,owner_authority_ref,review_at) values('${img.caseId}','Synthetic separately approved hold','fixture-owner-authority',now()+interval '2 days')`);
   assert.equal(f.rpc(service,'revalidate_rights_image_evidence',{p_id:res.id,p_lease:purge.lease_token}),false);
   assert.ok(f.http(5000,'/object/rights-review-evidence','DELETE',{prefixes:[purge.evidence_path]},f.serviceToken).status>=400);
   f.sql(`update platform_reports set status='under_review',closed_at=null where id='${img.report}';
    update rights_image_evidence_holds set released_at=now(),released_authority_ref='fixture-owner-release' where case_id='${img.caseId}'`);due();assert.deepEqual(claim('purge'),[]);
   f.sql(`update platform_reports set status='closed',closed_at=now()-interval '31 days' where id='${img.report}'`);due();
   const [again]=claim('purge');assert.equal(again.id,res.id);assert.equal(await process(again,'purge'),'purged');
   assert.equal(f.sql(`select count(*) from storage.objects where bucket_id='rights-review-evidence' and name='${again.evidence_path}'`),'0');
   assert.equal(f.rpc(reviewer,'authorize_rights_image_evidence_read',{p_id:res.id}),null);
   f.sql(`update platform_reports set status='under_review',closed_at=null where id='${img.report}'`);
   assert.equal(f.rpc(reviewer,'authorize_rights_image_evidence_read',{p_id:res.id}),null,'reopen never recreates purged evidence');
  });

  await check('account erasure plans exact reserved private paths, denies late capture and preserves shipped retain_business authority',async()=>{
   const img=await image({remove:false}),res=request(img);due();const [job]=claim('capture');assert.equal(job.id,res.id);assert.equal(await process(job,'capture'),'captured');
   const late=await image({remove:false}),lateRes=request(late);due();const [lateJob]=claim('capture');assert.equal(lateJob.id,lateRes.id);
   f.sql(`${svc}select prepare_account_erasure('${author.profileId}','${author.authId}','fixture@example.invalid');`);
   assert.equal(f.sql(`select disposition from account_erasure_objects where user_id='${author.profileId}' and bucket_id='rights-review-evidence' and object_path='${job.evidence_path}'`),'purge');
   assert.equal(f.sql(`select disposition from account_erasure_objects where user_id='${author.profileId}' and bucket_id='rights-review-evidence' and object_path='${lateJob.evidence_path}'`),'purge');
   assert.equal(f.rpc(service,'revalidate_rights_image_evidence',{p_id:lateJob.id,p_lease:lateJob.lease_token}),false);assert.throws(()=>upload(lateJob.evidence_bucket,lateJob.evidence_path));
   f.sql(`update account_erasure_jobs set status='processing',lease_token=gen_random_uuid(),leased_until=now()+interval '6 minutes' where user_id='${author.profileId}'`);
   assert.equal(f.http(5000,'/object/rights-review-evidence','DELETE',{prefixes:[job.evidence_path]},f.serviceToken).status,200);
   assert.equal(f.sql(`select count(*) from storage.objects where bucket_id='rights-review-evidence' and name='${job.evidence_path}'`),'0');
   assert.throws(()=>upload(job.evidence_bucket,job.evidence_path));
   assert.ok(f.sql("select pg_get_functiondef('public.guard_public_post_image_storage()'::regprocedure)").includes("disposition='retain_business'"));
   // Fixture cleanup only: allow subsequent concurrency fixtures for this same
   // synthetic actor; no production erasure state is touched by this test.
   f.sql(`delete from account_erasure_jobs where user_id='${author.profileId}'`);
  });

  await check('two-session user/report locks fail closed and stale leases never checkpoint; replay preserves receipts',async()=>{
   const img=await image({remove:false}),res=request(img);due();
   function concurrent(sql){const child=cp.spawn(docker,[...args,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-At'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',error='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>error+=b);child.stdin.end(sql);return new Promise((resolve,reject)=>child.on('exit',code=>code===0?resolve(out):reject(Error(error))));}
   async function marker(n){for(let i=0;i<50;i++){if(f.sql(`select exists(select 1 from pg_locks where locktype='advisory' and objid=${n} and granted)`)==='t')return;await new Promise(r=>setTimeout(r,30));}throw Error('Synthetic lock marker not reached');}
   const held=concurrent(`begin;select 1 from users where id='${author.profileId}' for update;select pg_advisory_xact_lock(910001);select pg_sleep(3);commit;`);
   await marker(910001);try{assert.deepEqual(claim('capture'),[]);}finally{await held;}
   due();const [job]=claim('capture');assert.equal(job.id,res.id);
   f.sql(`update rights_image_evidence set leased_until=now()-interval '1 second' where id='${job.id}'`);
   assert.equal(f.rpc(service,'finish_rights_image_evidence_capture',{p_id:job.id,p_lease:job.lease_token}),false);
   due();const [retry]=claim('capture');assert.notEqual(retry.lease_token,job.lease_token);assert.equal(await process(retry,'capture'),'captured');
   const reportHeld=concurrent(`begin;select 1 from platform_reports where id='${img.report}' for update;select pg_advisory_xact_lock(910002);select pg_sleep(3);commit;`);
   await marker(910002);try{assert.equal(f.rpc(reviewer,'authorize_rights_image_evidence_read',{p_id:res.id}),null);}finally{await reportHeld;}
   assert.ok(f.rpc(reviewer,'authorize_rights_image_evidence_read',{p_id:res.id}));
   const duplicate=await image({identicalTo:img});
   const reviewerClaims=`set request.jwt.claims='{"role":"authenticated","sub":"${reviewer.authId}"}';`;
   // Actual minor-safety intake holds the exclusive exact-byte fence before
   // its uncommitted case is visible to another connection. Routine private
   // operations must fail closed, not rely only on the older visible snapshot.
   const riskWriter=concurrent(`begin;${reviewerClaims}select post_safety_action('beauty_post','${duplicate.post}','report','{"reason":"minor_safety"}');select pg_advisory_xact_lock(910003);select pg_sleep(3);rollback;`);
   await marker(910003);try{
    assert.equal(f.rpc(reviewer,'authorize_rights_image_evidence_read',{p_id:res.id}),null);
    assert.throws(()=>f.sql(`${svc}select rights_evidence_lock('${res.id}')`),/Photo risk transition is busy/);
   }finally{await riskWriter;}
   assert.ok(f.rpc(reviewer,'authorize_rights_image_evidence_read',{p_id:res.id}));
   const riskReader=concurrent(`begin;${svc}select rights_evidence_lock('${res.id}');select pg_advisory_xact_lock(910004);select pg_sleep(3);rollback;`);
   await marker(910004);try{
    const blocked=f.http(3000,'/rpc/request_rights_image_evidence','POST',{...duplicate.input,p_safety_classification:'unknown'},reviewer.token);
    assert.ok(blocked.status>=400);assert.equal(f.sql(`select count(*) from rights_image_evidence where case_id='${duplicate.caseId}'`),'0');
   }finally{await riskReader;}
   const before=f.sql('select count(*) from rights_image_evidence');f.sql(fs.readFileSync(migration,'utf8'));assert.equal(f.sql('select count(*) from rights_image_evidence'),before);
   assert.equal(f.sql('select enabled from rights_image_evidence_policy'),'t','migration does not overwrite reviewed existing configuration');
  });
  await check('ordinary legal hold does not override personal erasure; unsupported retention is rejected and strict final completion follows actual byte absence',async()=>{
   const img=await image(),res=request(img);due();const [job]=claim('capture');assert.equal(job.id,res.id);assert.equal(await process(job,'capture'),'captured');
   f.sql(`insert into rights_image_evidence_holds(case_id,reason,owner_authority_ref,review_at) values('${img.caseId}','Synthetic explicit ordinary hold','fixture-owner-authority',now()+interval '2 days')`);
   assert.throws(()=>f.sql(`update rights_image_evidence_holds set retain_on_account_erasure=true where case_id='${img.caseId}'`),/rights_image_evidence_no_erasure_retention/);
   f.sql(`${svc}select prepare_account_erasure('${author.profileId}','${author.authId}','fixture@example.invalid');`);
   assert.equal(f.sql(`select disposition from account_erasure_objects where user_id='${author.profileId}' and bucket_id='rights-review-evidence' and object_path='${job.evidence_path}'`),'purge');
   f.sql(`update users set status='deleted',deletion_requested_at=now()-interval '2 days',deletion_scheduled_for=now()-interval '1 day' where id='${author.profileId}'`);
   const lease=f.sql(`update account_erasure_jobs set status='processing',lease_token=gen_random_uuid(),leased_until=now()+interval '6 minutes' where user_id='${author.profileId}' returning lease_token` ).split('\n')[0];
   assert.throws(()=>f.rpc(service,'finish_account_erasure',{p_user_id:author.profileId,p_lease:lease}));
   for(let batch=0;batch<4;batch++){
    const objects=f.rpc(service,'account_erasure_batch',{p_user_id:author.profileId,p_lease:lease});if(!objects.length)break;
    for(const object of objects){
     assert.equal(object.disposition,'purge');assert.equal(f.http(5000,'/object/'+object.bucket_id,'DELETE',{prefixes:[object.object_path]},f.serviceToken).status,200);
     f.rpc(service,'finish_account_erasure_object',{p_user_id:author.profileId,p_lease:lease,p_bucket:object.bucket_id,p_path:object.object_path});
    }
   }
   assert.deepEqual(f.rpc(service,'account_erasure_batch',{p_user_id:author.profileId,p_lease:lease}),[]);
   assert.equal(f.sql(`select count(*) from storage.objects where bucket_id='rights-review-evidence' and name='${job.evidence_path}'`),'0');
   assert.throws(()=>f.rpc(service,'finish_account_erasure',{p_user_id:author.profileId,p_lease:lease}),/Authentication erasure is incomplete/);
   f.sql(`begin;${svc}update users set status='deleted',deletion_scheduled_for=now()-interval '1 day' where id='${author.profileId}';select set_config('reylumi.account_erasure_user','${author.profileId}',true);select erase_account_personal_content('${author.profileId}','${author.authId}');commit;`);
   assert.equal(f.http(9999,'/admin/users/'+author.authId,'DELETE',{should_soft_delete:false},f.serviceToken).status,200);
   f.rpc(service,'finish_account_erasure',{p_user_id:author.profileId,p_lease:lease});assert.equal(f.sql(`select status from account_erasure_jobs where user_id='${author.profileId}'`),'complete');
  });
  assert.ok(receipt.checks.every(c=>c.passed),'All acceptance sections must pass before a success receipt');
  assert.equal(sha(fs.readFileSync('lib/rights-evidence-worker.ts')),receipt.workerSha256);assert.equal(sha(fs.readFileSync('lib/rights-evidence-storage.ts')),receipt.storageHelperSha256);
  assert.equal(f.evidence.migrationHashes.find(m=>m.file===migration.split('/').at(-1)).sha256,sha(fs.readFileSync(migration)),'SQL changed after execution');
  receipt.passed=true;receipt.finishedAt=new Date().toISOString();f.save('rights-image-evidence-acceptance.json',receipt);
 }catch(error){receipt.error=f?f.redact(error.message):String(error.message);if(f)f.save('rights-image-evidence-acceptance.json',receipt);throw error;}
 finally{f?.close();}
});
