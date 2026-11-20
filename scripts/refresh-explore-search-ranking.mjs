// Operator-owned backfill runner. It uses the same bounded worker as the private route.
import { build } from 'esbuild';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { createRequire } from 'node:module';
try { process.loadEnvFile('.env.local'); } catch { /* Hosted/operator env can supply existing keys directly. */ }
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Existing Supabase worker configuration is required.');
function integerArgument(name, fallback, maximum) {
 const value=Number(process.argv.find(v=>v.startsWith(`--${name}=`))?.split('=')[1]??fallback);
 if(!Number.isSafeInteger(value)||value<1||value>maximum)throw Error(`--${name} must be an integer from 1 to ${maximum}.`);
 return value;
}
const maxRuns=integerArgument('max-runs',100,10000),batchSize=integerArgument('batch-size',50,100),maxBatches=integerArgument('max-batches',10,10);
const directory=await mkdtemp(join(tmpdir(),'explore-rank-worker-'));
try {
 const outfile=join(directory,'worker.cjs');
 await build({entryPoints:['lib/explore-search-ranking.ts'],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins:[{name:'server-only-stub',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'',loader:'js'}));}}]});
 const {runExploreSearchRankingWithRetry,waitForExploreSearchRankingPause}=createRequire(import.meta.url)(outfile);
 for(let index=0;index<maxRuns;index++) {
  const signal=AbortSignal.timeout(120000);
  const result=await runExploreSearchRankingWithRetry({batchSize,maxBatches,signal,refreshDue:index===0,
   onRetry:retry=>process.stdout.write(JSON.stringify({run:index+1,status:'retry',...retry})+'\n')});
  process.stdout.write(JSON.stringify({run:index+1,...result})+'\n');
  if(!result.hasMore||result.claimed===0)break;
  if(index+1<maxRuns)await waitForExploreSearchRankingPause(1500,signal);
 }
}catch(cause){
 const code=typeof cause?.code==='string'&&/^[0-9A-Z]{5}$/.test(cause.code)?cause.code:null;
 const phase=typeof cause?.phase==='string'&&/^[a-z_]{1,80}$/.test(cause.phase)?cause.phase:'worker';
 process.stderr.write(JSON.stringify({status:'failed',code,phase,message:'Ranking backfill stopped after bounded attempts.'})+'\n');
 process.exitCode=1;
}finally{
 const target=await realpath(directory),root=await realpath(tmpdir()),inside=relative(root,target);
 if(!inside||inside.startsWith('..')||isAbsolute(inside)||!basename(target).startsWith('explore-rank-worker-'))throw Error('Unsafe worker temporary-directory cleanup.');
 await rm(target,{recursive:true,force:true});
}
