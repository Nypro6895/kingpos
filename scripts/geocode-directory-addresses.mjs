// Isolated off-request maintenance command. No scheduler or bulk loop is installed.
import { build } from 'esbuild';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
nextEnv.loadEnvConfig(process.cwd());
const args=process.argv.slice(2);
if(args.some(value=>value!=='--apply'&&!value.startsWith('--after=')&&!value.startsWith('--limit=')))throw new Error('Use --apply, --after=<UUID>, --limit=<1..5> only');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error('Maintenance service configuration unavailable');
const built=await build({entryPoints:['lib/location/directory-geocode-worker.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'maintenance-server-only',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'',loader:'js'}));}}]});
const {runDirectoryGeocodeBatch}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const report=await runDirectoryGeocodeBatch({rpc:(name,values)=>client.rpc(name,values),dryRun:!args.includes('--apply'),after:args.find(v=>v.startsWith('--after='))?.slice(8)||null,limit:Number(args.find(v=>v.startsWith('--limit='))?.slice(8)||5)});
console.log(JSON.stringify(report,null,2));
