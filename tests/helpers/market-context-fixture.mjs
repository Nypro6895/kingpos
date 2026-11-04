import fs from 'node:fs';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {contextBootstrapFiles} from '../../examples/market-qa-bootstrap/context-build.mjs';
export const contextId=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const contextPrerequisites=`create role anon;create role authenticated;create role service_role;create schema auth;revoke all on schema auth from public;create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);grant usage on schema auth to authenticated;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;set reylumi.qa_bootstrap='synthetic-only-reviewed';set reylumi.qa_context_bootstrap='canonical-context-reviewed';`;
export async function applyContext(db,files=contextBootstrapFiles()){await db.exec('BEGIN');try{for(const f of files)await db.exec(f.sql);await db.exec('COMMIT');}catch(error){await db.exec('ROLLBACK');throw error;}}
export async function contextDatabase(t){const db=new PGlite();t.after(()=>db.close());await db.exec(contextPrerequisites);await applyContext(db);return db;}
const identifier=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw Error('Invalid synthetic adapter identifier');return x;};
const tables=new Set(['users','accounts','locations','roles','permissions','role_permissions','account_memberships','salon_memberships','staff','salon_settings']);
export function contextSqlClient(db){
 const boundary={user:null};
 class Query{
  constructor(table){if(!tables.has(table))throw Error('Unexpected context table');this.table=table;this.columns='*';this.filters=[];this.orders=[];this.mode='select';}
  select(columns){this.columns=columns.split(',').map(x=>identifier(x.trim())).join(',');return this;}
  eq(key,value){this.filters.push({key:identifier(key),value,op:'='});return this;}
  in(key,values){this.filters.push({key:identifier(key),values});return this;}
  is(key,value){if(value!==null)throw Error('Unsupported synthetic filter');this.filters.push({key:identifier(key),isNull:true});return this;}
  order(key,options){this.orders.push(identifier(key)+(options?.ascending===false?' DESC':' ASC'));return this;}
  insert(value){this.mode='insert';this.value=value;return this;}
  async execute(single=false){const args=[],param=value=>{args.push(value);return '$'+args.length;};try{
   let sql;
   if(this.mode==='insert'){const keys=Object.keys(this.value).map(identifier);sql='insert into public.'+this.table+'('+keys.join(',')+') values('+keys.map(k=>param(this.value[k])).join(',')+') returning '+this.columns;}
   else{const where=this.filters.map(f=>f.isNull?f.key+' IS NULL':f.values?(f.values.length?f.key+' IN('+f.values.map(param).join(',')+')':'false'):f.key+'='+param(f.value));sql='select '+this.columns+' from public.'+this.table+(where.length?' where '+where.join(' AND '):'')+(this.orders.length?' order by '+this.orders.join(','):'');}
   const result=await db.query(sql,args);if(single&&result.rows.length>1)throw Error('Unexpected multirow identity');return {data:single?result.rows[0]??null:result.rows,error:null};
  }catch(error){return {data:null,error:{code:error.code??'08006',message:'Synthetic SQL adapter failure'}};}}
  maybeSingle(){return this.execute(true);}
  returns(){return this.execute();}
  then(resolve,reject){return this.execute().then(resolve,reject);}
 }
 const client={from:name=>new Query(name),auth:{getUser:async()=>({data:{user:boundary.user},error:null})},async rpc(name,params={}){try{
  if(!/^market_platform_[a-z_]+$/.test(name)&&!['ensure_personal_account_for_current_user','auth_identity_is_deleted'].includes(name))throw Error('Unexpected context RPC');
  const entries=Object.entries(params),args=entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v),call='public.'+identifier(name)+'('+entries.map(([k],i)=>identifier(k)+'=> $'+(i+1)).join(',')+')';
  const result=await db.query(name==='ensure_personal_account_for_current_user'?'select * from '+call:'select '+call+' value',args);return {data:name==='ensure_personal_account_for_current_user'?result.rows:result.rows[0]?.value,error:null};
 }catch(error){return {data:null,error:{code:error.code??'08006',message:'Synthetic SQL RPC failure'}};}}};
 return {client,boundary};
}
export async function canonicalContextModule(){
 const result=await build({stdin:{contents:'export * from "./lib/current-context.ts";export {getCurrentKingUser,getKingUserForAuthUser} from "./lib/users/current-user.ts";export {ownerAppAction} from "./app/market/developer-app-actions.ts";export {currentOwnerSalon,loadOwnerMarketplace} from "./lib/market-platform/owner.ts";export {platformRpc} from "./lib/market-platform/server.ts";export {setBoundary} from "context-test-boundary";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},define:{'process.env.MARKET_PLATFORM_ENABLED':'"true"','process.env.MARKET_PLATFORM_PUBLIC_ORIGIN':'"http://127.0.0.1:4328"'},metafile:true,plugins:[{name:'framework-and-verified-auth-boundaries-only',setup(b){
  b.onResolve({filter:/^(@\/lib\/supabase\/server|context-test-boundary|next\/headers)$/},()=>({path:'boundary',namespace:'context-fixture'}));
  b.onResolve({filter:/^(server-only|next\/cache)$/},args=>({path:args.path,namespace:'context-fixture'}));
  b.onLoad({filter:/.*/,namespace:'context-fixture'},args=>({loader:'js',contents:args.path==='server-only'?'':args.path==='next/cache'?'export const revalidatePath=()=>{};':`let value={client:null,user:null,cookies:{get:()=>undefined}};export const setBoundary=next=>{value=next};export const createAuthenticatedSupabaseServerClient=async()=>value.client;export const createUserScopedSupabaseServerClient=()=>value.client;export const createSupabaseServerClient=()=>value.client;export const getSupabaseAuthUser=async()=>value.user;export const readPublicUserProfileForAuthIdentity=(client,accessToken,authUserId)=>client.from("users").select("id, auth_user_id, email, phone, first_name, last_name, display_name, avatar_url, status, language, timezone, deletion_requested_at, deletion_scheduled_for, deleted_at, anonymized_at, deletion_finalization_started_at, deletion_finalized_at, deletion_finalization_attempts, deletion_finalization_failed_at, deletion_finalization_error, last_login_at, created_at, updated_at").eq("auth_user_id",authUserId).maybeSingle();export const getAccessTokenFromRequest=async()=>'synthetic-access';export const cookies=async()=>value.cookies;export const headers=async()=>new Map();` }));
 }}]});
 const inputs=Object.keys(result.metafile.inputs);for(const required of ['lib/current-context.ts','lib/users/current-user.ts','lib/market-plugins.ts','lib/market-platform/owner.ts','lib/membership-permissions.ts','app/market/developer-app-actions.ts'])if(!inputs.includes(required))throw Error('Canonical resolver missing from test bundle');
 return {module:await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')),inputs};
}
export async function contextFixture(t){
 const db=await contextDatabase(t),adapter=contextSqlClient(db),{module,inputs}=await canonicalContextModule();
 for(let n=1;n<=4;n++){await db.query('insert into auth.users(id) values($1)',[contextId('9',n)]);await db.query('update public.users set auth_user_id=$1 where id=$2',[contextId('9',n),contextId('1',n)]);}
 async function actor(n,cookieEntries={}){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[contextId('9',n)]);await db.exec('set role authenticated');const user={id:contextId('9',n),email:n===1?'owner@qa.example.invalid':'synthetic@qa.example.invalid',user_metadata:{}};adapter.boundary.user=user;const cookies={get:key=>cookieEntries[key]===undefined?undefined:{value:cookieEntries[key]}};module.setBoundary({client:adapter.client,user,cookies});return {user,cookies};}
 return {db,module,inputs,actor,client:adapter.client};
}
export const canonicalProjection=(file,name)=>fs.readFileSync(file,'utf8').match(new RegExp('const '+name+' =\\s*"([^"]+)"'))[1];
