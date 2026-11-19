import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';

const U='00000000-0000-4000-8000-000000000001';
const V='00000000-0000-4000-8000-000000000002';
const E='10000000-0000-4000-8000-000000000001';
const F='10000000-0000-4000-8000-000000000002';
const G='10000000-0000-4000-8000-000000000003';
const migration=fs.readFileSync('supabase/migrations/20261116211000_lifecycle_export_expiry.sql','utf8');
const bundle=await build({
  entryPoints:['lib/lifecycle-export-expiry.ts'],bundle:true,write:false,format:'esm',platform:'node',
  alias:{'@':path.resolve('.')},
  plugins:[{name:'expiry-imports',setup(api){
    api.onResolve({filter:/^(server-only|@supabase\/supabase-js)$/},a=>({path:a.path,namespace:'stub'}));
    api.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export function createClient(){throw Error("No provider calls in this test");}'}));
  }}],
});
const {processExpiredLifecycleExport}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

async function fixture({operationHelpers=true}={}){
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create function public.current_public_user_id() returns uuid language sql
      as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table public.lifecycle_exports (
      id uuid primary key, export_type text not null, account_id uuid, salon_id uuid,
      subject_user_id uuid, requested_by_user_id uuid, status text not null default 'created',
      storage_bucket text not null default 'lifecycle-exports', storage_path text not null,
      content_type text not null default 'application/json', manifest jsonb not null default '{}',
      expires_at timestamptz not null default now()+interval '7 days',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table storage.objects(bucket_id text not null,name text not null,primary key(bucket_id,name));
    alter table public.lifecycle_exports enable row level security;
    alter table storage.objects enable row level security;
    grant usage on schema public,storage to authenticated,service_role;
    grant all on public.lifecycle_exports,storage.objects to authenticated,service_role;
    create policy lifecycle_export_requester_read on public.lifecycle_exports for select to authenticated
      using(requested_by_user_id=public.current_public_user_id());
    create policy lifecycle_export_requester_insert on public.lifecycle_exports for insert to authenticated
      with check(requested_by_user_id=public.current_public_user_id());
    create policy lifecycle_export_requester_update on public.lifecycle_exports for update to authenticated
      using(requested_by_user_id=public.current_public_user_id())
      with check(requested_by_user_id=public.current_public_user_id());
    create policy broad_storage_access on storage.objects for all to authenticated using(true) with check(true);
    insert into public.lifecycle_exports(id,export_type,requested_by_user_id,status,storage_path,expires_at)
      values('${G}','account_data','${U}','stored','${U}/${G}/legacy.json',now()-interval '1 day');
    insert into storage.objects values('lifecycle-exports','${U}/${G}/legacy.json');
  `);
  if(operationHelpers){
    // Models documented operation matching; this is not the hosted Storage server.
    await db.exec(`
      create function storage.allow_only_operation(text) returns boolean language sql stable as $$
        select coalesce(regexp_replace(current_setting('storage.operation',true),'^storage\\.','')
          = regexp_replace($1,'^storage\\.',''),false) and coalesce($1,'')<>''
      $$;
      create function storage.allow_any_operation(text[]) returns boolean language sql stable as $$
        select coalesce(bool_or(storage.allow_only_operation(x)),false) from unnest($1) x
      $$;
    `);
  }
  return db;
}
async function owner(db){await db.exec('reset role');}
async function actor(db,uid=U,operation='storage.object.get_authenticated'){
  await owner(db);await db.query("select set_config('test.uid',$1,false),set_config('storage.operation',$2,false)",[uid,operation]);
  await db.exec('set role authenticated');
}
async function add(db,id=E,uid=U){
  await owner(db);
  await db.query(`insert into lifecycle_exports(id,export_type,requested_by_user_id,storage_path,expires_at)
    values($1,'account_data',$2,$3,now()+interval '500 days')`,[id,uid,`${uid}/${id}/export.json`]);
  await db.query("insert into storage.objects values('lifecycle-exports',$1)",[`${uid}/${id}/export.json`]);
  await db.query("update lifecycle_exports set status='stored' where id=$1",[id]);
}
async function expire(db,id=E){
  await owner(db);await db.query("update lifecycle_exports set expires_at=clock_timestamp()-interval '1 hour' where id=$1",[id]);
}
const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
const jobs=async db=>(await one(db,'select claim_expired_lifecycle_exports(10) result')).result;

test('migration fails closed without operation-aware Storage support and is replayable with it',async()=>{
  const unsupported=await fixture({operationHelpers:false});
  try{await assert.rejects(unsupported.exec(migration),/operation-aware RLS/);await unsupported.exec('rollback');}
  finally{await unsupported.close();}
  const db=await fixture();
  try{await db.exec(migration);await db.exec(migration);assert.equal((await one(db,"select expiry_cleanup_enabled from lifecycle_exports where id=$1",[G])).expiry_cleanup_enabled,false);}
  finally{await db.close();}
});

test('database sets seven-day lifetime; requester cannot extend, retarget or enable historical purge',async()=>{
  const db=await fixture();
  try{
    await db.exec(migration);await add(db);
    const r=await one(db,"select extract(epoch from(expires_at-created_at)) seconds,expiry_cleanup_enabled from lifecycle_exports where id=$1",[E]);
    assert.equal(Number(r.seconds),7*86400);assert.equal(r.expiry_cleanup_enabled,true);
    await actor(db);
    for(const change of ["expires_at=now()+interval '1 year'","storage_path='other/path'","expiry_cleanup_enabled=false","manifest='{\"changed\":true}'","status='expired'"]){
      await assert.rejects(db.query(`update lifecycle_exports set ${change} where id=$1`,[E]),/identity and expiry/);
    }
    await owner(db);await db.query("update lifecycle_exports set expires_at=now()+interval '1 hour' where id=$1",[G]);
    await actor(db);
    await assert.rejects(db.query('update lifecycle_exports set expiry_cleanup_enabled=true where id=$1',[G]),/identity and expiry/);
    assert.equal((await db.query('delete from lifecycle_exports where id=$1 returning id',[E])).rows.length,0);
    await owner(db);assert.equal((await one(db,'select count(*) n from lifecycle_exports where id=$1',[E])).n,1);
  }finally{await db.close();}
});

test('expiry/requester/status gates beat broad policies, while another bucket is preserved',async()=>{
  const db=await fixture();
  try{
    await db.exec(migration);await add(db);await add(db,F,V);
    await owner(db);await db.exec("insert into storage.objects values('unrelated','sample')");
    await actor(db);
    assert.equal((await db.query("select name from storage.objects where bucket_id='lifecycle-exports'")).rows.length,1);
    assert.equal((await db.query("select name from storage.objects where bucket_id='unrelated'")).rows.length,1);
    await expire(db);await actor(db);
    assert.equal((await db.query("select name from storage.objects where bucket_id='lifecycle-exports'")).rows.length,0);
    assert.equal((await db.query('select id from lifecycle_exports')).rows.length,0);
  }finally{await db.close();}
});

test('direct download signing and signed-upload issuance are denied; ordinary authorized operations work',async()=>{
  const db=await fixture();
  try{
    await db.exec(migration);await add(db);
    for(const op of ['storage.object.sign','storage.object.sign_many','storage.render.image_sign','storage.s3.object.get','']){
      await actor(db,U,op);
      assert.equal((await db.query("select name from storage.objects where bucket_id='lifecycle-exports'")).rows.length,0,op);
    }
    await actor(db,U,'storage.object.get_authenticated');
    assert.equal((await db.query("select name from storage.objects where bucket_id='lifecycle-exports'")).rows.length,1);
    await owner(db);await db.query(`insert into lifecycle_exports(id,export_type,requested_by_user_id,storage_path)
      values($1,'account_data',$2,$3)`,[F,U,`${U}/${F}/export.json`]);
    for(const op of ['storage.object.sign_upload_url','storage.s3.upload','storage.tus.upload.create','']){
      await actor(db,U,op);
      await assert.rejects(db.query("insert into storage.objects values('lifecycle-exports',$1)",[`${U}/${F}/export.json`]),/row-level security/,op);
    }
    await actor(db,U,'storage.object.upload');
    await db.query("insert into storage.objects values('lifecycle-exports',$1)",[`${U}/${F}/export.json`]);
    await assert.rejects(db.query("insert into storage.objects values('lifecycle-exports',$1)",[`${U}/${F}/untracked.json`]),/row-level security/);
    const changed=await db.query("update storage.objects set name='replaced' where name=$1 returning name",[`${U}/${F}/export.json`]);
    assert.equal(changed.rows.length,0);
  }finally{await db.close();}
});

test('queue is privileged, excludes legacy and active files, and leases retry without false completion',async()=>{
  const db=await fixture();
  try{
    await db.exec(migration);await add(db);await add(db,F);await expire(db);
    await actor(db);
    await assert.rejects(db.query('select claim_expired_lifecycle_exports(10)'),/permission denied/);
    await owner(db);
    const first=await jobs(db);assert.deepEqual(first.map(x=>x.id),[E]);
    assert.deepEqual(await jobs(db),[]);
    await assert.rejects(db.query('select finish_lifecycle_export_expiry($1,$2)',[E,F]),/Invalid export expiry lease/);
    await assert.rejects(db.query('select finish_lifecycle_export_expiry($1,$2)',[E,first[0].lease]),/not verified/);
    assert.equal((await one(db,'select storage_deleted_at from lifecycle_exports where id=$1',[E])).storage_deleted_at,null);
    await db.query("update lifecycle_exports set expiry_cleanup_claimed_at=now()-interval '16 minutes' where id=$1",[E]);
    const second=await jobs(db);assert.equal(second.length,1);assert.notEqual(second[0].lease,first[0].lease);
    await assert.rejects(db.query('select finish_lifecycle_export_expiry($1,$2)',[E,first[0].lease]),/Invalid export expiry lease/);
    await db.query("delete from storage.objects where bucket_id='lifecycle-exports' and name=$1",[second[0].path]);
    assert.equal((await one(db,'select finish_lifecycle_export_expiry($1,$2) ok',[E,second[0].lease])).ok,true);
    assert.deepEqual(await jobs(db),[]);
    assert.equal((await one(db,'select storage_deleted_at from lifecycle_exports where id=$1',[G])).storage_deleted_at,null);
  }finally{await db.close();}
});

test('worker uses Storage removal then actual DB verification; provider or verification failure stays retryable',async()=>{
  const db=await fixture();
  try{
    await db.exec(migration);await add(db);await expire(db);
    const [job]=await jobs(db);const calls=[];
    function client(mode){
      return {
        storage:{from(bucket){assert.equal(bucket,'lifecycle-exports');return {async remove(paths){
          calls.push('remove');
          if(mode==='provider-error')return {error:{message:'unavailable'}};
          if(mode!=='unverified')await db.query('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,paths[0]]);
          return {error:null};
        }};}},
        async rpc(name,args){
          calls.push('verify');assert.equal(name,'finish_lifecycle_export_expiry');
          try{return {data:(await one(db,'select finish_lifecycle_export_expiry($1,$2) ok',[args.p_export_id,args.p_lease])).ok};}
          catch{return {error:{message:'checkpoint rejected'}};}
        },
      };
    }
    assert.equal(await processExpiredLifecycleExport(client('provider-error'),job,Date.now()+10000),false);
    assert.deepEqual(calls,['remove']);calls.length=0;
    assert.equal(await processExpiredLifecycleExport(client('unverified'),job,Date.now()+10000),false);
    assert.deepEqual(calls,['remove','verify']);calls.length=0;
    assert.equal(await processExpiredLifecycleExport(client('ok'),job,Date.now()+10000),true);
    assert.deepEqual(calls,['remove','verify']);
    assert.ok((await one(db,'select storage_deleted_at from lifecycle_exports where id=$1',[E])).storage_deleted_at);
  }finally{await db.close();}
});

test('worker rejects future, cross-bucket, malformed and deadline-expired jobs before a storage call',async()=>{
  const base={id:E,lease:F,bucket:'lifecycle-exports',path:`${U}/${E}/export.json`,requesterId:U,expiresAt:new Date(Date.now()-1000).toISOString()};
  const client={storage:{from(){throw Error('Storage must not be reached');}}};
  for(const change of [{bucket:'payroll-paystubs'},{path:`${U}/${F}/export.json`},{requesterId:V},{path:`${U}/${E}/../file`},{expiresAt:new Date(Date.now()+60000).toISOString()},{expiresAt:'invalid'},{lease:'invalid'}]){
    assert.equal(await processExpiredLifecycleExport(client,{...base,...change},Date.now()+10000),false);
  }
  assert.equal(await processExpiredLifecycleExport(client,base,Date.now()-1),false);
});
