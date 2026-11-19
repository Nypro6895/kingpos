import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

const migration='supabase/migrations/20261119011000_rights_case_evidence_query.sql';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

test('actual full-schema authenticated case enumeration has no private pointers and fails closed on role/source/risk changes',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async()=>{
 let f;const receipt={passed:false,productionUsed:false,bytesReadOrUploaded:false};
 try{
  f=await startIsolatedSupabase('rights-case-query',{
   db:'public.ecr.aws/supabase/postgres:17.11.0.006',auth:'public.ecr.aws/supabase/gotrue:v2.197.0',
   storage:'public.ecr.aws/supabase/storage-api:v1.84.19',rest:'public.ecr.aws/supabase/postgrest:v16.5',
  },{allowConcurrentFixtureCleanup:true});
  const author=f.person('case-author'),reviewer=f.person('case-reviewer'),reader=f.person('case-reader'),stranger=f.person('case-stranger'),service={token:f.serviceToken};
  const svc=`set request.jwt.claims='{"role":"service_role"}';`;
  f.sql(`update auth.users set phone='15550001891',phone_confirmed_at=now() where id='${author.authId}';
   insert into platform_admin_roles(slug,name) values('case-fixture-reviewer','Fixture reviewer'),('case-fixture-reader','Fixture reader');
   insert into platform_admin_role_permissions(role_id,permission_id) select r.id,p.id from platform_admin_roles r cross join platform_admin_permissions p
   where r.slug in('case-fixture-reviewer','case-fixture-reader') and(p.code in('admin.access','admin.reports.read')or(r.slug='case-fixture-reviewer'and p.code='admin.reports.update'));
   insert into platform_admin_memberships(user_id,role_id) select '${reviewer.profileId}',id from platform_admin_roles where slug='case-fixture-reviewer';
   insert into platform_admin_memberships(user_id,role_id) select '${reader.profileId}',id from platform_admin_roles where slug='case-fixture-reader';
   insert into beauty_profiles(user_id) values('${author.profileId}') on conflict(user_id) do nothing;`);
  const reviewerMembership=f.sql(`select id from platform_admin_memberships where user_id='${reviewer.profileId}'`),readerMembership=f.sql(`select id from platform_admin_memberships where user_id='${reader.profileId}'`);
  const digest='a'.repeat(64);
  function image(){
   const path=`${author.profileId}/beauty/image/${crypto.randomUUID()}.webp`,post=crypto.randomUUID();
   f.rpc(author,'reserve_public_post_image',{p_bucket:'beauty-profile-media',p_path:path,p_purpose:'image'});
   // Synthetic metadata only: the separate 190100 acceptance actually uploads,
   // hashes, streams and removes bytes. This test exercises the read selector.
   f.sql(`insert into storage.objects(bucket_id,name,version,metadata,user_metadata) values('beauty-profile-media','${path}','fixture-version',
    '{"size":16,"mimetype":"image/webp","eTag":"fixture-etag"}','{"sha256":"${digest}"}')`);
   const approved=f.rpc(service,'finish_public_post_image',{p_bucket:'beauty-profile-media',p_path:path,p_sha256:digest,p_width:2,p_height:2,p_bytes:16,p_provider:'synthetic',p_model:'metadata-only',p_policy_version:'fixture'});
   f.sql(`${svc}insert into beauty_posts(id,profile_id,author_user_id,caption) select '${post}',id,'${author.profileId}','Synthetic enumeration case' from beauty_profiles where user_id='${author.profileId}';
    insert into beauty_post_media(post_id,bucket,object_path,role) values('${post}','beauty-profile-media','${path}','image');`);
   return{post,path,objectId:approved.object_id};
  }
  function report(img,person=stranger,reason='intellectual_property'){
   f.rpc(person,'post_safety_action',{p_type:'beauty_post',p_id:img.post,p_action:'report',p_payload:{reason}});
   const c=f.json(`select row_to_json(c) from post_safety_cases c where source_id='${img.post}' and reporter_user_id='${person.profileId}' order by created_at desc limit 1`);
   const reportId=f.sql(`select coalesce((select report_id from review_support_links where kind='post_report' and request_id='${c.id}'),'${c.platform_report_id}'::uuid)`);
   f.sql(`update platform_reports set assigned_membership_id='${reviewerMembership}' where id='${reportId}'`);return{caseId:c.id,reportId};
  }
  const main=image(),foreign=image(),c=report(main),other=report(foreign);
  const load=(person=reviewer,caseId=c.caseId)=>f.rpc(person,'get_admin_rights_case_evidence',{p_case_id:caseId});
  let current=load();assert.equal(current.caseId,c.caseId);assert.equal(current.policyEnabled,false);assert.equal(current.canCapture,false);assert.equal(current.blockedReason,'policy_disabled');
  assert.deepEqual(current.photos,[{objectId:main.objectId,evidenceId:null,state:null}]);assert.ok(!JSON.stringify(current).includes(foreign.objectId));
  for(const forbidden of [main.path,'beauty-profile-media',digest,'fixture-etag','fixture-version','rights-review-evidence'])assert.ok(!JSON.stringify(current).includes(forbidden));
  for(const p of [null,author,stranger,reader])assert.ok(f.http(3000,'/rpc/get_admin_rights_case_evidence','POST',{p_case_id:c.caseId},p?.token).status>=400);
  assert.ok(f.http(3000,'/rpc/get_admin_rights_case_evidence','POST',{p_case_id:crypto.randomUUID()},reviewer.token).status>=400);
  f.sql('update rights_image_evidence_policy set enabled=true where id');current=load();assert.equal(current.canCapture,true);
  const requested=f.rpc(reviewer,'request_rights_image_evidence',{p_case_id:c.caseId,p_object_id:main.objectId,p_request_id:crypto.randomUUID(),p_safety_classification:'ordinary',p_reason:'Synthetic bounded operator request',p_remove_origin:false});
  current=load();assert.equal(current.photos[0].evidenceId,requested.id);assert.equal(current.photos[0].state.captured,false);assert.ok(current.photos[0].state.version);assert.equal(current.canCapture,false,'existing request must not create another UUID');
  for(const forbidden of [main.path,'beauty-profile-media',digest,'fixture-etag','fixture-version','rights-review-evidence'])assert.ok(!JSON.stringify(current).includes(forbidden));
  f.sql(`update platform_reports set assigned_membership_id='${readerMembership}' where id='${c.reportId}'`);
  const readonly=load(reader);assert.equal(readonly.canCapture,false);assert.equal(readonly.blockedReason,'permission');assert.equal(readonly.photos[0].state.canRequestRemoval,false);
  assert.ok(f.http(3000,'/rpc/get_admin_rights_case_evidence','POST',{p_case_id:c.caseId},reviewer.token).status>=400);
  f.sql(`update platform_reports set assigned_membership_id='${reviewerMembership}' where id='${c.reportId}';update platform_admin_memberships set status='revoked' where id='${reviewerMembership}'`);
  assert.ok(f.http(3000,'/rpc/get_admin_rights_case_evidence','POST',{p_case_id:c.caseId},reviewer.token).status>=400);
  f.sql(`update platform_admin_memberships set status='active' where id='${reviewerMembership}'`);
  f.sql(`delete from public_post_images where object_path='${main.path}'`);
  const historical=load();assert.equal(historical.photos[0].objectId,main.objectId);assert.equal(historical.photos[0].evidenceId,requested.id);assert.ok(historical.photos[0].state);assert.equal(historical.canCapture,false,'history remains without reopening capture authority');
  // A mismatched/new legacy source is omitted; existing evidence history on a
  // different case remains addressable only through that case's own authority.
  f.sql(`update public_post_images set status='legacy' where object_path='${foreign.path}'`);assert.deepEqual(load(reviewer,other.caseId).photos,[]);
  const minor=report(main,author,'minor_safety');assert.equal(load(reviewer,minor.caseId).blockedReason,'special_safety');assert.equal(load().blockedReason,'special_safety');
  assert.throws(()=>f.rpc(reviewer,'request_rights_image_evidence',{p_case_id:c.caseId,p_object_id:foreign.objectId,p_request_id:crypto.randomUUID(),p_safety_classification:'ordinary',p_reason:'Wrong source rejected',p_remove_origin:false}));
  const executed=f.evidence.migrationHashes.find(m=>m.file===migration.split('/').at(-1));assert.equal(executed.sha256,sha(fs.readFileSync(migration)));
  receipt.passed=true;receipt.migrations=f.evidence.migrationHashes;receipt.migrationSha256=executed.sha256;
  receipt.checks=['actual authenticated/PostgREST grants','canonical case-only object IDs','no paths/hash/Storage identity or URLs','disabled policy and assigned read/update distinction','existing evidence state envelope','revocation/assignment change','legacy omission','same-object and exact-byte special-risk block','wrong source binding rejected'];
  f.save('rights-case-query-acceptance.json',receipt);
 }catch(error){receipt.error=f?f.redact(error.message):String(error.message);f?.save('rights-case-query-acceptance.json',receipt);throw error;}
 finally{f?.close();}
});
