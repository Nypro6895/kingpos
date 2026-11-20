import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';
import {createIsolatedTaxStorageBytes} from './helpers/isolated-tax-storage-bytes.mjs';

const integrityMigration='20261119061000_tax_delivered_file_integrity.sql';
const custodyMigration='20261119060000_tax_recipient_storage_custody.sql';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const pdf=label=>Buffer.from('%PDF-1.4\n% SYNTHETIC ordinary delivered-file fixture '+label+'\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
function reportingSnapshot(){
 const component=(gross,tax,method,shown=true)=>({shown,gross,tax_applied:tax!==0,tax_rate:tax?10:0,tax,net:gross-tax,payout_method:method,
  check_gross:method==='check'?gross:0,check_tax:method==='check'?tax:0,check_net:method==='check'?gross-tax:0,
  cash_gross:method==='cash'?gross:0,cash_tax:method==='cash'?tax:0,cash_net:method==='cash'?gross-tax:0});
 const components={check_wage:component(600,60,'check'),cash_wage:component(400,0,'cash',false),tip:component(150,0,'check'),bonus:component(50,0,'cash')};
 const keys=['gross','tax','net','check_gross','check_tax','check_net','cash_gross','cash_tax','cash_net'];
 return {version:1,components,totals:Object.fromEntries(keys.map(k=>[k,Object.values(components).reduce((n,c)=>n+c[k],0)]))};
}

test('ordinary delivered Tax file integrity, versioning and retained account-erasure COPY',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async()=>{
 let f,stage='startup';
 const receipt={passed:false,syntheticOnly:true,productionOperations:false,externalProviderRequests:false,
  ordinaryAppOperationsOnly:true,groups:[],implementationProposalNotActivation:true};
 const transientSecrets=[];
 try {
  // Same already-allowed label keeps the binary helper's original container
  // allowlist. Cached images, network=none, tmpfs, no host ports, no SQL stubs.
  f=await startIsolatedSupabase('tax-recipient-storage',{
   db:'public.ecr.aws/supabase/postgres:17.11.0.006',auth:'public.ecr.aws/supabase/gotrue:v2.197.0',
   storage:'public.ecr.aws/supabase/storage-api:v1.84.19',rest:'public.ecr.aws/supabase/postgrest:v16.5',
  },{allowConcurrentFixtureCleanup:true});
  receipt.migrations=f.evidence.migrationHashes;
  for(const file of [custodyMigration,integrityMigration]){
   const executed=receipt.migrations.find(m=>m.file===file);
   assert.ok(executed,'Required forward migration must actually execute: '+file);
   assert.equal(executed.sha256,hash(fs.readFileSync('supabase/migrations/'+file)));
  }
  receipt.inputHashes={
   test:hash(fs.readFileSync(fileURLToPath(import.meta.url))),
   binaryHelper:hash(fs.readFileSync(new URL('./helpers/isolated-tax-storage-bytes.mjs',import.meta.url))),
   fullSchemaFixture:hash(fs.readFileSync(new URL('./helpers/isolated-supabase-fixture.mjs',import.meta.url))),
  };
  const service={token:f.serviceToken},storage=createIsolatedTaxStorageBytes(f),bucket='payroll-paystubs';
  const owner=f.person('integrity-owner'),recipient=f.person('integrity-recipient'),professional=f.person('integrity-professional');
  const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Synthetic file integrity'})[0].account_id;
  const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{
   p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'Synthetic ordinary integrity',
   p_owner_is_staff:false,p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US',
  }).salon_id;
  const staff=crypto.randomUUID(),run=crypto.randomUUID();
  f.sql("insert into public.salon_memberships(account_id,salon_id,user_id,role_id,status) select "+q(account)+","+q(salon)+","+q(recipient.profileId)+",id,'active' from public.roles where account_id="+q(account)+" and code='STAFF';"+
   "insert into public.staff(id,salon_id,account_user_id,user_id,display_name,is_active) values("+q(staff)+","+q(salon)+","+q(recipient.profileId)+","+q(recipient.authId)+",'Synthetic recipient',true);"+
   "insert into public.payroll_runs(id,salon_id,period_start,period_end,cycle_type,status,version) values("+q(run)+","+q(salon)+",(date_trunc('month',current_date)-interval '1 month')::date,(date_trunc('month',current_date)-interval '1 day')::date,'monthly','printed',1);"+
   "insert into public.payroll_staff_lines(id,payroll_run_id,salon_id,staff_id,staff_display_name_snapshot,staff_legal_name_snapshot,final_check_amount,final_cash_amount,final_staff_income,tax_withheld,tax_company_reported_wage_gross,tax_company_taxable_gross,tax_company_enabled_snapshot,tax_reporting_snapshot) values("+
   q(crypto.randomUUID())+","+q(run)+","+q(salon)+","+q(staff)+",'Synthetic recipient','Synthetic recipient',690,450,1140,60,1000,1200,true,"+q(JSON.stringify(reportingSnapshot()))+"::jsonb);");
  const password='Synthetic-'+crypto.randomBytes(24).toString('hex');transientSecrets.push(password);
  f.sql("insert into public.tax_company_subscriptions(salon_id,paid_until,payment_owner) values("+q(salon)+",now()+interval '2 days',"+q(owner.profileId)+");");
  const credentials=f.rpc(owner,'tax_company_settings',{p_salon:salon,p_password:password,p_disconnect:false});
  transientSecrets.push(credentials.login_id);
  assert.equal(f.rpc(professional,'tax_company_connect',{p_login:credentials.login_id,p_password:password}).salon_id,salon);
  const originalReport=f.rpc(owner,'tax_report_data',{p_salon:salon});
  const financialHash=()=>hash(Buffer.from(JSON.stringify(f.json("select jsonb_agg(to_jsonb(p) order by p.id) from public.payroll_staff_lines p where p.payroll_run_id="+q(run)))));
  const originalFinancialHash=financialHash();
  const unchangedFinancials=()=>{
   assert.deepEqual(f.rpc(owner,'tax_report_data',{p_salon:salon}),originalReport,'File lifecycle must preserve published Show projection');
   assert.equal(financialHash(),originalFinancialHash,'Canonical payroll financial rows must stay byte-equivalent');
  };
  const begin=(actor,bytes,{supersedes=null,kind='paystub',payrollRun=run}={})=>f.rpc(actor,'tax_begin_upload',{
   p_salon:salon,p_kind:kind,p_staff:staff,p_run:payrollRun,p_name:'synthetic-integrity.pdf',p_mime:'application/pdf',
   p_size:bytes.length,p_supersedes:supersedes,p_share_staff:true,
  });
  const finish=(actor,upload)=>f.rpc(actor,'tax_finish_upload',{p_upload:upload.id});
  const expectBytes=(actor,upload,bytes)=>{
   const r=storage.get(bucket,upload.path,actor.token);assert.equal(r.status,200,'Authorized ordinary byte download must work');
   assert.equal(r.sha256,hash(bytes));assert.deepEqual(r.bytes,bytes);return r;
  };
  const objectState=upload=>f.json("select jsonb_build_object('id',id,'version',version,'owner',owner,'ownerId',owner_id,'metadata',metadata,'userMetadata',user_metadata) from storage.objects where bucket_id="+q(bucket)+" and name="+q(upload.path));
  const deny=r=>assert.ok(r.status>=400&&r.status<500,'Expected an ordinary access/integrity rejection, not success or provider/server failure');
  const copy=(source,destination,actor=service)=>f.http(5000,'/object/copy','POST',{
   bucketId:bucket,sourceKey:source.path,destinationKey:destination.path,copyMetadata:true,
  },actor.token,['x-upsert: true']);
  const check=async(name,fn)=>{stage=name;const row={name,passed:false,skipped:false};receipt.groups.push(row);await fn(row);unchangedFinancials();row.passed=true;};
  const original=pdf('original-A'),replacementBytes=pdf('replacement-B'),staleBytes=pdf('stale-C'),differentBytes=pdf('different-body-D');
  let delivered,current,stale,maintenance,wrongSource;

  await check('Official UUID upload, ordinary pre-delivery PUT, finish and recipient download',async row=>{
   delivered=begin(owner,original);
   assert.match(delivered.id,/^[a-f0-9-]{36}$/);assert.equal(delivered.path.split('/').at(-1),delivered.id);
   assert.equal(storage.upload(bucket,delivered.path,original,owner.token).status,200);
   assert.equal(storage.update(bucket,delivered.path,original,owner.token).status,200,'Positive control: ordinary sender PUT works before delivery');
   delivered.document=finish(owner,delivered);
   assert.equal(delivered.document.recipient_user_id,recipient.profileId);
   assert.equal(delivered.document.version,1);
   expectBytes(owner,delivered,original);expectBytes(recipient,delivered,original);expectBytes(service,delivered,original);
   row.sha256=hash(original);row.senderUpdatePositiveControl=true;
  });
  await check('Delivered exact key rejects original sender ordinary PUT/upsert without changing bytes or identity',async row=>{
   const before=objectState(delivered);
   const update=storage.update(bucket,delivered.path,differentBytes,owner.token);
   deny(update);expectBytes(service,delivered,original);expectBytes(recipient,delivered,original);
   assert.deepEqual(objectState(delivered),before);
   const upsert=storage.upload(bucket,delivered.path,differentBytes,owner.token,{upsert:true});
   deny(upsert);expectBytes(service,delivered,original);expectBytes(recipient,delivered,original);
   assert.deepEqual(objectState(delivered),before);
   row.updateStatus=update.status;row.upsertStatus=upsert.status;row.originalExactObjectUnchanged=true;
  });
  await check('Actual fresh-version supersedes CAS succeeds; stale replacement cannot commit and old bytes remain',async row=>{
   current=begin(owner,replacementBytes,{supersedes:delivered.document.id});
   stale=begin(owner,staleBytes,{supersedes:delivered.document.id});
   assert.notEqual(current.path,delivered.path);assert.notEqual(stale.path,current.path);
   assert.equal(storage.upload(bucket,current.path,replacementBytes,owner.token).status,200);
   assert.equal(storage.upload(bucket,stale.path,staleBytes,owner.token).status,200);
   current.document=finish(owner,current);
   assert.equal(current.document.supersedes_id,delivered.document.id);assert.equal(current.document.version,2);
   const rejected=f.http(3000,'/rpc/tax_finish_upload','POST',{p_upload:stale.id},owner.token);deny(rejected);
   assert.equal(Number(f.sql("select count(*) from public.tax_documents where bucket="+q(bucket)+" and path="+q(stale.path))),0);
   assert.equal(f.sql("select completed_at is null from public.tax_uploads where id="+q(stale.id)),'t');
   assert.equal(f.sql("select archived_at is not null from public.tax_documents where id="+q(delivered.document.id)),'t');
   assert.equal(f.sql("select file_url_or_path from public.payroll_paystubs where salon_id="+q(salon)+" and staff_id="+q(staff)+" and payroll_run_id="+q(run)),current.path);
   expectBytes(recipient,delivered,original);expectBytes(service,delivered,original);
   expectBytes(recipient,current,replacementBytes);expectBytes(owner,current,replacementBytes);
   row.staleCasStatus=rejected.status;row.oldBytesRetained=true;
  });
  await check('Canonical archive/restore and Owner tombstone preserve the frozen recipient bytes',async row=>{
   f.rpc(owner,'tax_archive_document',{p_document:current.document.id,p_restore:false});
   expectBytes(recipient,current,replacementBytes);
   f.rpc(owner,'tax_archive_document',{p_document:current.document.id,p_restore:true});
   expectBytes(recipient,current,replacementBytes);
   f.rpc(owner,'tax_owner_delete_document',{p_document:delivered.document.id});
   assert.equal(f.rest(owner,'/tax_documents?id=eq.'+delivered.document.id+'&select=id').length,0);
   assert.equal(f.rest(recipient,'/tax_documents?id=eq.'+delivered.document.id+'&select=id').length,1);
   deny(storage.get(bucket,delivered.path,owner.token));
   expectBytes(recipient,delivered,original);expectBytes(service,delivered,original);
   row.canonicalVisibilityAndCustodyPreserved=true;
  });
  await check('Ordinary unleased same-path service COPY cannot replace a delivered object',async row=>{
   const before=objectState(current),r=copy(current,current);
   deny(r);assert.deepEqual(objectState(current),before);
   expectBytes(recipient,current,replacementBytes);expectBytes(service,current,replacementBytes);
   row.copyStatus=r.status;
  });
  await check('Canonical erasure lease permits only exact retained COPY and strict ownership checkpoint',async row=>{
   const bytes=pdf('retained-professional-E');
   maintenance=begin(professional,bytes,{kind:'employee',payrollRun:null});
   assert.equal(storage.upload(bucket,maintenance.path,bytes,professional.token).status,200);
   maintenance.document=finish(professional,maintenance);assert.equal(maintenance.document.recipient_user_id,recipient.profileId);
   expectBytes(recipient,maintenance,bytes);expectBytes(service,maintenance,bytes);
   const before=objectState(maintenance);
   assert.ok(before.owner===professional.authId||before.ownerId===professional.authId,'Fixture must exercise actual old Auth ownership');

   wrongSource=begin(owner,differentBytes,{kind:'employee',payrollRun:null});
   assert.equal(storage.upload(bucket,wrongSource.path,differentBytes,owner.token).status,200);
   const deletion=f.rpc(professional,'request_account_deletion',{p_continue_without_transfer:false,p_backup_acknowledged:false,p_reason:'Synthetic ordinary retained file account deletion'});
   assert.equal(deletion.ok,true);assert.equal(deletion.status,'pending_deletion');
   f.sql("update public.users set deletion_scheduled_for=now()-interval '1 minute' where id="+q(professional.profileId));
   const finalized=f.rpc(service,'finalize_account_deletion',{p_user_id:professional.profileId});
   assert.equal(finalized.ok,true);assert.equal(finalized.changed,true);assert.equal(finalized.status,'deleted');
   assert.equal(f.sql("select auth_user_id is null from public.users where id="+q(professional.profileId)),'t');
   const job=f.rpc(service,'claim_account_erasure');
   assert.ok(job);assert.equal(job.userId,professional.profileId);assert.equal(job.authUserId,professional.authId);
   const identity={p_user_id:job.userId,p_lease:job.lease};
   const tasks=f.rpc(service,'account_erasure_batch',identity);
   assert.deepEqual(tasks,[{bucket_id:bucket,object_path:maintenance.path,disposition:'retain_business'}],'Do not silently ignore other erasure tasks');
   const premature=f.http(3000,'/rpc/finish_account_erasure_object','POST',{...identity,p_bucket:bucket,p_path:maintenance.path},service.token);
   deny(premature);assert.equal(Number(f.sql("select count(*) from public.account_erasure_objects where user_id="+q(job.userId)+" and completed_at is not null")),0);

   const wrong=copy(wrongSource,maintenance);deny(wrong);
   assert.deepEqual(objectState(maintenance),before);expectBytes(service,maintenance,bytes);expectBytes(recipient,maintenance,bytes);
   const copied=copy(maintenance,maintenance);
   assert.equal(copied.status,200,'Actual Storage COPY probe/final transaction must honor the exact retained contract; do not relax if uncertain');
   const after=objectState(maintenance);
   assert.equal(after.owner,null);assert.equal(after.ownerId,null);
   assert.equal(after.metadata.eTag,before.metadata.eTag);
   assert.equal(after.metadata.size,before.metadata.size);assert.equal(after.metadata.mimetype,before.metadata.mimetype);
   expectBytes(service,maintenance,bytes);expectBytes(recipient,maintenance,bytes);
   f.rpc(service,'finish_account_erasure_object',{...identity,p_bucket:bucket,p_path:maintenance.path});
   assert.deepEqual(f.rpc(service,'account_erasure_batch',identity),[]);
   const auth=f.http(9999,'/admin/users/'+professional.authId,'DELETE',{should_soft_delete:false},service.token);
   assert.ok(auth.status>=200&&auth.status<300);
   f.rpc(service,'finish_account_erasure',{...identity,p_error:null});
   assert.equal(f.sql("select status from public.account_erasure_jobs where user_id="+q(job.userId)),'complete');
   assert.equal(f.sql("select deletion_finalized_at is not null from public.users where id="+q(job.userId)),'t');
   deny(copy(maintenance,maintenance));expectBytes(service,maintenance,bytes);expectBytes(recipient,maintenance,bytes);
   row.wrongBodyCopyStatus=wrong.status;row.actualExactCopyStatus=copied.status;
   row.strictCheckpointAndAuthCompletion=true;row.bytesUnchanged=true;row.bothOwnerFieldsDetached=true;
  });
  await check('Normal unreferenced fresh-upload cleanup succeeds without affecting delivered history',async row=>{
   for(const upload of [stale,wrongSource]){
    assert.equal(Number(f.sql("select count(*) from public.tax_documents where bucket="+q(bucket)+" and path="+q(upload.path))),0);
    const removed=storage.remove(bucket,upload.path,owner.token);assert.equal(removed.status,200);
    assert.ok(Array.isArray(removed.data)&&removed.data.length===1,'Require one actually deleted object, not an RLS-filtered no-op');
    assert.equal(Number(f.sql("select count(*) from storage.objects where bucket_id="+q(bucket)+" and name="+q(upload.path))),0);
    assert.equal(storage.get(bucket,upload.path,service.token).status,400,'Current cached Storage returns400 NoSuchKey for absent object');
   }
   expectBytes(service,delivered,original);expectBytes(recipient,current,replacementBytes);
   row.actualRemovedObjects=2;
  });
  await check('Non-READ-COMMITTED ordinary finish fails closed without registering or changing uploaded bytes',async row=>{
   row.isolations=[];
   for(const isolation of ['repeatable read','serializable']){
    const bytes=pdf('isolated-finish-'+isolation),upload=begin(owner,bytes,{kind:'employee',payrollRun:null});
    assert.equal(storage.upload(bucket,upload.path,bytes,owner.token).status,200);
    const claims=JSON.stringify({role:'authenticated',sub:owner.authId});
    // Standard fixture transaction/role setup, then the real ordinary app RPC.
    // Catch ONLY the contract SQLSTATE25000; no replaced policy/function.
    f.sql("begin isolation level "+isolation+"; set local role authenticated; set local request.jwt.claims="+q(claims)+";"+
     "do $normal_finish$ begin begin perform public.tax_finish_upload("+q(upload.id)+"::uuid);"+
     "raise exception 'Expected explicit READ COMMITTED guard'; exception when sqlstate '25000' then null; end; end $normal_finish$; rollback;");
    assert.equal(Number(f.sql("select count(*) from public.tax_documents where bucket="+q(bucket)+" and path="+q(upload.path))),0);
    assert.equal(f.sql("select completed_at is null from public.tax_uploads where id="+q(upload.id)),'t');
    expectBytes(service,upload,bytes);
    const removed=storage.remove(bucket,upload.path,owner.token);assert.equal(removed.status,200);
    assert.ok(Array.isArray(removed.data)&&removed.data.length===1);
    row.isolations.push({isolation,rejectedWithSqlstate:'25000',noRegistration:true});
   }
  });
  assert.equal(receipt.groups.length,8);assert.ok(receipt.groups.every(r=>r.passed&&!r.skipped));
  receipt.financialRowsUnchanged=true;receipt.showProjectionUnchanged=true;
  receipt.signedCapabilityRuntimeVerified=false;receipt.generatedFixtureOnly=true;
  receipt.passed=true;f.save('tax-delivered-file-integrity-acceptance.json',receipt);
 } catch(error) {
  let message=String(error.message);
  for(const secret of transientSecrets.filter(Boolean))message=message.replaceAll(secret,'[fixture-secret-redacted]');
  receipt.failedStage=stage;receipt.error=f?f.redact(message):message;
  f?.save('tax-delivered-file-integrity-acceptance.json',receipt);throw new Error(receipt.error);
 } finally {f?.close();}
});

