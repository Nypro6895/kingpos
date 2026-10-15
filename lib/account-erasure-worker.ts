import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {getSupportEmailConfig,sendSupportEmail} from './support-email';

type Job={userId:string;authUserId:string|null;lease:string};
type ObjectTask={bucket_id:string;object_path:string;disposition:'purge'|'retain_business'};
const retainedBuckets=new Set(['salon-profile-media','pos-display-media','payroll-paystubs','support-evidence']);

export function accountErasureClient(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('Account erasure is not configured.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(25000)})}});
}
type Client=ReturnType<typeof accountErasureClient>;
async function rpc(client:Client,name:string,args:Record<string,unknown>={}){
 const result=await client.rpc(name,args);if(result.error)throw Error(`Account erasure step failed: ${name}`);return result.data;
}

// Supabase's copy API atomically replaces the object with a service-owned copy.
// Same path and bytes: no broken payroll links, no direct writes to storage metadata.
async function retainBusinessObject(task:ObjectTask){
 if(!retainedBuckets.has(task.bucket_id))throw Error('Unrecognized retained storage bucket.');
 const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/copy`,{
  method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,apikey:process.env.SUPABASE_SERVICE_ROLE_KEY!,'Content-Type':'application/json','x-upsert':'true'},
  body:JSON.stringify({bucketId:task.bucket_id,sourceKey:task.object_path,destinationKey:task.object_path,copyMetadata:true}),
  signal:AbortSignal.timeout(25000),cache:'no-store',
 });
 // An already-removed object is also safe; the DB checkpoint verifies absence/ownership.
 if(!response.ok&&response.status!==404){
  const error=await response.json().catch(()=>null) as {code?:string;statusCode?:string|number}|null;
  if(error?.code!=='NoSuchKey'&&Number(error?.statusCode)!==404)throw Error('Retained file ownership could not be transferred.');
 }
}

export async function processAccountErasure(client:Client,job:Job,deadline:number){
 const identity={p_user_id:job.userId,p_lease:job.lease};
 try{
  for(;;){
   const tasks=await rpc(client,'account_erasure_batch',identity) as ObjectTask[];
   if(!tasks.length)break;
   for(const task of tasks){
    if(Date.now()>deadline)throw Error('time_budget');
    if(task.disposition==='purge'){
     const {error}=await client.storage.from(task.bucket_id).remove([task.object_path]);
     if(error)throw Error('storage_unavailable');
    }else if(task.disposition==='retain_business')await retainBusinessObject(task);
    else throw Error('unknown_storage_action');
    await rpc(client,'finish_account_erasure_object',{...identity,p_bucket:task.bucket_id,p_path:task.object_path});
   }
  }
  if(Date.now()>deadline)throw Error('time_budget');
  if(job.authUserId){
   const {error}=await client.auth.admin.deleteUser(job.authUserId,false);
   if(error&&error.code!=='user_not_found')throw Error('authentication_unavailable');
  }
  // Checks auth.users and storage again. A redirect or API success alone is insufficient.
  await rpc(client,'finish_account_erasure',{...identity,p_error:null});
  return true;
 }catch{
  await rpc(client,'finish_account_erasure',{...identity,p_error:'erasure_retry_required'});
  return false;
 }
}

export async function runAccountErasures(){
 const client=accountErasureClient(),deadline=Date.now()+230000;let completed=0,failed=0;
 const due=await rpc(client,'finalize_due_account_deletions',{p_limit:10});
 failed+=Number(due?.skipped_count??0);
 for(let i=0;i<10&&Date.now()<deadline;i++){
  const job=await rpc(client,'claim_account_erasure') as Job|null;if(!job)break;
  if(await processAccountErasure(client,job,deadline))completed++;else failed++;
 }
 // The receipt is available even if delivery fails. Keep email only for retries,
 // for at most seven days after completion, then remove it from the queue.
 const {data:notifications,error}=await client.from('account_erasure_jobs').select('user_id,notification_email,completed_at')
  .eq('status','complete').is('notified_at',null).not('notification_email','is',null).limit(10);
 if(error)failed++;
 for(const job of notifications??[]){
  if(Date.now()>deadline)break;
  try{
   const expired=Date.now()-Date.parse(job.completed_at)>7*86400000;
   const result=expired?null:await sendSupportEmail(await getSupportEmailConfig(),{id:`account-erasure-${job.user_id}`,to:job.notification_email,name:'there',subject:'Your Reylumi account has been deleted',body:'Your account deletion is complete. Your sign-in identity, personal profile content and personal uploads have been removed. Required financial, payroll and security records remain under our retention policy. Your saved deletion receipt also shows completion.'});
   if(expired||result?.status==='sent'){
    const saved=await client.from('account_erasure_jobs').update({notification_email:null,...(!expired?{notified_at:new Date().toISOString()}:{})}).eq('user_id',job.user_id).eq('status','complete');
    if(saved.error)failed++;
   }else failed++;
  }catch{failed++;}
 }
 return {completed,failed};
}
