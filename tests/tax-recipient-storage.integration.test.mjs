import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';
import {createIsolatedTaxStorageBytes} from './helpers/isolated-tax-storage-bytes.mjs';

const migration='20261119060000_tax_recipient_storage_custody.sql';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
function snapshot(){
 const part=(gross,tax,method,shown=true)=>({shown,gross,tax_applied:tax!==0,tax_rate:tax?10:0,tax,net:gross-tax,payout_method:method,
  check_gross:method==='check'?gross:0,check_tax:method==='check'?tax:0,check_net:method==='check'?gross-tax:0,
  cash_gross:method==='cash'?gross:0,cash_tax:method==='cash'?tax:0,cash_net:method==='cash'?gross-tax:0});
 const components={check_wage:part(600,60,'check'),cash_wage:part(400,0,'cash',false),tip:part(150,0,'check'),bonus:part(50,0,'cash')};
 const keys=['gross','tax','net','check_gross','check_tax','check_net','cash_gross','cash_tax','cash_net'];
 return{version:1,components,totals:Object.fromEntries(keys.map(key=>[key,Object.values(components).reduce((total,item)=>total+item[key],0)]))};
}

test('actual full-schema Tax recipient Storage custody preserves financial, tenant, role and frozen-delivery boundaries',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async()=>{
 let f;const capabilities=[];
 const receipt={passed:false,syntheticOnly:true,productionOperations:false,providerRequests:false,checks:[]};
 try{
  f=await startIsolatedSupabase('tax-recipient-storage',{
   db:'public.ecr.aws/supabase/postgres:17.11.0.006',auth:'public.ecr.aws/supabase/gotrue:v2.197.0',
   storage:'public.ecr.aws/supabase/storage-api:v1.84.19',rest:'public.ecr.aws/supabase/postgrest:v16.5',
  },{allowConcurrentFixtureCleanup:true});
  const executed=f.evidence.migrationHashes.find(row=>row.file===migration);
  assert.ok(executed,'The forward custody migration must be replayed in the actual complete schema');
  assert.equal(executed.sha256,hash(fs.readFileSync('supabase/migrations/'+migration)));
  receipt.migrations=f.evidence.migrationHashes;
  const policy=f.json(`select jsonb_build_object('permissive',polpermissive,'command',polcmd,'roles',
   (select jsonb_agg(rolname order by rolname) from pg_roles where oid=any(p.polroles)))
   from pg_policy p where polrelid='storage.objects'::regclass and polname='financial_paystub_object_read_limit'`);
  assert.equal(policy.permissive,false);assert.equal(policy.command,'r');assert.deepEqual(policy.roles,['authenticated']);
  const historical=fs.readFileSync('supabase/migrations/20261029101200_financial_history_privacy.sql','utf8').replaceAll('\r\n','\n');
  const originalBody=historical.match(/create function public\.financial_paystub_object_in_scope\(p_name text\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i)?.[1];
  assert.ok(originalBody,'Historical financial helper definition must be present');
  const installedBody=f.sql("select prosrc from pg_proc where oid='public.financial_paystub_object_in_scope(text)'::regprocedure");
  assert.equal(hash(installedBody.trim()),hash(originalBody.trim()),'The installed financial helper body must remain unchanged');
  receipt.originalFinancialHelperBodySha256=hash(installedBody.trim());receipt.policyStructure=policy;
  const storage=createIsolatedTaxStorageBytes(f);
  const owner=f.person('tax-custody-owner'),otherOwner=f.person('tax-custody-other-owner');
  const recipient=f.person('tax-custody-recipient'),staffTax=f.person('tax-custody-staff-tax');
  const operator=f.person('tax-custody-operator'),otherRecipient=f.person('tax-custody-other-recipient');
  const stranger=f.person('tax-custody-stranger'),replacement=f.person('tax-custody-replacement');
  function salonFor(actor,name){
   const account=f.rpc(actor,'ensure_personal_account_for_current_user',{p_account_name:name})[0].account_id;
   const salon=f.rpc(actor,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:name,p_owner_is_staff:false,
    p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
   return{account,salon};
  }
  const a=salonFor(owner,'Synthetic Tax custody A'),b=salonFor(otherOwner,'Synthetic Tax custody B');
  const runA=crypto.randomUUID(),runB=crypto.randomUUID(),staffA=crypto.randomUUID(),staffHybrid=crypto.randomUUID(),staffB=crypto.randomUUID();
  function member(actor,scope,staff,name){
   assert.equal(Number(f.sql(`select count(*) from public.roles where account_id=${literal(scope.account)} and code='STAFF'`)),1);
   f.sql(`insert into public.salon_memberships(account_id,salon_id,user_id,role_id,status)
    select ${literal(scope.account)},${literal(scope.salon)},${literal(actor.profileId)},id,'active' from public.roles where account_id=${literal(scope.account)} and code='STAFF';
    insert into public.staff(id,salon_id,account_user_id,user_id,display_name,is_active)
    values(${literal(staff)},${literal(scope.salon)},${literal(actor.profileId)},${literal(actor.authId)},${literal(name)},true);`);
  }
  member(recipient,a,staffA,'Synthetic recipient');member(staffTax,a,staffHybrid,'Synthetic Staff Tax');member(otherRecipient,b,staffB,'Synthetic other recipient');
  const published=snapshot();
  for(const [scope,run,staffs]of [[a,runA,[staffA,staffHybrid]],[b,runB,[staffB]]]){
   f.sql(`insert into public.payroll_runs(id,salon_id,period_start,period_end,cycle_type,status,version)
    values(${literal(run)},${literal(scope.salon)},(date_trunc('month',current_date)-interval '1 month')::date,(date_trunc('month',current_date)-interval '1 day')::date,'monthly','printed',1);`);
   for(const staff of staffs)f.sql(`insert into public.payroll_staff_lines(id,payroll_run_id,salon_id,staff_id,staff_display_name_snapshot,staff_legal_name_snapshot,
    final_check_amount,final_cash_amount,final_staff_income,tax_withheld,tax_company_reported_wage_gross,tax_company_taxable_gross,tax_company_enabled_snapshot,tax_reporting_snapshot)
    values(${literal(crypto.randomUUID())},${literal(run)},${literal(scope.salon)},${literal(staff)},'Synthetic recipient','Synthetic recipient',690,450,1140,60,1000,1200,true,${literal(JSON.stringify(published))}::jsonb);`);
  }
  const password='Synthetic-'+crypto.randomBytes(24).toString('hex');capabilities.push(password);
  f.sql(`insert into public.tax_company_subscriptions(salon_id,paid_until,payment_owner) values(${literal(a.salon)},now()+interval '2 days',${literal(owner.profileId)});`);
  const credentials=f.rpc(owner,'tax_company_settings',{p_salon:a.salon,p_password:password,p_disconnect:false});
  for(const actor of [operator,staffTax]){
   const connected=f.rpc(actor,'tax_company_connect',{p_login:credentials.login_id,p_password:password});
   assert.equal(connected.salon_id,a.salon);assert.equal(connected.error,undefined);
  }
  const pdf=Buffer.from('%PDF-1.4\n% Synthetic Tax recipient custody fixture only.\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'),pdfSha=hash(pdf);
  function uploadedBy(actor,scope,staff,run,kind='paystub'){
   const upload=f.rpc(actor,'tax_begin_upload',{p_salon:scope.salon,p_kind:kind,p_staff:staff,p_run:run,p_name:'synthetic-custody.pdf',p_mime:'application/pdf',p_size:pdf.length,p_supersedes:null,p_share_staff:true});
   assert.equal(storage.upload('payroll-paystubs',upload.path,pdf,actor.token).status,200);
   const document=f.rpc(actor,'tax_finish_upload',{p_upload:upload.id});
   return{...upload,document};
  }
  const primary=uploadedBy(operator,a,staffA,runA),hybrid=uploadedBy(operator,a,staffHybrid,runA),foreign=uploadedBy(otherOwner,b,staffB,runB);
  assert.equal(primary.document.recipient_user_id,recipient.profileId);assert.equal(hybrid.document.recipient_user_id,staffTax.profileId);assert.equal(foreign.document.recipient_user_id,otherRecipient.profileId);
  const ownerReport=f.rpc(owner,'tax_report_data',{p_salon:a.salon});
  function unchangedShow(){
   const report=f.rpc(owner,'tax_report_data',{p_salon:a.salon});assert.deepEqual(report,ownerReport,'Storage custody must not rewrite the published Show projection');
   for(const row of report.lines){
    assert.equal(row.breakdown.components.cash_wage.shown,false);
    for(const key of ['gross','tax','net','check_gross','check_tax','check_net','cash_gross','cash_tax','cash_net'])assert.equal(row.breakdown.components.cash_wage[key],null);
    for(const key of ['reported_wage','reported_gross','cash_reported'])assert.equal(row[key],null);
   }
  }
  const visible=(actor,document)=>f.rest(actor,`/tax_documents?id=eq.${document.document.id}&select=id,recipient_user_id`);
  function canRead(actor,document){
   const result=storage.get('payroll-paystubs',document.path,actor?.token);
   assert.equal(result.status,200,'Exact authorized recipient must download bytes');assert.equal(result.sha256,pdfSha);
  }
  function denied(actor,document){
   const result=storage.get('payroll-paystubs',document.path,actor?.token);assert.ok(result.status>=400,'Unauthorized direct Storage read must fail');
  }
  function sign(actor,document,allowed=false){
   const result=f.http(5000,'/object/sign/payroll-paystubs/'+document.path,'POST',{expiresIn:60},actor?.token);
   for(const key of ['signedURL','signedUrl','token'])if(typeof result.data?.[key]==='string')capabilities.push(result.data[key]);
   if(allowed)assert.equal(result.status,200,'Positive control: authorized Storage signing works');
   else assert.ok(result.status>=400,'Unauthorized caller must not mint a signed capability');
  }
  function policyTruth(actor,document){
   // Claims are fixture-generated identities, not replacement policy helpers.
   const output=f.sql(`begin; set local role authenticated; set local request.jwt.claims=${literal(JSON.stringify({role:'authenticated',sub:actor.authId}))};
    select jsonb_build_object('tax',public.tax_storage_read('payroll-paystubs',${literal(document.path)}),'financial',public.financial_paystub_object_in_scope(${literal(document.path)}),
    'recipient',exists(select 1 from public.tax_documents where id=${literal(document.document.id)} and recipient_user_id=public.current_public_user_id())); rollback;`);
   const line=output.split(/\r?\n/).find(value=>value.startsWith('{'));assert.ok(line,'Actual authenticated helper truth must be returned');
   return JSON.parse(line);
  }
  async function check(name,fn){const row={name,passed:false};receipt.checks.push(row);await fn();row.passed=true;}

  await check('Exact recipient and current own Staff file succeed; active Staff plus Tax never gains coworker file',async()=>{
   canRead(recipient,primary);canRead(staffTax,hybrid);canRead(operator,primary);canRead(owner,primary);
   const truth=policyTruth(staffTax,primary);assert.equal(truth.tax,true);assert.equal(truth.financial,false);assert.equal(truth.recipient,false);
   denied(staffTax,primary);sign(staffTax,primary);denied(recipient,hybrid);sign(recipient,hybrid);
   const ownLine=f.rest(staffTax,`/payroll_staff_lines?staff_id=eq.${staffHybrid}&select=id`);assert.equal(ownLine.length,1);
   assert.deepEqual(f.rest(staffTax,`/payroll_staff_lines?staff_id=eq.${staffA}&select=id`),[]);
   unchangedShow();
  });
  await check('Stranger, cross-tenant, exact-path substitution and other bucket cannot borrow delivered authority',async()=>{
   canRead(otherRecipient,foreign);canRead(otherOwner,foreign);sign(otherOwner,foreign,true);
   denied(recipient,foreign);denied(otherRecipient,primary);denied(stranger,primary);denied(otherOwner,primary);sign(otherOwner,primary);
   for(const actor of [recipient,stranger,owner])sign(actor,foreign);
   const legacyPath=`${a.account}/${a.salon}/${runA}/${staffA}/${crypto.randomUUID()}`;
   assert.equal(storage.upload('payroll-paystubs',legacyPath,pdf,owner.token).status,200);
   assert.equal(Number(f.sql(`select count(*) from public.tax_documents where bucket='payroll-paystubs' and path=${literal(legacyPath)}`)),0);
   const legacy={path:legacyPath};canRead(owner,legacy);denied(recipient,legacy);sign(recipient,legacy);denied(staffTax,legacy);
   const otherBytes=Buffer.from('{"synthetic":"same path, different private bucket"}');
   assert.equal(storage.upload('lifecycle-exports',primary.path,otherBytes,f.serviceToken,{mime:'application/json'}).status,200);
   const control=storage.get('lifecycle-exports',primary.path,f.serviceToken);assert.equal(control.status,200);assert.equal(control.sha256,hash(otherBytes));
   assert.ok(storage.get('lifecycle-exports',primary.path,recipient.token).status>=400);
   assert.ok(f.http(5000,'/object/sign/lifecycle-exports/'+primary.path,'POST',{expiresIn:60},recipient.token).status>=400);
   unchangedShow();
  });
  await check('Owner archive and tombstone preserve exact recipient custody but revoke Owner and professional file access',async()=>{
   f.rpc(owner,'tax_archive_document',{p_document:primary.document.id,p_restore:false});canRead(recipient,primary);
   f.rpc(owner,'tax_owner_delete_document',{p_document:primary.document.id});
   assert.equal(visible(recipient,primary).length,1);assert.equal(visible(owner,primary).length,0);assert.equal(visible(operator,primary).length,0);
   canRead(recipient,primary);denied(owner,primary);denied(operator,primary);sign(owner,primary);sign(operator,primary);
   unchangedShow();
  });
  await check('Termination, unlink and Tax disconnect do not revoke a frozen recipient or grant client mutation',async()=>{
   f.sql(`update public.staff set is_active=false where id=${literal(staffA)}`);
   assert.equal(visible(recipient,primary).length,1);canRead(recipient,primary);
   f.sql(`update public.staff set account_user_id=null,user_id=null where id=${literal(staffA)}`);
   assert.equal(visible(recipient,primary).length,1);canRead(recipient,primary);
   f.rpc(owner,'tax_company_settings',{p_salon:a.salon,p_password:null,p_disconnect:true});
   assert.equal(visible(recipient,primary).length,1);canRead(recipient,primary);denied(operator,primary);denied(staffTax,primary);sign(operator,primary);
   assert.ok(f.http(3000,`/tax_documents?id=eq.${primary.document.id}`,'PATCH',{recipient_user_id:replacement.profileId},recipient.token).status>=400);
   assert.ok(storage.upload('payroll-paystubs',primary.path,pdf,recipient.token,{upsert:true}).status>=400);
   receipt.clientDeleteOutcomes=[];
   for(const actor of [recipient,operator,stranger]){
    const removed=storage.remove('payroll-paystubs',primary.path,actor.token);
    // Storage may legitimately return200/[] for an RLS-filtered no-op. Check
    // affected objects and actual custody, never infer deletion from status.
    if(removed.status>=200&&removed.status<300)assert.deepEqual(removed.data,[],'Unauthorized removal must affect zero objects');
    else assert.ok(removed.status>=400,'Unexpected Storage removal response');
    const retained=storage.get('payroll-paystubs',primary.path,f.serviceToken);
    assert.equal(retained.status,200);assert.equal(retained.sha256,pdfSha);
    assert.equal(Number(f.sql(`select count(*) from storage.objects where bucket_id='payroll-paystubs' and name=${literal(primary.path)}`)),1);
    canRead(recipient,primary);
    receipt.clientDeleteOutcomes.push({status:removed.status,affectedObjects:Array.isArray(removed.data)?removed.data.length:0,exactObjectPreserved:true});
   }
   canRead(recipient,primary);assert.equal(storage.get('payroll-paystubs',primary.path,f.serviceToken).sha256,pdfSha);unchangedShow();
  });
  await check('Staff reassignment cannot rewrite a frozen delivery; new account gets only a newly delivered own document',async()=>{
   f.sql(`insert into public.salon_memberships(account_id,salon_id,user_id,role_id,status)
    select ${literal(a.account)},${literal(a.salon)},${literal(replacement.profileId)},id,'active' from public.roles where account_id=${literal(a.account)} and code='STAFF';
    update public.staff set account_user_id=${literal(replacement.profileId)},user_id=${literal(replacement.authId)},is_active=true where id=${literal(staffA)};`);
   assert.equal(f.sql(`select recipient_user_id from public.tax_documents where id=${literal(primary.document.id)}`),recipient.profileId);
   canRead(recipient,primary);denied(replacement,primary);sign(replacement,primary);assert.equal(visible(replacement,primary).length,0);
   const newDelivery=uploadedBy(owner,a,staffA,null,'employee');assert.equal(newDelivery.document.recipient_user_id,replacement.profileId);
   canRead(replacement,newDelivery);denied(recipient,newDelivery);sign(recipient,newDelivery);canRead(recipient,primary);unchangedShow();
  });
  await check('Suspended or deleted public identity cannot use frozen custody; anonymous callers cannot sign or download',async()=>{
   sign(recipient,primary,true);
   for(const status of ['suspended','deleted']){
    f.sql(`update public.users set status=${literal(status)} where id=${literal(recipient.profileId)}`);
    assert.equal(visible(recipient,primary).length,0);denied(recipient,primary);sign(recipient,primary);
    f.sql(`update public.users set status='active' where id=${literal(recipient.profileId)}`);canRead(recipient,primary);
   }
   denied(null,primary);sign(null,primary);assert.ok(storage.get('payroll-paystubs',primary.path,undefined,{public:true}).status>=400);
   // Minting is checked with current authority. Already issued signed URLs are
   // bearer capabilities until their own expiry; this test does not claim that
   // a prior URL is retroactively revoked by a later account-state change.
   unchangedShow();
  });
  await check('Supported account deletion disables recipient access before Auth cleanup and retains business document bytes',async()=>{
   canRead(recipient,primary);
   f.rpc(recipient,'request_account_deletion',{
    p_continue_without_transfer:false,p_backup_acknowledged:false,p_reason:'Synthetic canonical deletion',
   });
   const lifecycle=f.json(`select jsonb_build_object('status',status,'requested',deletion_requested_at is not null,
    'scheduled',deletion_scheduled_for is not null) from public.users where id=${literal(recipient.profileId)}`);
   assert.equal(lifecycle.status,'pending_deletion');assert.equal(lifecycle.requested,true);assert.equal(lifecycle.scheduled,true);
   assert.equal(visible(recipient,primary).length,0);denied(recipient,primary);sign(recipient,primary);
   const retained=storage.get('payroll-paystubs',primary.path,f.serviceToken);
   assert.equal(retained.status,200);assert.equal(retained.sha256,pdfSha);unchangedShow();
  });
  receipt.passed=true;receipt.migrationSha256=executed.sha256;receipt.exactPdfSha256=pdfSha;
  f.save('tax-recipient-storage-acceptance.json',receipt);
 }catch(error){
  const message=capabilities.reduce((value,secret)=>value.replaceAll(secret,'[capability-redacted]'),String(error.message));
  receipt.error=f?f.redact(message):message;f?.save('tax-recipient-storage-acceptance.json',receipt);throw error;
 }finally{f?.close();}
});
