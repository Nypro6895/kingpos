import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {execFileSync,execFile} from 'node:child_process';

// Real PostgreSQL concurrent connections, cached image, no network or host port.
// Reuse the existing isolated identity schema fixture, never a production dump.
const root=process.env.KIOSK_SOURCE_ROOT || process.cwd();
const patch=process.env.KIOSK_PATCH_ROOT || root;
const docker=process.env.TEST_DOCKER_PATH || 'docker';
const context=process.env.TEST_DOCKER_CONTEXT || 'desktop-linux';
const image=process.env.KIOSK_TEST_POSTGRES_IMAGE || 'public.ecr.aws/supabase/postgres:17.11.0.006';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const sqlFunction=(file,name)=>{const s=read(file),a=s.indexOf(`create or replace function public.${name}(`);assert.ok(a>=0,name);return s.slice(a,s.indexOf('$$;',a)+3);};

test('kiosk scoped phone recognition, concurrent retries and visit reuse', {skip:process.env.RUN_KIOSK_POSTGRES!=='1',timeout:180000}, async t=>{
 const label=crypto.randomUUID(),name=`kiosk-fixture-${label}`;
 const command=(args,input)=>execFileSync(docker,['--context',context,...args],{input,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024}).trim();
 command(['run','-d','--pull=never','--name',name,'--label',`com.codex.task=${label}`,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=1073741824',
  '-e','POSTGRES_PASSWORD=synthetic-local-fixture','-e','POSTGRES_DB=postgres','-e','POSTGRES_USER=supabase_admin','-e','PGDATA=/var/lib/postgresql/data',image,
  'postgres','-D','/etc/postgresql','-c','listen_addresses=127.0.0.1','-c','cron.launch_active_jobs=off']);
 t.after(()=>{const meta=JSON.parse(command(['inspect',name]));assert.equal(meta[0].Config.Labels['com.codex.task'],label);assert.equal(meta[0].HostConfig.NetworkMode,'none');command(['rm','-f',name]);});
 const args=['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-At'];
 const sql=s=>command(args,s);
 const parallel=async s=>{const proc=execFile(docker,['--context',context,...args],{encoding:'utf8',windowsHide:true,timeout:30000});proc.stdin.end(s);return (await new Promise((resolve,reject)=>{let out='',err='';proc.stdout.on('data',s=>out+=s);proc.stderr.on('data',s=>err+=s);proc.on('error',reject);proc.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)));}));};
 let ready=false;
 for(let i=0;i<40;i++){try{if(command(['exec',name,'pg_isready','-h','127.0.0.1','-U','supabase_admin']).includes('accepting connections')){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 assert.ok(ready,'isolated PostgreSQL ready');
 const statements=[];
 class PGlite {async exec(s){statements.push(s);}}
 const fixture=read('tests/customer-identity-merge.test.mjs');
 await vm.runInNewContext(fixture.slice(fixture.indexOf('async function fixture()'),fixture.indexOf('\nasync function customer('))+';fixture()', {PGlite,read,sqlFunction,id});
 // Supabase image already contains API roles; the remaining schema is synthetic.
 for (const statement of statements) sql(statement.replace('create role anon; create role authenticated; create role service_role;',''));
 for(const name of ['find_pos_live_draft_customer_by_phone','create_pos_live_draft_customer_by_phone'])sql(sqlFunction('supabase/migrations/202607240010_pos_live_draft_realtime_customer_display.sql',name));
 sql(fs.readFileSync(path.join(patch,'supabase/migrations/20261025090000_kiosk_phone_recognition.sql'),'utf8'));
 sql(`insert into pos_live_drafts(salon_id,token) values('${id(1)}','fixture-a'),('${id(1)}','fixture-b'),('${id(2)}','fixture-other');
 create table services(id uuid primary key,salon_id uuid,name text,is_active boolean default true,online_booking_enabled boolean default true);
 create table customer_visit_services(visit_id uuid,service_id uuid,sort_order integer,primary key(visit_id,service_id));`);
 sql(sqlFunction('supabase/migrations/202608150008_customer_visit_requested_services.sql','update_customer_visit_requested_services'));
 const call=(phone,name=null,request=crypto.randomUUID(),token='fixture-a',isNew=false)=>`select resolve_customer_display_check_in_identity('${token}','${phone}',${name===null?'null':"'"+name+"'"},'${request}',null,${isNew})`;
 const result=q=>JSON.parse(sql(q));
 const make=(n,name,phone,salon=1)=>sql(`insert into customers(id,location_id,name,phone) values('${id(n)}','${id(salon)}','${name}','${phone}')`);
 await t.test('known customer without account and historical visit is reused for +1 and ten digits',()=>{
  make(10,'Avery Demo','2025550101');
  sql(`insert into customer_visits(salon_id,customer_id,status) values('${id(1)}','${id(10)}','completed')`);
  const first=result(call('+1 (202) 555-0101'));
  assert.equal(first.ok,true);assert.equal(first.visit.customerId,id(10));
  assert.equal(result(call('2025550101')).visit.id,first.visit.id);
  assert.equal(sql(`select customer_user_id is null from customers where id='${id(10)}'`),'t');
  assert.equal(sql(`select count(*) from customers where normalize_customer_claim_phone(phone)='+12025550101'`),'1');
 });
 await t.test('same phone in a different salon stays separate',()=>{
  make(11,'Other Demo','+12025550101',2);
  assert.equal(result(call('2025550101',null,crypto.randomUUID(),'fixture-other')).visit.customerId,id(11));
 });
 await t.test('new phone asks name without writes; simultaneous creation reuses one customer and visit',async()=>{
  assert.equal(result(call('2025550102')).code,'profile_required');
  assert.equal(sql(`select count(*) from customers where normalize_customer_claim_phone(phone)='+12025550102'`),'0');
  const responses=await Promise.all(Array.from({length:8},(_,i)=>parallel(call(i%2?'2025550102':'+12025550102','Jordan Demo',crypto.randomUUID(),i%2?'fixture-a':'fixture-b',true))));
  const rows=responses.map(JSON.parse);assert.ok(rows.every(r=>r.ok));
  assert.equal(new Set(rows.map(r=>r.visit.customerId)).size,1);assert.equal(new Set(rows.map(r=>r.visit.id)).size,1);
  assert.equal(sql(`select count(*) from customers where normalize_customer_claim_phone(phone)='+12025550102'`),'1');
  assert.equal(sql(`select bool_and(customer_user_id is null) from customers where normalize_customer_claim_phone(phone)='+12025550102'`),'t');
 });
 await t.test('same request retries replay; changed payload cannot reuse request ID',async()=>{
  const request=crypto.randomUUID(),q=call('2025550103','Taylor Demo',request);
  const responses=await Promise.all(Array.from({length:6},()=>parallel(q)));assert.equal(new Set(responses).size,1);
  assert.equal(result(call('2025550104','Taylor Demo',request)).code,'request_changed');
 });
 await t.test('historical duplicates never select arbitrarily, reveal candidates, merge or insert another profile',()=>{
  make(20,'Casey Demo','2025550105');make(21,'Morgan Demo','+12025550105');
  const missing=result(call('2025550105'));assert.equal(missing.code,'profile_required');assert.equal(missing.candidates,undefined);
  const wrong=result(call('2025550105','Someone Else',crypto.randomUUID(),'fixture-a',true));assert.equal(wrong.code,'identity_ambiguous');assert.equal(wrong.candidates,undefined);
  assert.equal(result(call('2025550105','Casey Demo')).visit.customerId,id(20));
  make(22,'Casey Demo','2025550105');
  assert.equal(result(call('2025550105','Casey Demo',crypto.randomUUID(),'fixture-a',true)).code,'identity_ambiguous');
  assert.equal(sql(`select count(*) from customers where normalize_customer_claim_phone(phone)='+12025550105'`),'3');
 });
 await t.test('local receipt lookup normalizes; simultaneous legacy creation is also safe',async()=>{
  assert.equal(result(`select find_pos_live_draft_customer_by_phone('+12025550101','fixture-a')`).id,id(10));
  const rows=await Promise.all(Array.from({length:6},()=>parallel(`select create_pos_live_draft_customer_by_phone('fixture-b','Riley Demo','2025550106')`)));
  assert.equal(new Set(rows.map(r=>JSON.parse(r).id)).size,1);
  assert.equal(sql(`select count(*) from customers where normalize_customer_claim_phone(phone)='+12025550106'`),'1');
  assert.throws(()=>sql(`select create_pos_live_draft_customer_by_phone('fixture-a','Casey Demo','2025550105')`));
 });
 await t.test('mixed receipt and check-in creation share the same salon lock',async()=>{
  const queries=[call('2025550107','Quinn Demo',crypto.randomUUID(),'fixture-a',true),`select create_pos_live_draft_customer_by_phone('fixture-b','Quinn Demo','+12025550107')`];
  await Promise.all(Array.from({length:8},(_,i)=>parallel(queries[i%2])));
  assert.equal(sql(`select count(*) from customers where normalize_customer_claim_phone(phone)='+12025550107'`),'1');
 });
 await t.test('repeated Confirm updates the same visit; another salon cannot save it',async()=>{
  const visit=result(call('2025550101')).visit.id;
  sql(`insert into services values('${id(90)}','${id(1)}','Synthetic manicure',true,true)`);
  const q=`select update_customer_visit_requested_services('fixture-a','${visit}',array['${id(90)}'::uuid])`;
  const rows=(await Promise.all(Array.from({length:6},()=>parallel(q)))).map(JSON.parse);
  assert.ok(rows.every(r=>r.ok),JSON.stringify(rows));
  assert.equal(sql(`select count(*) from customer_visit_services where visit_id='${visit}'`),'1');
  assert.equal(sql(`select count(*) from customer_visits where customer_id='${id(10)}' and status='waiting'`),'1');
  assert.equal(result(`select update_customer_visit_requested_services('fixture-other','${visit}',array['${id(90)}'::uuid])`).ok,false);
 });
 await t.test('private resolver remains unavailable to public roles',()=>{
  assert.equal(sql(`select has_function_privilege('anon','resolve_display_customer_identity(uuid,text,text,uuid,boolean)','execute')`),'f');
 });
});
