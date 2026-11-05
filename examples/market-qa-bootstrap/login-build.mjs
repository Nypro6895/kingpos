import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {contextBootstrapFiles,contextSlice,contextGraph} from './context-build.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..'),core='supabase/migrations/202610070008_abuse_prevention.sql',admission='supabase/migrations/20261015190000_signup_admission_retries.sql';
const hash=x=>createHash('sha256').update(x).digest('hex');
const generated=(name,slices,extra='')=>{const sql=slices.map(s=>s.sql).join('\n')+extra;return {source:'Explicit canonical login-gate slices + narrow QA ACLs',name,sql,executedSha256:hash(sql),provenance:slices.map(({sql:ignored,...p})=>{void ignored;return p;})};};
export function loginBootstrapFiles(){
 const names=['abuse_system_settings','abuse_counters','abuse_restrictions','abuse_events','abuse_verification_passes'];
 const tables=names.map(n=>contextSlice(core,'create table public.'+n+' (',/\n\);/));
 const helpers=['abuse_take','abuse_matching_restriction'].map(n=>contextSlice(core,'create function public.'+n+'(',/\$\$;/));helpers.push(contextSlice(admission,'create or replace function public.abuse_preflight(',/\$\$;/));
 const source='examples/market-qa-bootstrap/login-preflight.sql',raw=fs.readFileSync(path.join(root,source)),sql=raw.toString().replaceAll('\r\n','\n').replace(/\n+$/,'\n');
 const restrictions='\n-- Canonical initial settings only: no signing key/configuration or signup trigger.\nINSERT INTO public.abuse_system_settings(id) VALUES(true);\n'+names.map(n=>'ALTER TABLE public.'+n+' ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.'+n+' FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;').join('\n')+'\n';
 const acl='\nREVOKE ALL ON FUNCTION public.abuse_take(text,text,text,integer,integer),public.abuse_matching_restriction(uuid,text,text,text),public.abuse_preflight(text,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;\nGRANT EXECUTE ON FUNCTION public.abuse_preflight(text,uuid,text,text,text,text) TO service_role;\n';
 return [...contextBootstrapFiles(),{source,name:'15-login-preflight.sql',sql,rawSha256:hash(raw),executedSha256:hash(sql)},generated('16-login-abuse-tables.sql',tables,restrictions),generated('17-login-abuse-helpers.sql',helpers,acl)];
}
export function writeLoginBootstrap(output){
 const files=loginBootstrapFiles();fs.mkdirSync(output,{recursive:true});for(const f of files)fs.writeFileSync(path.join(output,f.name),f.sql);
 const graph={context:contextGraph(),login:{entry:'lib/abuse-server.ts assertAbuseRequest(login)',tables:['abuse_system_settings','abuse_counters','abuse_restrictions','abuse_events','abuse_verification_passes'],functions:['abuse_take','abuse_matching_restriction','abuse_preflight'],caller:'Market QA server service_role only; no browser/QR execute',unprovided:['configure_abuse_security','issue_abuse_signup_ticket','abuse_guard_signup','security-check challenge RPCs','post/comment moderation','record_account_login_session/notifications/booking']}};
 fs.writeFileSync(path.join(output,'dependency-graph.json'),JSON.stringify(graph,null,2)+'\n');
 const manifest={scope:'Fresh18SQL canonical context + LOGIN abuse preflight only; not complete Auth/security/signup/app shell',featureEnabled:false,financeEnabled:false,authAccountsCreated:0,signingKeySupplied:false,canonicalAuthChanged:false,recordLoginSupplied:false,remaining:graph.login.unprovided,graphSha256:hash(JSON.stringify(graph,null,2)+'\n'),files:files.map(({sql:ignored,...f})=>{void ignored;return f;})};
 fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(path.join(output,'apply.psql'),'-- Source only. Exact disposable QA approval and all three markers required; no connection supplied.\n\\set ON_ERROR_STOP on\nBEGIN;\n'+files.map(f=>'\\ir '+f.name).join('\n')+'\nCOMMIT;\n');return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log('Wrote '+writeLoginBootstrap(path.join(here,'login-bundle')).files.length+' SQL files; no DB/Auth/key/provider action.');
