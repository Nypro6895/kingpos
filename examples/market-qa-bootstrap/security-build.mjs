// Explicit canonical slices. No discovery of migration history, DB or network.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {qaBootstrapFiles} from './build.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const digest=x=>createHash('sha256').update(x).digest('hex');
const normalize=x=>x.replaceAll('\r\n','\n').replace(/\n+$/,'\n');
const baseline='supabase/migrations/202607240001_account_salon_baseline.sql';
const security='supabase/migrations/202608300001_account_login_security.sql';
const read=source=>fs.readFileSync(path.join(root,source));
export function canonicalSlice(source,start,end){
 const raw=read(source),text=normalize(raw.toString()),first=text.indexOf(start);
 if(first<0||text.indexOf(start,first+start.length)>=0)throw Error('Missing or ambiguous canonical start anchor: '+source);
 const last=text.indexOf(end,first+start.length);
 if(last<0)throw Error('Missing canonical end anchor: '+source);
 const sql=normalize(text.slice(first,last).trimEnd()+'\n');
 return {source,start,end,startLine:text.slice(0,first).split('\n').length,endLine:text.slice(0,last).split('\n').length-1,rawSha256:digest(raw),sliceSha256:digest(sql),sql};
}
export function securityBootstrapFiles(){
 const tables=['account_security_preferences','account_login_sessions','account_trusted_devices','account_login_activity','account_recovery_codes','account_recovery_requests'];
 const slices=[canonicalSlice(baseline,'create or replace function public.set_updated_at()','create table public.users ('),
  canonicalSlice(security,'create table if not exists public.account_security_preferences (','drop policy if exists "account_security_preferences_self_read"')];
 for(const table of tables)slices.push(canonicalSlice(security,'create policy "'+table+'_self_read"','drop policy if exists "'+(['account_security_preferences','account_recovery_codes'].includes(table)?table+'_self_insert':table+'_support_read')+'"'));
 const provenance=slices.map(({sql:ignored,...entry})=>{void ignored;return entry;});
 const preflightSource='examples/market-qa-bootstrap/12-security-preflight.sql',raw=read(preflightSource),preflight=normalize(raw.toString());
 const canonicalSql='-- Generated exact canonical slices; READ-ONLY QA subset. See manifest provenance.\n'+slices.map(s=>s.sql).join('\n');
 const objects=[...tables,'account_recovery_request_events'];
 const projections={
  account_security_preferences:'user_id,recovery_email,recovery_phone,login_alerts_enabled,sms_login_alerts_enabled,updated_at',
  account_login_sessions:'id,user_id,auth_user_id,device_label,browser_name,os_name,device_type,city,region,country,location_label,user_agent,trusted_at,revoked_at,last_seen_at,created_at',
  account_trusted_devices:'id,user_id,device_label,browser_name,os_name,device_type,location_label,trusted_at,last_seen_at,created_at,removed_at',
  account_login_activity:'id,user_id,activity_type,device_label,browser_name,os_name,location_label,metadata,created_at',
  account_recovery_codes:'id,user_id,used_at,created_at,revoked_at',
  account_recovery_requests:'id,user_id,request_type,status,contact_email,contact_phone,details,created_at,updated_at'
 };
 const restrictions='\n-- QA-only restriction: no mutation grants/policies, support/admin, redemption or recording RPC.\n'+
  objects.map(t=>'REVOKE ALL ON TABLE public.'+t+' FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;').join('\n')+'\n'+
  tables.map(t=>'GRANT SELECT('+projections[t]+') ON TABLE public.'+t+' TO authenticated;').join('\n')+'\n'+
  'REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;\n'+
  "CREATE TABLE qa_bootstrap.security_read_contract(id boolean PRIMARY KEY CHECK(id),scope text NOT NULL CHECK(scope='canonical-security-read-only'));\n"+
  "INSERT INTO qa_bootstrap.security_read_contract VALUES(true,'canonical-security-read-only');\n"+
  'REVOKE ALL ON TABLE qa_bootstrap.security_read_contract FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;\n';
 const sql=canonicalSql+restrictions;
 const foundation=qaBootstrapFiles().map(f=>{
  if(!f.source.startsWith('supabase/migrations/'))return f;
  if(!f.sql.startsWith('begin;\n')||!f.sql.endsWith('commit;\n'))throw Error('Unexpected canonical transaction wrapper');
  const body=normalize(f.sql.slice('begin;\n'.length,-'commit;\n'.length));
  if(/^\s*(begin|commit|rollback);\s*$/im.test(body))throw Error('Unexpected nested transaction control');
  return {...f,sql:body,sourceExecutedSha256:f.executedSha256,executedSha256:digest(body),transformation:'Remove exact outer begin;/commit; and normalize one final LF for one atomic companion transaction; SQL statements unchanged'};
 });
 return [...foundation,{source:preflightSource,name:'12-security-preflight.sql',sql:preflight,rawSha256:digest(raw),executedSha256:digest(preflight)},
  {source:'explicit canonical slices + QA-only read restrictions',name:'13-security-read-contract.sql',sql,executedSha256:digest(sql),provenance}];
}
export function dependencyInventory(){
 const plan=JSON.parse(read('examples/market-qa-bootstrap/dependency-plan.json'));
 return {...plan,readiness:'NOT a full app/Auth bootstrap; no hosted acceptance',routes:plan.routes.map(route=>({...route,sources:route.sources.map(source=>{
  const raw=read(source),text=raw.toString();
  const names=pattern=>[...new Set([...text.matchAll(pattern)].map(m=>m[1]))].sort();
  return {source,rawSha256:digest(raw),literalTableCalls:names(/\.from\(\s*["']([^"']+)["']/g),literalRpcCalls:names(/\.rpc\(\s*["']([^"']+)["']/g),platformRpcOperations:names(/platformRpc(?:<[^;]*?>)?\(\s*["']([^"']+)["']/g)};
 })}))};
}
export function writeSecurityBootstrap(output){
 const files=securityBootstrapFiles();fs.mkdirSync(output,{recursive:true});
 for(const f of files)fs.writeFileSync(path.join(output,f.name),f.sql);
 const inventory=JSON.stringify(dependencyInventory(),null,2)+'\n';
 fs.writeFileSync(path.join(output,'dependency-inventory.json'),inventory);
 const manifest={scope:'Fresh synthetic Market contract plus canonical security READ-ONLY SQL subset; not full account/Owner shell bootstrap',featureEnabled:false,financeEnabled:false,authAccountsCreated:0,securityMutations:false,canonicalAuthRoutesChanged:false,inventorySha256:digest(inventory),normalization:'CRLF to LF; one final LF; exact outer transaction wrappers removed from seven Market migrations for one atomic companion transaction',files:files.map(({sql:ignored,...f})=>{void ignored;return f;})};
 fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync(path.join(output,'apply.psql'),'-- REVIEW ONLY. Exact QA project/operator approval and both markers required. No connection supplied.\n\\set ON_ERROR_STOP on\nBEGIN;\n'+files.map(f=>'\\ir '+f.name).join('\n')+'\nCOMMIT;\n');
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const manifest=writeSecurityBootstrap(path.join(here,'security-bundle'));
 console.log('Wrote '+manifest.files.length+' explicit SQL artifacts; no DB/Auth/provider connection.');
}
