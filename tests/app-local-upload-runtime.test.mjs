import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
const root=process.cwd(),scope='v3:'+'a'.repeat(64),otherScope='v3:'+'b'.repeat(64),viewer='00000000-0000-4000-8000-000000000001',salon='00000000-0000-4000-8000-000000000002',caseId='00000000-0000-4000-8000-000000000003',runId='00000000-0000-4000-8000-000000000004',staffId='00000000-0000-4000-8000-000000000005';
const actions={support:'action.8bf63c94a49e4c5fa9fe2817',payroll:'action.54072c2407a11cc75bd91fe7',tax:'action.805ee4ab28a6954dd0389212',creative:'action.ee11d447d1154d3e1ff376fb',posGroup:'action.0b1e0a58e14816ae5b2c1e9a',posSettings:'action.0eda261451682b1c1ea01f54'};
const plugin={name:'isolated-original-upload-authority',setup(builder){
 const fixtures={
  'server-only':'',
  '@/lib/request-business-context':'export async function getRequestBusinessContext(){return F.context}',
  '@/lib/experience-context':'export function getExperienceContext(c){return {scope:c.scope}}',
  '@/lib/current-context':'export async function getCurrentBusinessContext(){return F.context}export function isSalonManageContext(c){return c.workspaceType==="salon"&&c.salonMode==="manage"}export function isOwnerMembership(m){return m?.role==="owner"}',
  '@/lib/supabase/server':'export async function createAuthenticatedSupabaseServerClient(){return F.authClient}',
  '@/lib/permissions':'export async function hasPermission(name){return F.permissions.has(name)}',
  '@/lib/support-server':'export function supportServiceClient(){return F.service}',
  '@/lib/guest-support':'export async function getGuestSupport(id){if(!F.guestAllowed)throw Error("Guest denied");return {id:F.caseId,attachments:[]}}export async function requireGuestSupport(){if(!F.guestAllowed)throw Error("Guest denied")}',
  '@/lib/platform-admin/auth':'export async function requirePlatformAdmin(){if(!F.adminWrite)throw Error("Admin write denied")}',
  '@/lib/platform-admin/permissions':'export const PLATFORM_ADMIN_PERMISSIONS={reportsUpdate:"admin.reports.update"}',
  '@/lib/payroll':'export async function uploadPayrollPaystub(input){F.originalPaystub.push(input);if(F.originalPaystubError)throw Error(F.originalPaystubError);return {id:"saved"}} export async function markPayrollStatementPaid(){throw Error("not allowed in fixture")}export const savePayrollStatementFromLivePayroll=markPayrollStatementPaid,updatePayrollPeriodStaffInput=markPayrollStatementPaid,updateSalonPayrollSetting=markPayrollStatementPaid,updateStaffPayrollSetting=markPayrollStatementPaid;',
  '@/lib/tax-company':'export async function taxCompanyClient(){return {client:F.authClient,context:F.context}}',
  '@/lib/market-plugins':'export async function marketPluginContext(){return {client:F.authClient,salonId:F.context.currentSalon.id}}',
  '@/lib/auth-routing':'export function sanitizeAuthReturnPath(x){return x}',
  '@/lib/explore-advertising':'export function advertisingClient(){return F.service}',
  '@/lib/pos-tickets':'export const POS_TICKET_PERMISSIONS={manage:"tickets.manage"}',
  '@/lib/pos-settings':'export const POS_DISPLAY_MEDIA_BUCKET="pos-display-media",POS_SETTING_DEFAULTS={appDownloadUrl:"https://reylumi.com",largeTurnThreshold:25,tipSuggestions:[10,15,18,20],customerLeftAdText:"",customerRightAdText:"",customerPromoTitle:"",customerPromoBody:""}',
  '@/lib/pos-portable-access':'export const PORTABLE_POS_ACCESS_SETUP_MESSAGE="setup required"',
  'next/cache':'export function revalidatePath(path){F.revalidated.push(path)}',
  'next/navigation':'export function redirect(path){throw Object.assign(Error("redirect"),{digest:"NEXT_REDIRECT;replace;"+path+";307;"})}',
 };
 // Keep actual original Support and Payroll/Tax action wrappers in the fixture.
 builder.onResolve({filter:/.*/},args=>{
  const target=args.path.startsWith('./')&&args.importer.endsWith('app-local-upload-server.ts')?'@/lib/'+args.path.slice(2):args.path;
  return Object.hasOwn(fixtures,target)?{path:target,namespace:'fixture'}:undefined;
 });
 builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:'const F=globalThis.__uploadFixture;\n'+fixtures[args.path],resolveDir:root}));
}};
const built=await build({entryPoints:[path.join(root,'lib/app-local-upload-server.ts')],bundle:true,write:false,format:'esm',platform:'node',external:['sharp'],plugins:[plugin]});
async function fixture(){
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';
 const F={caseId,context:{scope,user:{id:viewer,status:'active'},workspaceType:'salon',salonMode:'manage',currentAccount:{id:viewer,status:'active'},currentSalon:{id:salon,status:'active'},currentMembership:{role:'owner'}},permissions:new Set(['payroll.manage','tickets.manage']),guestAllowed:true,adminRead:false,adminWrite:true,runStatus:'printed',lineExists:true,taxAllowed:true,campaignInstalled:true,rows:new Map(),creativeRows:new Map(),posWrites:[],stages:new Map(),finalObjects:new Map(),originalPaystub:[],originalPaystubError:null,revalidated:[],attachments:[],downloads:0,removed:[],claimCount:0};
 function query(table){const q={filters:[],change:null,upsertValue:null,selection:false,limitCount:Infinity,select(){q.selection=true;return q},eq(k,v){q.filters.push(r=>r[k]===v);return q},is(k,v){return q.eq(k,v)},lt(k,v){q.filters.push(r=>r[k]<v);return q},order(){return q},limit(n){q.limitCount=n;return q},update(value){q.change=value;return q},upsert(value){q.upsertValue=value;return q},async single(){return q.maybeSingle()},async maybeSingle(){const x=await q;return {data:x.data[0]??null,error:null}},then(resolve,reject){try{let rows;if(table==='app_local_upload_sessions')rows=[...F.rows.values()];else if(table==='payroll_runs')rows=[{id:runId,salon_id:salon,status:F.runStatus}];else if(table==='payroll_staff_lines')rows=F.lineExists?[{id:staffId,staff_id:staffId,salon_id:salon,payroll_run_id:runId}]:[];else if(table==='owner_campaign_creatives'){if(q.upsertValue&&!F.creativeRows.has(q.upsertValue.id))F.creativeRows.set(q.upsertValue.id,q.upsertValue);rows=[...F.creativeRows.values()];}else if(table==='pos_settings'){if(q.upsertValue)F.posWrites.push(q.upsertValue);rows=[F.posSnapshot??{}]}else throw Error('Unexpected table '+table);rows=rows.filter(r=>q.filters.every(f=>f(r))).slice(0,q.limitCount);if(q.change)for(const r of rows)Object.assign(r,q.change);return Promise.resolve({data:structuredClone(rows),error:null}).then(resolve,reject)}catch(error){return Promise.reject(error).then(resolve,reject)}}};return q;}
 F.authClient={from:query,async rpc(name,args){if(name==='get_support_conversation')return {data:{id:caseId,admin_view:F.adminRead},error:null};if(name==='tax_company_scope')return {data:F.taxAllowed?{salon:{id:salon},account:{id:viewer}}:null,error:null};if(name==='save_pos_workspace_settings'){F.posWrites.push(args);return {data:F.posSnapshot??args.p_values,error:F.posConflict?{message:'These settings changed elsewhere'}:null}}if(name==='add_support_case_attachment'){F.attachments.push(args);return {data:null,error:null}}throw Error('Unexpected auth RPC '+name)}};
 F.service={from:query,async rpc(name,args){if(name==='campaign_plugin_installed')return {data:F.campaignInstalled,error:null};if(name==='prepare_app_local_upload'){const row={id:args.p_id,actor_key:args.p_actor,scope:args.p_scope,action_name:args.p_action,target:args.p_target,file_name:args.p_file_name,mime_type:args.p_mime,size_bytes:args.p_size,file_sha256:args.p_sha256,object_path:'v1/'+args.p_id,file_manifest:args.p_files.map((f,index)=>({...f,object_path:'v1/'+args.p_id+(index?'/'+index:'')})),status:'pending',result:null,expires_at:new Date(Date.now()+600000).toISOString(),cleanup_after:new Date(Date.now()+7800000).toISOString(),cleaned_at:null};F.rows.set(row.id,row);return {data:structuredClone(row),error:null}}
 if(name==='claim_app_local_upload'){const row=F.rows.get(args.p_id);if(!row||row.actor_key!==args.p_actor||row.scope!==args.p_scope||row.status!=='pending'||Date.parse(row.expires_at)<=Date.now())return {data:[],error:null};row.status='processing';F.claimCount++;return {data:[structuredClone(row)],error:null}}
 if(name==='add_guest_support_attachment'){F.attachments.push(args);return {data:null,error:null}}throw Error('Unexpected service RPC '+name)},storage:{from(bucket){assert.ok(['app-local-upload-stage','support-evidence','campaign-creatives','pos-display-media'].includes(bucket));return {async createSignedUploadUrl(object,options){assert.equal(bucket,'app-local-upload-stage');assert.deepEqual(options,{upsert:false});return {data:{signedUrl:`https://fixture.supabase.co/storage/v1/object/upload/sign/${bucket}/${object}?token=fixture-signed`},error:null}},async download(object){F.downloads++;if(F.beforeDownload)await F.beforeDownload();return {data:F.stages.get(object)??null,error:null}},async upload(object,bytes,options){F.finalObjects.set(object,{bytes,options,bucket});return {error:null}},async remove(objects){for(const object of objects){F.removed.push(object);F.stages.delete(object);F.finalObjects.delete(object)}return {error:null}}}}}};
 F.authClient.storage=F.service.storage;
 globalThis.__uploadFixture=F;
 const sharpURL=new URL('../node_modules/sharp/lib/index.js',import.meta.url).href;
 const M=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text.replace('from "sharp"','from '+JSON.stringify(sharpURL))+'\n//'+crypto.randomUUID()).toString('base64'));
 async function prepare(kind='support',{size=30,type='application/pdf',fields,...extra}={}){const bytes=Buffer.alloc(size,32);bytes.write('%PDF-');const target=fields??(kind==='support'?{caseId}:kind==='tax'?{payroll_run_id:runId,staff_id:staffId,tax_salon_id:salon}:{payroll_run_id:runId,staff_id:staffId,return_to:'/payroll?period=2026-10'});const output=await M.runAppLocalUploadCommand('upload.prepare',{action:actions[kind],fields:target,file:{name:'proof.pdf',type,size,sha256:crypto.createHash('sha256').update(bytes).digest('hex')},...extra},scope);const row=F.rows.get(output.data.sessionId);F.stages.set(row.object_path,new Blob([bytes],{type}));return {row,bytes,output};}
 return {F,M,prepare};
}
const posKeys=['customer_background_image_file','customer_left_ad_image_file','customer_right_ad_image_file'];
async function stageImages(F,M,kind,sizes=[128]){
 const sharp=(await import('sharp')).default,png=await sharp({create:{width:1,height:1,channels:4,background:{r:1,g:80,b:80,alpha:1}}}).png().toBuffer();
 const files=sizes.map((size,index)=>{const bytes=Buffer.alloc(Math.max(size,png.length));png.copy(bytes);return {bytes,key:kind==='creative'?'image':posKeys[index],name:'image-'+index+'.png',type:'image/png',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
 const fields=kind==='creative'?{id:staffId,title:'A complete real ad',caption:'A normal message\nwith a second line'}:{group:'display',expected:JSON.stringify({customer_promo_title:'Old'}),customer_promo_title:'New',customer_promo_body:'A first line\nA second line',customer_show_salon_name:'on',current_customer_left_ad_image_path:'previous-left'};
 const descriptors=files.map(({bytes,...file})=>{void bytes;return file});
 const {key,...single}=descriptors[0];void key;
 const output=await M.runAppLocalUploadCommand('upload.prepare',{action:actions[kind],fields,...(kind==='creative'?{file:single}:{files:descriptors})},scope),row=F.rows.get(output.data.sessionId);
 for(const [index,file]of row.file_manifest.entries())F.stages.set(file.object_path,new Blob([files[index].bytes],{type:file.type}));
 return {row,files,fields,output};
}
test('actual Creative original decodes5MiB image with sharp and preserves original idempotent creative target',async()=>{
 const {F,M}=await fixture(),{row}=await stageImages(F,M,'creative',[5*1024*1024]);
 const result=await M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope);
 assert.equal(result.data.value.ok,true);assert.equal(result.data.value.target.sourceId,staffId);assert.equal(F.creativeRows.size,1);assert.equal(F.creativeRows.get(staffId).caption,'A normal message\nwith a second line');assert.equal([...F.finalObjects.values()][0].bucket,'campaign-creatives');assert.equal([...F.finalObjects.values()][0].options.contentType,'image/webp');
 const savedKeys=[...F.finalObjects.keys()].sort();assert.equal(savedKeys.length,3);assert.equal([...F.finalObjects.values()].every(x=>x.bucket==='campaign-creatives'&&x.options.contentType==='image/webp'),true);
 await M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope);assert.equal(F.creativeRows.size,1);assert.deepEqual([...F.finalObjects.keys()].sort(),savedKeys);assert.equal(F.claimCount,1);
});
test('actual POS original group gets three15MiB files once, exact expected snapshot and all existing display fields',async()=>{
 const {F,M}=await fixture(),{row,fields,output}=await stageImages(F,M,'posGroup',[15*1024*1024,15*1024*1024,15*1024*1024]);
 assert.equal(output.data.files.length,3);assert.equal(new Set(output.data.files.map(x=>x.uploadUrl)).size,3);
 const result=await M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope);assert.equal(result.data.value.ok,true);assert.equal(F.posWrites.length,1);assert.deepEqual(F.posWrites[0].p_expected,JSON.parse(fields.expected));assert.equal(F.posWrites[0].p_values.customer_promo_body,fields.customer_promo_body);assert.equal(F.posWrites[0].p_values.customer_show_salon_name,true);assert.equal(F.finalObjects.size,3);assert.equal([...F.finalObjects.values()].every(x=>x.bucket==='pos-display-media'&&x.bytes.length===15*1024*1024),true);assert.equal(F.stages.size,0);
 await M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope);assert.equal(F.posWrites.length,1);
});
test('POS original CAS conflict and legacy redirect remain original results; missing final file never begins a settings write',async()=>{
 const one=await fixture(),{row}=await stageImages(one.F,one.M,'posGroup',[128,128]);one.F.posConflict=true;one.F.posSnapshot={salon_id:salon,customer_promo_title:'Changed elsewhere'};const conflict=await one.M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope);assert.equal(conflict.data.value.ok,false);assert.deepEqual(conflict.data.value.conflict,one.F.posSnapshot);assert.equal(one.F.posWrites.length,1);
 const two=await fixture(),legacy=await stageImages(two.F,two.M,'posSettings');const result=await two.M.runAppLocalUploadCommand('upload.finalize',{sessionId:legacy.row.id},scope);assert.equal(result.data.redirect,'/pos/settings?saved=pos-settings');assert.equal(two.F.posWrites.length,1);
 const three=await fixture(),missing=await stageImages(three.F,three.M,'posGroup',[128,128,128]);three.F.stages.delete(missing.row.file_manifest[2].object_path);await assert.rejects(three.M.runAppLocalUploadCommand('upload.finalize',{sessionId:missing.row.id},scope));assert.equal(three.F.posWrites.length,0);assert.equal(three.F.finalObjects.size,0);assert.equal(three.F.stages.size,0);
});
test('Creative owner/install and POS manage rights revalidate; image bounds and duplicate fields fail before signing',async()=>{
 for(const kind of ['owner','plugin','pos']){const {F,M}=await fixture();if(kind==='owner')F.context.currentMembership.role='staff';if(kind==='plugin')F.campaignInstalled=false;if(kind==='pos')F.permissions.delete('tickets.manage');await assert.rejects(stageImages(F,M,kind==='pos'?'posGroup':'creative'));assert.equal(F.rows.size,0);}
 const {F,M}=await fixture();await assert.rejects(stageImages(F,M,'creative',[5*1024*1024+1]));await assert.rejects(stageImages(F,M,'posGroup',[15*1024*1024+1]));assert.equal(F.rows.size,0);
});
test('actual Support handler receives original5MiB File only after private stage integrity and attachment guards',async()=>{
 const {F,M,prepare}=await fixture(),{row,bytes,output}=await prepare('support',{size:5*1024*1024});
 assert.equal(new URL(output.data.uploadUrl).pathname,`/storage/v1/object/upload/sign/app-local-upload-stage/v1/${row.id}`);
 const result=await M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope);
 assert.deepEqual(result,{handled:true,data:{}});assert.equal(F.attachments.length,1);assert.equal(F.finalObjects.size,1);assert.equal([...F.finalObjects.values()][0].bytes.length,bytes.length);assert.equal(row.status,'succeeded');assert.equal(F.stages.size,0);
 await M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope);assert.equal(F.attachments.length,1);assert.equal(F.claimCount,1);
});
test('real Payroll and Tax wrappers preserve10MiB File, identifiers and original redirect result',async()=>{
 for(const kind of ['payroll','tax']){const {F,M,prepare}=await fixture(),{row}=await prepare(kind,{size:10*1024*1024});const result=await M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope);assert.equal(F.originalPaystub.length,1);const input=F.originalPaystub[0];assert.equal(input.file.size,10*1024*1024);assert.equal(input.payrollRunId,runId);assert.equal(input.staffId,staffId);assert.equal(input.taxSalonId,kind==='tax'?salon:undefined);assert.equal(result.data.redirect,kind==='tax'?`/tax-company/${salon}?run=${runId}`:'/payroll?period=2026-10');}
});
test('preparation rejects invalid action, oversized/types and fresh wrong-salon/staff/role/connection target before signing',async()=>{
 for(const kind of ['role','staff','run','tax','scope','extra']){const {F,M,prepare}=await fixture();if(kind==='role')F.permissions.clear();if(kind==='staff')F.lineExists=false;if(kind==='run')F.runStatus='draft';if(kind==='tax')F.taxAllowed=false;await assert.rejects(kind==='scope'?M.runAppLocalUploadCommand('upload.prepare',{action:actions.support,fields:{caseId},file:{name:'x.pdf',type:'application/pdf',size:1,sha256:'a'.repeat(64)}},otherScope):prepare(kind==='tax'?'tax':'payroll',kind==='extra'?{arbitraryURL:'https://evil.invalid'}:{}));assert.equal(F.rows.size,0,kind);assert.equal(F.originalPaystub.length,0);}
 const {F,prepare}=await fixture();await assert.rejects(prepare('support',{size:5*1024*1024+1}));await assert.rejects(prepare('payroll',{type:'text/html'}));assert.equal(F.rows.size,0);
});
test('fresh revoked rights, changed viewer/scope and invalid bytes never reach original handler',async()=>{
 for(const kind of ['permission','viewer','scope','hash','mime','expiry']){const {F,M,prepare}=await fixture(),{row}=await prepare('payroll');if(kind==='permission')F.permissions.clear();if(kind==='viewer')F.context.user.id=staffId;if(kind==='scope')F.context.scope=otherScope;if(kind==='hash')F.stages.set(row.object_path,new Blob(['%PDF-wrong'],{type:'application/pdf'}));if(kind==='mime')F.stages.set(row.object_path,new Blob(['%PDF-'+''.padEnd(row.size_bytes-5)],{type:'image/png'}));if(kind==='expiry')row.expires_at=new Date(Date.now()-1).toISOString();await assert.rejects(M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope));assert.equal(F.originalPaystub.length,0,kind);}
});
test('concurrent finalize claims once and uncertain original completion is never executed again',async()=>{
 const {F,M,prepare}=await fixture(),{row}=await prepare();let release;F.beforeDownload=()=>new Promise(r=>{release=r});
 const first=M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope);while(!release)await new Promise(r=>setTimeout(r,1));await assert.rejects(M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope));release();await first;assert.equal(F.attachments.length,1);assert.equal(F.claimCount,1);
 const second=await prepare();F.beforeDownload=null;F.authClient.rpc=async(name)=>{if(name==='get_support_conversation')return {data:{id:caseId},error:null};if(name==='add_support_case_attachment'){F.attachments.push('committed-but-response-lost');throw Error('response lost')}throw Error(name)};
 await assert.rejects(M.runAppLocalUploadCommand('upload.finalize',{sessionId:second.row.id},scope));assert.equal(second.row.status,'uncertain');await assert.rejects(M.runAppLocalUploadCommand('upload.finalize',{sessionId:second.row.id},scope));assert.equal(F.attachments.filter(x=>x==='committed-but-response-lost').length,1);assert.equal((await M.runAppLocalUploadCommand('upload.status',{sessionId:second.row.id},scope)).data.status,'uncertain');
});
test('guest cookie/admin write checks remain separate and stage cleanup does not delete final files',async()=>{
 const {F,M,prepare}=await fixture();F.context.user=null;const {row}=await prepare('support',{fields:{caseId,guestThreadId:staffId}});assert.equal(row.actor_key,'guest:'+staffId);F.guestAllowed=false;await assert.rejects(M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope));F.guestAllowed=true;await M.runAppLocalUploadCommand('upload.finalize',{sessionId:row.id},scope);assert.equal(F.attachments.length,1);
 row.cleanup_after=new Date(Date.now()-1).toISOString();F.stages.set(row.object_path,new Blob(['late old signed token put']));await M.cleanupAppLocalUploadStages();assert.equal(F.stages.size,0);assert.equal(F.finalObjects.size,1);assert.ok(row.cleaned_at);
 const other=await fixture();other.F.adminRead=true;other.F.adminWrite=false;await assert.rejects(other.prepare());assert.equal(other.F.rows.size,0);
});
test('actual SQL denies browser roles, atomically claims once, retains terminal state and bounds per-actor storage',async()=>{
 const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
 await db.exec(await fs.readFile(path.join(root,'supabase/migrations/20261016170000_app_local_upload_sessions.sql'),'utf8'));
 assert.equal((await db.query("select has_table_privilege('anon','public.app_local_upload_sessions','select') a,has_table_privilege('authenticated','public.app_local_upload_sessions','insert') b,has_function_privilege('authenticated','public.claim_app_local_upload(uuid,text,text)','execute') c")).rows.some(r=>r.a||r.b||r.c),false);
 const values=[crypto.randomUUID(),'user:'+viewer,scope,actions.support,JSON.stringify({caseId}),'proof.pdf','application/pdf',100,'a'.repeat(64)];
 const prepared=await db.query('select * from public.prepare_app_local_upload($1,$2,$3,$4,$5,$6,$7,$8,$9)',values);assert.equal(prepared.rows[0].status,'pending');
 const claim1=await db.query('select * from public.claim_app_local_upload($1,$2,$3)',values.slice(0,3));assert.equal(claim1.rows.length,1);const claim2=await db.query('select * from public.claim_app_local_upload($1,$2,$3)',values.slice(0,3));assert.equal(claim2.rows.length,0);
 for(let i=0;i<4;i++)await db.query('select * from public.prepare_app_local_upload($1,$2,$3,$4,$5,$6,$7,$8,$9)',[crypto.randomUUID(),...values.slice(1)]);
 await assert.rejects(db.query('select * from public.prepare_app_local_upload($1,$2,$3,$4,$5,$6,$7,$8,$9)',[crypto.randomUUID(),...values.slice(1)]),/finish/);
 await assert.rejects(db.query('select * from public.prepare_app_local_upload($1,$2,$3,$4,$5,$6,$7,$8,$9)',[crypto.randomUUID(),'user:'+staffId,...values.slice(2,7),5242881,values[8]]),/5 MB/);
 const posFiles=posKeys.map(key=>({key,name:'image.png',type:'image/png',size:15728640,sha256:'b'.repeat(64)})),posId=crypto.randomUUID();
 const posValues=[posId,'user:'+staffId,scope,actions.posGroup,JSON.stringify({group:'display',expected:'{}'}),'image.png','image/png',15728640,'b'.repeat(64),JSON.stringify(posFiles)];
 const pos=await db.query('select * from public.prepare_app_local_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',posValues);assert.equal(pos.rows[0].file_manifest.length,3);assert.deepEqual(pos.rows[0].file_manifest.map(f=>f.object_path),['v1/'+posId,'v1/'+posId+'/1','v1/'+posId+'/2']);
 await assert.rejects(db.query('select * from public.prepare_app_local_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[crypto.randomUUID(),...posValues.slice(1,9),JSON.stringify([posFiles[0],posFiles[0]])]),/Duplicate/);
 await assert.rejects(db.query('select * from public.prepare_app_local_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[crypto.randomUUID(),...posValues.slice(1,9),JSON.stringify([{...posFiles[0],key:'arbitrary_file'}])]),/Invalid/);
 await db.exec('set role authenticated');await assert.rejects(db.query('select * from public.app_local_upload_sessions'),/permission denied/);
 }finally{await db.close()}
});
