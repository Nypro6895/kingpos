import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {securityBootstrapFiles} from './security-build.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const base='supabase/migrations/202607240001_account_salon_baseline.sql',life='supabase/migrations/202608210001_account_salon_lifecycle_foundation.sql',personal='supabase/migrations/202608210003_account_deletion_flow.sql',phase3='supabase/migrations/202608210006_account_lifecycle_phase3.sql';
const hash=x=>createHash('sha256').update(x).digest('hex'),normalize=x=>x.replaceAll('\r\n','\n').replace(/\n+$/,'\n');
const read=source=>fs.readFileSync(path.join(root,source));
export function contextSlice(source,start,ending){
 const raw=read(source),text=normalize(raw.toString()),at=text.indexOf(start);
 if(at<0||text.indexOf(start,at+start.length)>=0)throw Error('Missing/ambiguous context source anchor: '+source+' '+start);
 const tail=text.slice(at),match=tail.match(ending);if(!match||match.index===undefined)throw Error('Missing canonical statement end');
 const end=at+match.index+match[0].length,sql=normalize(text.slice(at,end));
 return {source,start,startLine:text.slice(0,at).split('\n').length,endLine:text.slice(0,end).split('\n').length,rawSha256:hash(raw),sliceSha256:hash(sql),sql};
}
const statement=(source,start)=>contextSlice(source,start,/;(?=\n|$)/);
const fn=(source,name)=>contextSlice(source,'create or replace function public.'+name+'(',/\n\$\$;/);
const table=(source,name,prefix='create table public.')=>contextSlice(source,prefix+name+' (',/\n\);/);
const policy=(source,name)=>statement(source,'create policy "'+name+'"');
const generated=(name,slices,extra='')=>{const sql=slices.map(s=>s.sql).join('\n')+extra;return {source:'explicit canonical context slices + declared QA restrictions',name,sql,executedSha256:hash(sql),provenance:slices.map(({sql:ignored,...p})=>{void ignored;return p;})};};
const file=(source,name)=>{const raw=read(source),sql=normalize(raw.toString());return {source,name,sql,rawSha256:hash(raw),executedSha256:hash(sql)};};
export function contextBootstrapFiles(){
 const tables=['users','accounts','locations','roles','permissions','role_permissions','account_memberships','salon_memberships','staff','salon_settings'];
 const definitions=[fn(base,'set_updated_at'),...tables.map(t=>table(base,t)),statement(life,'alter table public.users\n  add column if not exists deletion_requested_at'),statement(phase3,'alter table public.users\n  add column if not exists deletion_finalization_started_at'),table(phase3,'deleted_auth_identities','create table if not exists public.')];
 for(const t of tables.filter(t=>t!=='role_permissions'))definitions.push(statement(base,'create trigger set_'+t+'_updated_at'));
 const ownTables=`\n-- These three objects remain explicit synthetic Market review/finance/media fixtures.\nCREATE SCHEMA qa_bootstrap;REVOKE ALL ON SCHEMA qa_bootstrap FROM PUBLIC,anon,authenticated,service_role;\nCREATE TABLE qa_bootstrap.marker(id boolean PRIMARY KEY CHECK(id),scope text NOT NULL CHECK(scope='synthetic-canonical-context'));\nINSERT INTO qa_bootstrap.marker VALUES(true,'synthetic-canonical-context');\nCREATE SCHEMA market_private;REVOKE ALL ON SCHEMA market_private FROM PUBLIC,anon,authenticated,service_role;\nCREATE TABLE market_private.reviewers(user_id uuid PRIMARY KEY REFERENCES public.users(id),active boolean NOT NULL DEFAULT true);\nCREATE TABLE qa_bootstrap.financial_admins(user_id uuid PRIMARY KEY REFERENCES public.users(id));\nCREATE TABLE public.salon_profile_media_assets(id uuid PRIMARY KEY,salon_id uuid NOT NULL REFERENCES public.locations(id),bucket text,object_path text,purpose text,mime_type text,processed_bytes bigint,status text,deleted_at timestamptz,quarantined_at timestamptz);\n`;
 const helpers=[fn(base,'current_public_user_id'),fn(base,'user_belongs_to_account'),fn(base,'user_has_account_permission'),fn(phase3,'user_can_manage_salon'),fn(phase3,'user_has_salon_permission'),fn(phase3,'lifecycle_user_is_salon_owner'),fn(phase3,'auth_identity_is_deleted'),fn(base,'seed_default_roles_for_account'),fn(personal,'ensure_personal_account_for_current_user')];
 const finance=`\n-- Deny-by-default synthetic finance gate retained from original contract fixture.\nCREATE FUNCTION public.market_billing_require_admin() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,qa_bootstrap AS $$\nDECLARE actor uuid:=public.current_public_user_id();BEGIN IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM qa_bootstrap.financial_admins WHERE user_id=actor) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Separate financial administrator approval required';END IF;RETURN actor;END $$;\n`;
 const policies=['users_self_read','users_self_update','account_member_read_accounts','account_member_read_locations','account_member_read_roles','public_read_permissions','account_member_read_role_permissions','member_read_account_memberships','member_read_salon_memberships','salon_member_read_staff','salon_member_read_settings'].map(p=>policy(base,p));
 for(const p of ['salon_member_read_accounts','salon_member_read_locations_by_membership','salon_member_read_roles','salon_member_read_own_role_permissions','salon_member_read_account_memberships_for_salon_account'])policies.push(policy(phase3,p));
 const grants=`\n-- QA restricted column grants; canonical policy bodies above are unchanged.\n`+
  [...tables,'deleted_auth_identities','salon_profile_media_assets'].map(t=>'ALTER TABLE public.'+t+' ENABLE ROW LEVEL SECURITY;REVOKE ALL ON TABLE public.'+t+' FROM PUBLIC,anon,authenticated,service_role;').join('\n')+'\n'+
  ['users','accounts','locations','roles','account_memberships','salon_memberships'].map(t=>'GRANT SELECT ON public.'+t+' TO authenticated;').join('\n')+'\n'+
  'GRANT SELECT(id,code) ON public.permissions TO authenticated;GRANT SELECT(role_id,permission_id) ON public.role_permissions TO authenticated;\nGRANT SELECT(id,salon_id,account_user_id,is_active) ON public.staff TO authenticated;GRANT SELECT(salon_id,public_profile_logo_path) ON public.salon_settings TO authenticated;\nGRANT UPDATE(display_name,first_name,last_name,language,timezone) ON public.users TO authenticated;\n'+
  'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated,service_role;\n'+
  'GRANT EXECUTE ON FUNCTION public.current_public_user_id(),public.user_belongs_to_account(uuid),public.user_has_account_permission(uuid,text[]),public.user_can_manage_salon(uuid),public.user_has_salon_permission(uuid,text[]),public.auth_identity_is_deleted(uuid),public.ensure_personal_account_for_current_user(text) TO authenticated;\n';
 const previous=securityBootstrapFiles();
 const files=[file('examples/market-qa-bootstrap/context-preflight.sql','00-context-preflight.sql'),generated('01-context-tables.sql',definitions,ownTables),generated('02-context-helpers.sql',helpers,finance),generated('03-context-rls.sql',policies,grants)];
 for(const f of previous.slice(2,9))files.push({...f,name:String(files.length).padStart(2,'0')+'-'+path.basename(f.source)});
 files.push({...previous[9],name:'11-qr-storage.sql'},{...previous[10],name:'12-qr-role.sql'},file('examples/market-qa-bootstrap/context-fixtures.sql','13-context-fixtures.sql'),{...previous[13],name:'14-security-read-contract.sql'});
 return files;
}
export function writeContextBootstrap(output){
 const files=contextBootstrapFiles();fs.mkdirSync(output,{recursive:true});for(const f of files)fs.writeFileSync(path.join(output,f.name),f.sql);
 const manifest={scope:'Fresh synthetic canonical profile/current-context/lifecycle SQL subset; NOT full app shell/Auth/notification/abuse bootstrap',featureEnabled:false,financeEnabled:false,authAccountsCreated:0,canonicalRoutesChanged:false,profileWriteColumns:['display_name','first_name','last_name','language','timezone'],canonicalContextTables:10,canonicalHelpers:9,securityMutations:false,normalization:'LF/one final newline; seven Market SQL outer wrappers removed as declared in provenance',remaining:['Canonical signup/login/record_account_login_session/notifications/booking/abuse','Full profile phone/avatar/deletion/transfer workflows','App-layout subscriptions/queue/advertising/provider dependencies','Real GoTrue/PostgREST/HTTPS/Storage/SMS and managed PG'],files:files.map(({sql:ignored,...f})=>{void ignored;return f;})};
 const graph=contextGraph(files);fs.writeFileSync(path.join(output,'dependency-graph.json'),JSON.stringify(graph,null,2)+'\n');manifest.graphSha256=hash(JSON.stringify(graph,null,2)+'\n');
 fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(path.join(output,'apply.psql'),'-- Source review only; exact disposable QA approval/markers required. No connection supplied.\n\\set ON_ERROR_STOP on\nBEGIN;\n'+files.map(f=>'\\ir '+f.name).join('\n')+'\nCOMMIT;\n');return manifest;
}
export function contextGraph(files=contextBootstrapFiles()){
 const fragments=files.slice(1,4).flatMap(f=>f.provenance.map(p=>({...p,artifact:f.name}))),nodes=new Set(['users','accounts','locations','roles','permissions','role_permissions','account_memberships','salon_memberships','staff','salon_settings','deleted_auth_identities','set_updated_at','current_public_user_id','user_belongs_to_account','user_has_account_permission','user_can_manage_salon','user_has_salon_permission','lifecycle_user_is_salon_owner','auth_identity_is_deleted','seed_default_roles_for_account','ensure_personal_account_for_current_user']);
 const refs=[...new Set([...files.slice(1,4).map(f=>f.sql).join('\n').matchAll(/public\.([a-z_][a-z0-9_]*)/g)].map(m=>m[1]))].sort();
 const fixtureNodes=['salon_profile_media_assets','market_billing_require_admin'];
 return {scope:'Explicit selected canonical context graph only; not whole application closure',canonicalNodes:[...nodes].sort(),fixtureNodes,publicReferences:refs,unresolvedPublicReferences:refs.filter(r=>!nodes.has(r)&&!fixtureNodes.includes(r)),fragments,resolvers:['lib/users/current-user.ts','lib/current-context.ts','lib/membership-permissions.ts','lib/market-plugins.ts','lib/market-platform/owner.ts','app/market/developer-app-actions.ts'].map(source=>({source,rawSha256:hash(read(source))})),remaining:['Full profile actions including phone/avatar/deletion/transfer','Canonical Auth/recording/notifications/booking/abuse','Whole (app) layout subscription/queue/advertising reads','Real hosted/provider acceptance']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log('Wrote '+writeContextBootstrap(path.join(here,'context-bundle')).files.length+' context SQL files; no DB/provider connection.');
