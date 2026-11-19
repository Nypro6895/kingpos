import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

const uuid=()=>crypto.randomUUID();
const literal=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
async function withIdentityErasureLock(f,userId,action){
 const marker=crypto.randomInt(1000000,2000000000);
 const binary=process.env.TEST_DOCKER_PATH||(process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker');
 const context=process.env.TEST_DOCKER_CONTEXT||(process.platform==='win32'?'desktop-linux':'default');
 const child=cp.spawn(binary,['--context',context,'exec','-i',f.evidence.containers.db,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-At'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let errors='';child.stderr.on('data',b=>{errors+=String(b);});child.stdout.resume();
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(errors.slice(0,1000))));});
 child.stdin.write(`begin;update public.users set status='deleted' where id='${userId}';select pg_advisory_xact_lock(${marker});\n`);
 try{
  let ready=false;
  for(let i=0;i<60;i++){
   if(f.sql(`select exists(select 1 from pg_locks where locktype='advisory' and objid=${marker} and granted)`)==='t'){ready=true;break;}
   await new Promise(r=>setTimeout(r,20));
  }
  assert.equal(ready,true,'the real transaction must hold the changed identity before racing admission');
  await action();
 }finally{child.stdin.end('rollback;\n');await done;}
}
test('actual full-schema ad intake: canonical authority, private evidence, actor-bound replay, quota, erasure and media fences',async()=>{
 let f;const checks=[];
 try{
  const images=JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{"db":"public.ecr.aws/supabase/postgres:17.11.0.006","auth":"public.ecr.aws/supabase/gotrue:v2.197.0","storage":"public.ecr.aws/supabase/storage-api:v1.84.19","rest":"public.ecr.aws/supabase/postgrest:v16.5"}');
  f=await startIsolatedSupabase('ad-report-evidence',images,{allowConcurrentFixtureCleanup:true});
  const service={token:f.serviceToken},owner=f.person('advertiser'),viewer=f.person('reporter'),outsider=f.person('outsider'),admin=f.person('ad-reviewer');
  const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Synthetic advertising fixture'})[0].account_id;
  const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:uuid(),p_name:'Synthetic advertising fixture',p_owner_is_staff:false,p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
  const campaign=uuid(),creative=uuid(),platform=uuid();
  f.sql(`select campaign_plugin_set('${salon}','${owner.profileId}',true);
   insert into owner_campaign_creatives(id,salon_id,author_user_id,title,caption,media_path) values('${creative}','${salon}','${owner.profileId}','Synthetic ad','Original synthetic caption','${salon}/synthetic.webp');
   insert into owner_campaigns(id,salon_id,owner_id,source_type,source_id,title,area,location,country,days,daily_views,daily_price_cents,total_price_cents,credit_view_limit) values('${campaign}','${salon}','${owner.profileId}','custom','${creative}','Synthetic ad','country','US','US',1,100,100,100,100);
   insert into explore_campaigns(id,config) values('${platform}',${literal({id:platform})});
   insert into platform_admin_roles(slug,name) values('ad-fixture-reviewer','Synthetic ad reviewer');
   insert into platform_admin_role_permissions(role_id,permission_id) select r.id,p.id from platform_admin_roles r cross join platform_admin_permissions p where r.slug='ad-fixture-reviewer' and p.code in('admin.access','admin.reports.read');
   insert into platform_admin_memberships(user_id,role_id) select '${admin.profileId}',id from platform_admin_roles where slug='ad-fixture-reviewer';`);
  const stamp=new Date().toISOString();
  const target={kind:'owner_campaign',campaignId:campaign,sourceType:'custom',sourceId:creative,salonId:salon};
  const snapshot={advertiserName:'Synthetic advertiser',title:'Synthetic ad',caption:'Original synthetic caption',mediaBucket:'campaign-creatives',mediaPath:`${salon}/synthetic.webp`,destinationPath:`/salons/${salon}`,selectedAt:stamp};
  const summary={locationSource:'gps',areaLabel:'Milwaukee, WI',searchKind:'service',searchCategory:'Nails',page:'explore',device:'mobile',audience:'personal',selectionRuleCodes:['area_match','campaign_eligible'],selectedAt:stamp};
  const args=(extra={})=>({p_request_id:uuid(),p_actor_user_id:viewer.profileId,p_guest_actor_key:null,p_target:target,p_snapshot:snapshot,p_summary:summary,p_reason:'scam',p_details:'Synthetic concern',p_payload_sha256:crypto.createHash('sha256').update(uuid()).digest('hex'),...extra});
  const submit=a=>f.rpc(service,'submit_verified_ad_report',a);
  const lookup=a=>f.rpc(service,'get_verified_ad_report_receipt',{p_request_id:a.p_request_id,p_actor_user_id:a.p_actor_user_id,p_guest_actor_key:a.p_guest_actor_key,p_payload_sha256:a.p_payload_sha256});
  const a=args(),receipt=submit(a);assert.match(receipt.reference,/^RPT-/);assert.equal(receipt.guestThreadId,null);
  assert.deepEqual(submit(a),receipt);assert.deepEqual(lookup(a),receipt);
  assert.throws(()=>submit({...a,p_details:'Changed exact retry'}),/conflict/);
  assert.equal(lookup({...a,p_actor_user_id:outsider.profileId}),null);
  assert.equal(f.rpc(viewer,'get_support_conversation',{p_report_id:receipt.reportId}).context.module,'advertising_report');
  assert.throws(()=>f.rpc(outsider,'get_admin_ad_report_evidence',{p_report_id:receipt.reportId}),/permission|access/i);
  assert.throws(()=>f.rest(viewer,'/ad_report_evidence?select=*'),/permission/);
  assert.throws(()=>f.rpc(viewer,'submit_verified_ad_report',args()),/permission/);
  const evidence=f.rpc(admin,'get_admin_ad_report_evidence',{p_report_id:receipt.reportId});assert.deepEqual(evidence.target,target);assert.deepEqual(evidence.snapshot,snapshot);assert.equal(evidence.reviewHref,'/admin/plugins/campaigns');
  assert.ok(!JSON.stringify(evidence).includes(a.p_payload_sha256));checks.push('real Auth/PostgREST service-only intake, private table, admin permission and Support conversation');
  for(const bad of [
   {p_target:{...target,kind:null}},
   {p_target:{...target,sourceId:uuid()}},
   {p_target:{...target,salonId:uuid()}},
   {p_target:{...target,sourceType:'beauty_post'}},
   {p_target:{...target,extra:'forged'}},
   {p_summary:{...summary,latitude:43.0389}},
   {p_summary:{...summary,query:'private arbitrary query'}},
   {p_snapshot:{...snapshot,ticket:'do not persist'}},
   {p_snapshot:{...snapshot,mediaPath:'../other.webp'}},
   {p_snapshot:{...snapshot,destinationPath:'https://untrusted.invalid/'}},
   {p_snapshot:{...snapshot,selectedAt:'infinity'}},
   {p_snapshot:{...snapshot,selectedAt:'2099-01-01T00:00:00Z'}},
   {p_actor_user_id:viewer.profileId,p_guest_actor_key:'a'.repeat(64)},
  ])assert.throws(()=>submit(args(bad)),/Invalid|unavailable/);
  assert.equal(f.sql('select count(*) from ad_report_evidence'),'1');checks.push('forged identity, unknown JSON fields, private location/query/ticket, paths and selection time rejected atomically');
  f.sql(`update owner_campaign_creatives set caption='Updated since this verified selection' where id='${creative}'`);
  const oldSnapshot=submit(args());assert.equal(f.rpc(admin,'get_admin_ad_report_evidence',{p_report_id:oldSnapshot.reportId}).snapshot.caption,snapshot.caption);
  const guest=args({p_actor_user_id:null,p_guest_actor_key:'b'.repeat(64)}),guestReceipt=submit(guest);
  assert.equal(guestReceipt.guestThreadId,null);assert.deepEqual(lookup(guest),guestReceipt);
  assert.equal(f.sql(`select source from platform_reports where id='${guestReceipt.reportId}'`),'advertising_report');
  assert.equal(f.sql('select count(*) from support_inbox_threads'),'0');checks.push('verified old creative snapshot preserved, guest receipt without fabricated email or conversation');
  const platformTarget={kind:'platform_campaign',campaignId:platform,sourceType:'explore_campaign',sourceId:platform,salonId:null};
  const platformReceipt=submit(args({p_target:platformTarget,p_snapshot:{...snapshot,mediaBucket:null,mediaPath:null,destinationPath:null}}));
  assert.equal(f.rpc(admin,'get_admin_ad_report_evidence',{p_report_id:platformReceipt.reportId}).reviewHref,'/admin/advertising');
  assert.throws(()=>submit(args({p_target:{...platformTarget,sourceId:creative}})),/unavailable/);
  // Report reception and Support close never become campaign/billing decisions.
  f.sql(`update platform_reports set status='closed',closed_at=now() where id='${receipt.reportId}'`);
  assert.equal(f.sql(`select status||':'||views::text||':'||clicks::text||':'||spent_cents::text from owner_campaigns where id='${campaign}'`),'awaiting_payment:0:0:0');
  while(Number(f.sql(`select count(*) from ad_report_evidence where actor_user_id='${viewer.profileId}'`))<5)submit(args());
  assert.throws(()=>submit(args()),/Too many/);assert.deepEqual(submit(a),receipt);checks.push('owner/platform targets distinct, atomic quota, retry before quota, no visibility or billable events');
  // Capture a genuine allowed media reference without downloading any media.
  const photoPath=`${owner.profileId}/beauty/image/${uuid()}.webp`;
  f.sql(`insert into public_post_images(bucket,object_path,quarantine_path,uploaded_by_user_id,purpose,status) values('beauty-profile-media','${photoPath}','beauty-profile-media/${photoPath}','${owner.profileId}','image','legacy')`);
  const photoArgs=args({p_actor_user_id:outsider.profileId,p_snapshot:{...snapshot,mediaBucket:'beauty-profile-media',mediaPath:photoPath}});
  submit(photoArgs);assert.equal(f.sql(`select public_post_media_has_reference('beauty-profile-media','${photoPath}')`),'t');
  f.sql(`update public_post_images set status='approved',public_deletion_fenced_at=now() where bucket='beauty-profile-media' and object_path='${photoPath}'`);
  assert.throws(()=>submit(args({p_actor_user_id:outsider.profileId,p_snapshot:photoArgs.p_snapshot})),/no longer available|Removed photo/);checks.push('old ordinary cleanup reference and permanently fenced-key report admission');
  await withIdentityErasureLock(f,outsider.profileId,()=>assert.throws(()=>submit(args({p_actor_user_id:outsider.profileId})),/lock|unavailable/i));
  await withIdentityErasureLock(f,owner.profileId,()=>assert.throws(()=>submit(args({p_actor_user_id:outsider.profileId})),/lock|unavailable/i));
  checks.push('concurrent reporter/source erasure prevents stale private evidence recreation under actual row locks');
  const staffAuthor=f.person('staff-author'),creator=f.person('staff-creator');
  const look=uuid(),update=uuid(),lookCampaign=uuid(),updateCampaign=uuid();
  f.sql(`set request.jwt.claims='{"role":"service_role"}';
   update auth.users set phone='15550001981',phone_confirmed_at=now() where id='${owner.authId}';
   update auth.users set phone='15550001982',phone_confirmed_at=now() where id='${staffAuthor.authId}';
   update auth.users set phone='15550001983',phone_confirmed_at=now() where id='${creator.authId}';
   insert into salon_profile_looks(id,salon_id,author_user_id,created_by_user_id,title) values('${look}','${salon}','${staffAuthor.profileId}','${owner.profileId}','Synthetic staff look');
   insert into salon_profile_updates(id,salon_id,author_user_id,created_by_user_id,title) values('${update}','${salon}','${owner.profileId}','${creator.profileId}','Synthetic staff update');
   insert into owner_campaigns(id,salon_id,owner_id,source_type,source_id,title,area,location,country,days,daily_views,daily_price_cents,total_price_cents,credit_view_limit) values
   ('${lookCampaign}','${salon}','${owner.profileId}','salon_profile_look','${look}','Synthetic staff look','country','US','US',1,100,100,100,100),
   ('${updateCampaign}','${salon}','${owner.profileId}','salon_profile_update','${update}','Synthetic staff update','country','US','US',1,100,100,100,100);`);
  const staffReport=(campaignId,sourceId,sourceType)=>submit(args({p_actor_user_id:outsider.profileId,p_target:{...target,campaignId,sourceId,sourceType},p_snapshot:{...snapshot,mediaBucket:null,mediaPath:null}}));
  const lookReceipt=staffReport(lookCampaign,look,'salon_profile_look'),updateReceipt=staffReport(updateCampaign,update,'salon_profile_update');
  assert.equal(f.sql(`select source_author_user_id from ad_report_evidence where report_id='${lookReceipt.reportId}'`),staffAuthor.profileId);
  assert.equal(f.sql(`select source_creator_user_id from ad_report_evidence where report_id='${updateReceipt.reportId}'`),creator.profileId);
  f.sql(`update users set status='deleted' where id='${creator.profileId}'`);
  assert.equal(f.rpc(admin,'get_admin_ad_report_evidence',{p_report_id:updateReceipt.reportId}),null);
  assert.ok(f.rpc(admin,'get_admin_ad_report_evidence',{p_report_id:lookReceipt.reportId}));
  f.sql(`update users set status='deleted' where id='${staffAuthor.profileId}'`);
  assert.equal(f.rpc(admin,'get_admin_ad_report_evidence',{p_report_id:lookReceipt.reportId}),null);
  checks.push('Salon staff author, independent creator and campaign owner remain distinct erasure identities');
  // New private evidence does not invent a post-erasure retention exception.
  f.sql(`update users set status='deleted' where id='${viewer.profileId}'`);
  assert.equal(f.sql(`select count(*) from ad_report_evidence where actor_user_id='${viewer.profileId}'`),'0');
  assert.equal(f.rpc(admin,'get_admin_ad_report_evidence',{p_report_id:receipt.reportId}),null);
  f.sql(`update users set status='deleted' where id='${owner.profileId}'`);
  assert.equal(f.sql(`select count(*) from ad_report_evidence where source_author_user_id='${owner.profileId}'`),'0');checks.push('reporter and creative author deletion remove private snapshots');
  f.save('ad-report-database-acceptance.json',{passed:true,checks,migrations:f.evidence.migrationHashes,noHostedOperations:true,noMessagesOrCharges:true});
 }finally{if(f)f.close();}
});
