import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { build } from 'esbuild';
const root=process.cwd(),scope='v3:'+'a'.repeat(64),id='00000000-0000-4000-8000-000000000001',caseId='00000000-0000-4000-8000-000000000002';
const actions={support:'action.8bf63c94a49e4c5fa9fe2817',payroll:'action.54072c2407a11cc75bd91fe7',tax:'action.805ee4ab28a6954dd0389212',creative:'action.ee11d447d1154d3e1ff376fb',posGroup:'action.0b1e0a58e14816ae5b2c1e9a',posSettings:'action.0eda261451682b1c1ea01f54'};
const built=await build({entryPoints:[path.join(root,'lib/app-local-upload-client.ts')],bundle:true,write:false,format:'esm',platform:'node',define:{'process.env.NEXT_PUBLIC_SUPABASE_URL':'"https://fixture.supabase.co"'},plugins:[{name:'fixture-named-host',setup(b){b.onResolve({filter:/app-local-host$/},()=>({path:'host',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export function getAppLocalHost(){return globalThis.__uploadClientFixture.host}',loader:'js'}));}}]});
async function fixture(){
 const window=new EventTarget();window.__reylumiAppLocalContext={generation:crypto.randomUUID(),scopeEpoch:1,nonce:crypto.randomUUID()};globalThis.window=window;
 const F={commands:[],uploads:[],putStatus:200,finalizeError:false,status:'succeeded',result:{redirect:'/payroll?period=2026-10'},prepared:{sessionId:id,uploadUrl:`https://fixture.supabase.co/storage/v1/object/upload/sign/app-local-upload-stage/v1/${id}?token=public-signed-upload`,expiresAt:Date.now()+600000}};
 F.host={async command(name,args,options){F.commands.push({name,args,options});if(name==='upload.prepare'){if(args.files&&!F.prepared.files)F.prepared.files=args.files.map((file,index)=>({key:file.key,uploadUrl:F.prepared.uploadUrl.replace('?token=',(index?'/'+index:'')+'?token=')}));return F.prepared}if(name==='upload.finalize'){if(F.finalizeError)throw Error('lost response');return F.result}if(name==='upload.status')return {status:F.status,result:F.status==='succeeded'?F.result:undefined};if(name==='upload.cancel')return {cancelled:true};throw Error(name)}};
 globalThis.__uploadClientFixture=F;
 const previousFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{F.uploads.push({url,options});if(F.heldUpload)return await F.heldUpload(options);return new Response('{}',{status:F.putStatus})};
 const M=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//'+crypto.randomUUID()).toString('base64'));
 function form(kind='support',size=30){const f=new FormData();f.set(kind==='support'?'file':'paystub_file',new File(['%PDF-',new Uint8Array(size-5)],'proof.pdf',{type:'application/pdf'}));if(kind==='support')f.set('caseId',caseId);else{f.set('payroll_run_id',id);f.set('staff_id',caseId);if(kind==='tax')f.set('tax_salon_id',id);else f.set('return_to','/payroll?period=2026-10')}return f;}
 return {F,M,form,window,cleanup(){globalThis.fetch=previousFetch;delete globalThis.window;delete globalThis.__uploadClientFixture;}};
}
test('5MiB Support and10MiB Payroll/Tax go directly to pinned storage once; no File/base64 enters command codec',async()=>{
 for(const kind of ['support','payroll','tax']){const {F,M,form,cleanup}=await fixture();try{
 const size=kind==='support'?5*1024*1024:10*1024*1024,result=await M.handlesAppLocalFileCommand(actions[kind],[form(kind,size)],scope);assert.deepEqual(result,{handled:true,...F.result});assert.deepEqual(F.commands.map(x=>x.name),['upload.prepare','upload.finalize']);assert.equal(F.commands[0].args.file.size,size);assert.match(F.commands[0].args.file.sha256,/^[a-f0-9]{64}$/);assert.ok(JSON.stringify(F.commands).length<1500);assert.equal(F.uploads.length,1);const request=F.uploads[0].options;assert.equal(request.method,'PUT');assert.equal(request.credentials,'omit');assert.equal(request.redirect,'error');assert.equal(request.headers['x-upsert'],'false');assert.equal(request.body.get('').size,size);assert.equal(request.body.get('').type,'application/pdf');
 }finally{cleanup()}}
});
test('unrelated actions are untouched and invalid/oversized Files reject before preparation',async()=>{
 const {F,M,form,cleanup}=await fixture();try{assert.deepEqual(await M.handlesAppLocalFileCommand('action.unrelated',[form()],scope),{handled:false});await assert.rejects(M.handlesAppLocalFileCommand(actions.support,[form('support',5*1024*1024+1)],scope));const f=form();f.set('file',new File(['html'],'x.html',{type:'text/html'}));await assert.rejects(M.handlesAppLocalFileCommand(actions.support,[f],scope));assert.equal(F.commands.length,0);assert.equal(F.uploads.length,0);}finally{cleanup()}
});
test('arbitrary host/path/token/deployment URLs never receive File bytes',async()=>{
 for(const url of ['https://evil.invalid/stage','https://fixture.supabase.co/storage/v1/object/upload/sign/other/v1/'+id+'?token=x','https://fixture.supabase.co/storage/v1/object/upload/sign/app-local-upload-stage/v1/'+id+'?token=x&token=y']){const {F,M,form,cleanup}=await fixture();try{F.prepared.uploadUrl=url;await assert.rejects(M.handlesAppLocalFileCommand(actions.support,[form()],scope));assert.equal(F.uploads.length,0);assert.equal(F.commands.filter(x=>x.name==='upload.finalize').length,0);}finally{cleanup()}}
});
test('same in-flight form deduplicates and a failed PUT only cancels its pending stage',async()=>{
 const {F,M,form,cleanup}=await fixture();try{
 let release;F.heldUpload=()=>new Promise(r=>release=r);const f=form(),a=M.handlesAppLocalFileCommand(actions.support,[f],scope),b=M.handlesAppLocalFileCommand(actions.support,[f],scope);while(!release)await new Promise(r=>setTimeout(r,1));release(new Response('{}'));assert.deepEqual(await a,await b);assert.equal(F.commands.filter(x=>x.name==='upload.prepare').length,1);assert.equal(F.commands.filter(x=>x.name==='upload.finalize').length,1);assert.equal(F.uploads.length,1);
 F.heldUpload=null;F.putStatus=503;await assert.rejects(M.handlesAppLocalFileCommand(actions.support,[form()],scope));assert.equal(F.commands.filter(x=>x.name==='upload.finalize').length,1);assert.equal(F.commands.filter(x=>x.name==='upload.cancel').length,1);
 }finally{cleanup()}
});
test('lost finalization response uses one status read and never resends original/finalize',async()=>{
 for(const status of ['succeeded','processing','uncertain']){const {F,M,form,cleanup}=await fixture();try{F.finalizeError=true;F.status=status;const result=M.handlesAppLocalFileCommand(actions.payroll,[form('payroll')],scope);if(status==='succeeded')assert.deepEqual(await result,{handled:true,...F.result});else await assert.rejects(result,/Check the current record/);assert.deepEqual(F.commands.map(x=>x.name),['upload.prepare','upload.finalize','upload.status']);assert.equal(F.uploads.length,1);}finally{cleanup()}}
});
test('account reset aborts an in-flight stage without committing or replaying on reveal',async()=>{
 const {F,M,form,window,cleanup}=await fixture();try{let started;const ready=new Promise(r=>started=r);F.heldUpload=({signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})});const sent=M.handlesAppLocalFileCommand(actions.support,[form()],scope);await ready;window.__reylumiAppLocalContext.generation=crypto.randomUUID();window.dispatchEvent(new Event('reylumi:app-local-reset'));await assert.rejects(sent);assert.equal(F.commands.filter(x=>x.name==='upload.finalize').length,0);assert.equal(F.commands.filter(x=>x.name==='upload.cancel').length,1);assert.equal(F.uploads.length,1);}finally{cleanup()}
});
test('optional POS forms without files use ordinary command path; three15MiB files transfer sequentially then finalize once',async()=>{
 const {F,M,cleanup}=await fixture();try{
 const f=new FormData();f.set('group','display');f.set('expected','{"customer_promo_title":"Old"}');f.set('customer_promo_title','New');
 assert.deepEqual(await M.handlesAppLocalFileCommand(actions.posGroup,[f],scope),{handled:false});assert.equal(F.commands.length,0);
 for(const key of ['customer_background_image_file','customer_left_ad_image_file','customer_right_ad_image_file'])f.set(key,new File([new Uint8Array(15*1024*1024)],key+'.png',{type:'image/png'}));
 let concurrent=0,maximum=0;F.heldUpload=async()=>{concurrent++;maximum=Math.max(maximum,concurrent);await new Promise(r=>setTimeout(r,5));concurrent--;return new Response('{}')};
 await M.handlesAppLocalFileCommand(actions.posGroup,[f],scope);assert.equal(maximum,1);assert.equal(F.uploads.length,3);assert.equal(new Set(F.uploads.map(x=>x.url)).size,3);assert.deepEqual(F.commands.map(x=>x.name),['upload.prepare','upload.finalize']);assert.equal(F.commands[0].args.files.length,3);assert.equal(F.commands[0].args.fields.expected,'{"customer_promo_title":"Old"}');assert.ok(JSON.stringify(F.commands).length<2500);
 }finally{cleanup()}
});
test('creative and POS actual per-file limits reject PDF creative/oversize; wrong field-to-URL pairing never sends file bytes',async()=>{
 const {F,M,cleanup}=await fixture();try{const f=new FormData();f.set('id',id);f.set('title','Title');f.set('caption','Caption');f.set('image',new File(['%PDF-'],'wrong.pdf',{type:'application/pdf'}));await assert.rejects(M.handlesAppLocalFileCommand(actions.creative,[f],scope));f.set('image',new File([new Uint8Array(5*1024*1024)],'valid.png',{type:'image/png'}));await M.handlesAppLocalFileCommand(actions.creative,[f],scope);assert.equal(F.uploads.length,1);
 const p=new FormData();p.set('group','display');p.set('customer_left_ad_image_file',new File([new Uint8Array(15*1024*1024+1)],'big.png',{type:'image/png'}));await assert.rejects(M.handlesAppLocalFileCommand(actions.posGroup,[p],scope));p.set('customer_left_ad_image_file',new File(['image'],'small.png',{type:'image/png'}));F.prepared.files=[{key:'customer_background_image_file',uploadUrl:F.prepared.uploadUrl}];await assert.rejects(M.handlesAppLocalFileCommand(actions.posGroup,[p],scope));assert.equal(F.uploads.length,1);assert.equal(F.commands.filter(x=>x.name==='upload.finalize').length,1);
 }finally{cleanup()}
});
