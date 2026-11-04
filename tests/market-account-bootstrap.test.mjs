import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {qaBootstrapFiles} from '../examples/market-qa-bootstrap/build.mjs';
import {canonicalSlice,securityBootstrapFiles,dependencyInventory} from '../examples/market-qa-bootstrap/security-build.mjs';
const id=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const prerequisite=`create role anon;create role authenticated;create role service_role;create schema auth;revoke all on schema auth from public;create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);grant usage on schema auth to authenticated;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;set reylumi.qa_bootstrap='synthetic-only-reviewed';`;
const marker="set reylumi.qa_security_bootstrap='read-only-contract-reviewed'";
const tables=['account_security_preferences','account_login_sessions','account_trusted_devices','account_login_activity','account_recovery_codes','account_recovery_requests'];
async function database(t){const db=new PGlite();t.after(()=>db.close());await db.exec(prerequisite);return db;}
async function apply(db,files=securityBootstrapFiles()){await db.exec('BEGIN');try{for(const file of files)await db.exec(file.sql);await db.exec('COMMIT');}catch(error){await db.exec('ROLLBACK');throw error;}}
async function ready(t){const db=await database(t);await db.exec(marker);await apply(db);return db;}
async function bindFixtures(db){for(let n=1;n<=2;n++){await db.query('insert into auth.users(id) values($1)',[id('9',n)]);await db.query('update public.users set auth_user_id=$1 where id=$2',[id('9',n),id('1',n)]);}}
async function actor(db,n){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id('9',n)]);await db.exec('set role authenticated');}
const projection=name=>{const text=fs.readFileSync('lib/account-security.ts','utf8'),match=text.match(new RegExp('const '+name+' =\\s*"([^"]+)"'));assert.ok(match,'Canonical security projection exists');return match[1];};

test('security companion is deterministic and every canonical slice/inventory source is exact and bounded',()=>{
 const files=securityBootstrapFiles();assert.equal(files.length,14);assert.deepEqual(securityBootstrapFiles(),files);
 const base=qaBootstrapFiles();for(let i=0;i<12;i++){assert.equal(files[i].source,base[i].source);assert.equal(files[i].rawSha256,base[i].rawSha256);assert.equal(files[i].sql,base[i].source.startsWith('supabase/migrations/')?base[i].sql.slice('begin;\n'.length,-'commit;\n'.length).replace(/\n+$/,'\n'):base[i].sql);}
 const pieces=files.at(-1).provenance;assert.equal(pieces.length,8);
 for(const p of pieces){assert.deepEqual(canonicalSlice(p.source,p.start,p.end),{...p,sql:canonicalSlice(p.source,p.start,p.end).sql});assert.equal(createHash('sha256').update(fs.readFileSync(p.source)).digest('hex'),p.rawSha256);}
 assert.throws(()=>canonicalSlice(pieces[0].source,'missing anchor','missing end'),/anchor/);
 const inventory=dependencyInventory();assert.equal(inventory.routes.length,14);assert.equal(new Set(inventory.routes.map(r=>r.id)).size,14);
 for(const route of inventory.routes){assert.ok(route.dependencies.length&&route.artifact&&route.localProof&&route.unverified);for(const s of route.sources)assert.match(s.rawSha256,/^[a-f0-9]{64}$/);}
 assert.ok(inventory.routes.find(r=>r.id==='login').sources.some(s=>s.literalRpcCalls.includes('record_account_login_session')));
 const sql=files.at(-1).sql;for(const unwanted of ['create or replace function public.record_account_login_session','create or replace function public.redeem_account_recovery_code','create policy "account_security_preferences_self_update"','lifecycle_current_user_is_support_admin'])assert.equal(sql.includes(unwanted),false);
});

test('fresh fourteen-file transaction adds seven canonical RLS tables, leaves defaultoff and provisions no Auth/security data',async t=>{
 const db=await ready(t);
 assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from public.users where auth_user_id is not null')).rows[0].n,0);
 assert.deepEqual((await db.query('select enabled,commerce_test_enabled from market_platform.settings')).rows[0],{enabled:false,commerce_test_enabled:false});
 for(const name of [...tables,'account_recovery_request_events']){assert.equal((await db.query('select count(*)::int n from public.'+name)).rows[0].n,0);assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',['public.'+name])).rows[0].relrowsecurity,true);}
 assert.equal((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and proname in('record_account_login_session','redeem_account_recovery_code','account_recovery_support_update_request')")).rows[0].n,0);
 assert.deepEqual((await db.query("select rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname='qr_menu_qa_runtime'")).rows[0],{rolcanlogin:false,rolsuper:false,rolbypassrls:false});
});

test('canonical security overview projections execute with self RLS; foreign identities, digests and event rows are denied',async t=>{
 const db=await ready(t);await bindFixtures(db);
 for(let n=1;n<=2;n++){
  await db.query('insert into public.account_security_preferences(user_id) values($1)',[id('1',n)]);
  await db.query('insert into public.account_login_sessions(id,user_id,auth_user_id) values($1,$2,$3)',[id('7',n),id('1',n),id('9',n)]);
  await db.query('insert into public.account_trusted_devices(user_id,login_session_id) values($1,$2)',[id('1',n),id('7',n)]);
  await db.query("insert into public.account_login_activity(user_id,activity_type) values($1,'synthetic_contract_read')",[id('1',n)]);
  await db.query("insert into public.account_recovery_codes(user_id,code_digest) values($1,$2)",[id('1',n),String(n).repeat(64)]);
  await db.query("insert into public.account_recovery_requests(user_id,request_type) values($1,'lost_access')",[id('1',n)]);
 }
 await actor(db,1);
 const projections=[projection('PREFERENCES_SELECT'),projection('SESSION_SELECT'),projection('TRUSTED_DEVICE_SELECT'),projection('ACTIVITY_SELECT'),'id, used_at, created_at',projection('RECOVERY_REQUEST_SELECT')];
 for(let n=0;n<tables.length;n++){const name=tables[n],own=await db.query('select '+projections[n]+' from public.'+name+' where user_id=$1',[id('1',1)]);assert.equal(own.rows.length,1);assert.equal((await db.query('select '+projections[n]+' from public.'+name+' where user_id=$1',[id('1',2)])).rows.length,0);}
 assert.equal((await db.query('select revoked_at from public.account_login_sessions where id=$1 and auth_user_id=$2',[id('7',1),id('9',1)])).rows.length,1);
 assert.equal((await db.query('select revoked_at from public.account_login_sessions where id=$1 and auth_user_id=$2',[id('7',2),id('9',2)])).rows.length,0);
 await assert.rejects(db.exec('select code_digest from public.account_recovery_codes'),/permission denied/);
 await assert.rejects(db.exec('select * from public.account_recovery_request_events'),/permission denied/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id('1',1)]);assert.equal((await db.query('select id from public.account_login_sessions')).rows.length,0,'A public profile ID is not an Auth subject');
});

test('read-only companion denies all own/foreign writes and all anon/service/QR access; RLS is not a fake successful mutation',async t=>{
 const db=await ready(t);await bindFixtures(db);await actor(db,1);
 for(const user of [id('1',1),id('1',2)])await assert.rejects(db.query('insert into public.account_security_preferences(user_id) values($1)',[user]),/permission denied/);
 for(const name of tables){await assert.rejects(db.exec('delete from public.'+name),/permission denied/);await assert.rejects(db.exec('update public.'+name+' set user_id=user_id'),/permission denied/);}
 for(const role of ['anon','service_role','qr_menu_qa_runtime']){await db.exec('reset role;set role '+role);for(const name of tables)await assert.rejects(db.exec('select user_id from public.'+name),/permission denied/);await assert.rejects(db.exec('select * from qa_bootstrap.security_read_contract'),/permission denied/);}
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from public.account_security_preferences')).rows[0].n,0);
});

test('markers, reapply, unrelated data and dirty fixtures fail closed; failed fresh transaction leaves no partial app schema',async t=>{
 const db=await database(t);await assert.rejects(apply(db),/security contract marker/);assert.equal((await db.query("select to_regclass('public.users') name")).rows[0].name,null);
 await db.exec(marker);await db.exec('create table public.unrelated_business_data(id uuid)');await assert.rejects(apply(db),/empty application/);await db.exec('drop table public.unrelated_business_data');await apply(db);
 await assert.rejects(apply(db),/empty application/);const preflight=securityBootstrapFiles()[12].sql;await assert.rejects(db.exec(preflight),/reapply/);
 const base=await database(t);for(const file of qaBootstrapFiles())await base.exec(file.sql);await base.exec(marker);await base.exec('create table public.unrelated_business_data(id uuid)');await assert.rejects(base.exec(preflight),/unrelated/);await base.exec('drop table public.unrelated_business_data');await base.exec('update market_platform.settings set enabled=true');await assert.rejects(base.exec(preflight),/untouched/);await base.exec('update market_platform.settings set enabled=false');
 for(const sql of ["update public.users set display_name='Changed fixture'", "update public.locations set status='suspended'",'update market_platform.settings set commission_bps=500']){await base.exec('begin');try{await base.exec(sql);await assert.rejects(base.exec(preflight),/untouched/);}finally{await base.exec('rollback');}}
 await base.query('insert into auth.users(id) values($1)',[id('9',1)]);await assert.rejects(base.exec(preflight),/untouched/);
});

test('negative controls keep full current-user/Owner projections and canonical security mutations visibly unimplemented',async t=>{
 const db=await ready(t),currentUser=fs.readFileSync('lib/users/current-user.ts','utf8').match(/const USER_SELECT =\s*"([^"]+)"/)[1];
 await assert.rejects(db.exec('select '+currentUser+' from public.users'),error=>error.code==='42703');
 const context=fs.readFileSync('lib/current-context.ts','utf8');
 for(const [name,table]of [['ACCOUNT_SELECT','accounts'],['ROLE_SELECT','roles'],['LOCATION_SELECT','locations']]){const columns=context.match(new RegExp('(?:const|let) '+name+' =\\s*"([^"]+)"'))[1];await assert.rejects(db.exec('select '+columns+' from public.'+table),error=>error.code==='42703');}
 for(const rpc of ['record_account_login_session','redeem_account_recovery_code','ensure_personal_account_for_current_user'])assert.equal((await db.query('select count(*)::int n from pg_proc where proname=$1 and pronamespace=\'public\'::regnamespace',[rpc])).rows[0].n,0);
});

test('canonical platformRpc uses actual SQL through an injected Auth-client boundary; disabled/unknown-subject/foreign-salon/outage do not become success',async t=>{
 const compile=async enabled=>{
  const result=await build({stdin:{contents:'export {platformRpc,PlatformError} from "./lib/market-platform/server.ts"; export {setClient} from "qa-auth-boundary";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',define:{'process.env.MARKET_PLATFORM_ENABLED':JSON.stringify(String(enabled))},plugins:[{name:'synthetic-auth-client-boundary',setup(b){
   b.onResolve({filter:/^(@\/lib\/supabase\/server|qa-auth-boundary)$/},()=>({path:'auth-client',namespace:'qa-boundary'}));
   b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'qa-boundary'}));
   b.onLoad({filter:/.*/,namespace:'qa-boundary'},args=>({contents:args.path==='server-only'?'':'let client=null;export const setClient=value=>{client=value};export const createAuthenticatedSupabaseServerClient=async()=>client;',loader:'js'}));
  }}]});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 };
 const db=await ready(t);await bindFixtures(db);const enabled=await compile(true),disabled=await compile(false);let calls=0;
 const client={async rpc(name,params){calls++;try{
  if(name==='market_platform_workspace')return {data:(await db.query('select public.market_platform_workspace() value')).rows[0].value,error:null};
  if(name==='market_platform_owner_workspace')return {data:(await db.query('select public.market_platform_owner_workspace($1::uuid) value',[params.p_salon])).rows[0].value,error:null};
  throw Error('Unexpected RPC');
 }catch(error){return {data:null,error:{code:error.code??'08006',message:'Synthetic SQL boundary rejection'}};}}};
 disabled.setClient(client);await assert.rejects(disabled.platformRpc('workspace'),/not enabled/);assert.equal(calls,0);
 enabled.setClient(null);await assert.rejects(enabled.platformRpc('workspace'),/Sign in/);
 enabled.setClient(client);await actor(db,1);await assert.rejects(enabled.platformRpc('workspace'),e=>e instanceof enabled.PlatformError&&e.outcome==='rejected');
 await db.exec('reset role;update market_platform.settings set enabled=true');await actor(db,1);const workspace=await enabled.platformRpc('workspace');assert.ok(Array.isArray(workspace.salons),'Actual workspace SQL result, not a fabricated success');
 await assert.rejects(enabled.platformRpc('owner_workspace',{p_salon:id('4',2)}),e=>e instanceof enabled.PlatformError&&e.outcome==='rejected');
 await actor(db,99);await assert.rejects(enabled.platformRpc('workspace'),e=>e instanceof enabled.PlatformError&&e.outcome==='rejected');
 enabled.setClient({rpc:async()=>({data:null,error:{code:'08006',message:'Synthetic unavailable database'}})});await assert.rejects(enabled.platformRpc('workspace'),e=>e instanceof enabled.PlatformError&&e.outcome==='unknown');
});
