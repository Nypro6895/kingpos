// Foreground, resumable maintenance. Each RPC is a separate transaction.
// No scheduler, schema deployment or automatic activation is installed.
import {pathToFileURL} from 'node:url';

export const PREPARATION_RPCS={status:'get_explore_local_quality_preparation',batch:'prepare_explore_local_quality_batch',activate:'activate_explore_local_quality'};
export function parsePreparationOptions(args){
 const options={apply:false,activate:false,limit:50,maxBatches:1000,pauseMs:100};
 const numbers={'limit':['limit',1,100],'max-batches':['maxBatches',1,100000],'pause-ms':['pauseMs',50,5000]};
 for(const arg of args){
  if(arg==='--apply'){options.apply=true;continue;}
  if(arg==='--activate'){options.activate=true;continue;}
  const match=arg.match(/^--([a-z-]+)=(\d+)$/),spec=match&&numbers[match[1]];
  if(!spec)throw Error('Use --apply, --activate, --limit=1..100, --max-batches=1..100000 or --pause-ms=50..5000.');
  const n=Number(match[2]);if(n<spec[1]||n>spec[2])throw Error('Preparation option is outside its bounded range.');
  options[spec[0]]=n;
 }
 if(options.activate&&!options.apply)throw Error('--activate requires --apply.');
 return options;
}
function summary(value){
 if(!value||typeof value!=='object'||typeof value.ready!=='boolean'||typeof value.done!=='boolean')throw Error('Invalid preparation response.');
 const result={ready:value.ready,done:value.done};
 for(const key of ['busy','pending','scanComplete'])if(typeof value[key]==='boolean')result[key]=value[key];
 for(const key of ['scanned','processed','stale'])if(Number.isSafeInteger(value[key])&&value[key]>=0)result[key]=value[key];
 return result;
}
const pause=(ms,signal)=>new Promise(resolve=>{
 const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',finish);resolve();};
 const timer=setTimeout(finish,ms);signal?.addEventListener('abort',finish,{once:true});if(signal?.aborted)finish();
});
export async function runPreparation({rpc,options,signal,onProgress=()=>{},wait=pause}){
 signal?.throwIfAborted();
 let state=summary(await rpc(PREPARATION_RPCS.status,{},signal)),batches=0,activationAttempts=0;
 onProgress({event:'status',...state});
 if(!options.apply||state.ready||signal?.aborted)return {state,batches,stopped:Boolean(signal?.aborted)};
 while(!state.ready&&!signal?.aborted){
  if(state.done){
   if(!options.activate||activationAttempts>=10)break;
   state=summary(await rpc(PREPARATION_RPCS.activate,{},signal));activationAttempts++;
   onProgress({event:'activation',attempt:activationAttempts,...state});
   // A concurrent write can add dirty work at the publication boundary. Resume
   // reconciliation; a busy clock backs off without converting it into failure.
   if(!state.ready&&state.done&&!state.busy)throw Error('Preparation could not activate; inspect index readiness.');
  }else{
   if(batches>=options.maxBatches)break;
   state=summary(await rpc(PREPARATION_RPCS.batch,{p_limit:options.limit},signal));batches++;
   onProgress({event:'batch',batch:batches,...state});
  }
  if(!state.ready&&!signal?.aborted&&(!state.done||state.busy))await wait(state.busy?Math.max(500,options.pauseMs):options.pauseMs,signal);
 }
 return {state,batches,activationAttempts,stopped:Boolean(signal?.aborted)};
}
async function main(){
 const options=parsePreparationOptions(process.argv.slice(2));
 const nextEnv=(await import('@next/env')).default;nextEnv.loadEnvConfig(process.cwd());
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('Maintenance service configuration unavailable.');
 const {createClient}=await import('@supabase/supabase-js');
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),controller=new AbortController();
 const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  const result=await runPreparation({options,signal:controller.signal,onProgress:value=>console.log(JSON.stringify(value)),rpc:async(name,args,signal)=>{
   signal?.throwIfAborted();const request=client.rpc(name,args),{data,error}=await (signal?request.abortSignal(signal):request);
   if(error){const code=/^[A-Z0-9_]{2,16}$/.test(error.code??'')?error.code:'unknown';throw Error('Preparation RPC failed ('+code+'). Resume after resolving the failure.');}
   return data;
  }});
  console.log(JSON.stringify({event:'finished',...result}));
 }catch(error){if(!controller.signal.aborted)throw error;console.log(JSON.stringify({event:'interrupted',resumable:true}));}
 finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
