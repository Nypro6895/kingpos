import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
const out=await build({entryPoints:['lib/account-erasure-worker.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':path.resolve('.')},plugins:[{name:'worker-imports',setup(api){api.onResolve({filter:/^(server-only|@supabase\/supabase-js|\.\/support-email)$/},a=>({path:a.path,namespace:'stub'}));api.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export function createClient(){} export function getSupportEmailConfig(){} export function sendSupportEmail(){}'}));}}]});
const {processAccountErasure}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
const job={userId:'user',authUserId:'auth',lease:'lease'};
function fixture({storageError=false,authError=null,finishError=false,disposition='purge'}={}){
 const calls=[];let done=false;
 const task={bucket_id:disposition==='purge'?'account-avatars':'payroll-paystubs',object_path:'user/file',disposition};
 const client={async rpc(name,args){calls.push({name,args});return name==='account_erasure_batch'?{data:done?[]:[task]}:name==='finish_account_erasure_object'?(done=true,{data:null}):name==='finish_account_erasure'&&args.p_error===null&&finishError?{error:{message:'not complete'}}:{data:null}},storage:{from(bucket){return{async remove(paths){calls.push({name:'remove',bucket,paths});return{error:storageError?{}:null}}}}},auth:{admin:{async deleteUser(id,soft){calls.push({name:'deleteUser',id,soft});return{error:authError}}}}};
 return {client,calls};
}
test('storage failure keeps authentication and does not mark deletion complete',async()=>{
 const {client,calls}=fixture({storageError:true});assert.equal(await processAccountErasure(client,job,Date.now()+10000),false);
 assert.equal(calls.some(c=>c.name==='deleteUser'),false);assert.equal(calls.at(-1).name,'finish_account_erasure');assert.ok(calls.at(-1).args.p_error);
});
test('hard auth deletion follows storage checkpoints; missing auth on retry is idempotent',async()=>{
 for(const authError of [null,{code:'user_not_found'}]){const {client,calls}=fixture({authError});assert.equal(await processAccountErasure(client,job,Date.now()+10000),true);const index=calls.findIndex(c=>c.name==='deleteUser');assert.ok(index>calls.findIndex(c=>c.name==='finish_account_erasure_object'));assert.equal(calls[index].soft,false);assert.equal(calls.at(-1).args.p_error,null);}
});
test('provider failure or final DB verification failure remains retryable',async()=>{
 for(const options of [{authError:{code:'unexpected_failure'}},{finishError:true}]){const {client,calls}=fixture(options);assert.equal(await processAccountErasure(client,job,Date.now()+10000),false);assert.ok(calls.at(-1).args.p_error);}
});
test('business files transfer through the storage API without a remove or changed path',async()=>{
 const previous=globalThis.fetch;let request;
 try{globalThis.fetch=async(url,options)=>{request={url,options};return new Response('{}',{status:200});};const {client,calls}=fixture({disposition:'retain_business'});assert.equal(await processAccountErasure(client,job,Date.now()+10000),true);const body=JSON.parse(request.options.body);assert.equal(body.sourceKey,body.destinationKey);assert.equal(body.bucketId,'payroll-paystubs');assert.equal(request.options.headers['x-upsert'],'true');assert.equal(calls.some(c=>c.name==='remove'),false);}finally{globalThis.fetch=previous;}
});
test('deadline stops destructive work and releases the job for retry',async()=>{
 const {client,calls}=fixture();assert.equal(await processAccountErasure(client,job,Date.now()-1),false);assert.equal(calls.some(c=>c.name==='remove'||c.name==='deleteUser'),false);assert.ok(calls.at(-1).args.p_error);
});
test('missing business objects tolerate both Storage missing-object responses, but not permission failures',async()=>{
 const previous=globalThis.fetch;
 try{
  for(const [body,expected] of [[{code:'NoSuchKey'},true],[{statusCode:'404'},true],[{code:'AccessDenied'},false]]){
   globalThis.fetch=async()=>new Response(JSON.stringify(body),{status:400});
   const {client,calls}=fixture({disposition:'retain_business'});
   assert.equal(await processAccountErasure(client,job,Date.now()+10000),expected);
   assert.equal(calls.some(c=>c.name==='deleteUser'),expected);
  }
 }finally{globalThis.fetch=previous;}
});
