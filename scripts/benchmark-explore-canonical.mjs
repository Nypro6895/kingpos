import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const url=process.env.EXPLORE_CANONICAL_TEST_DATABASE_URL,target=new URL(url);
if(!['127.0.0.1','localhost'].includes(target.hostname)||target.pathname!=='/explore_load_canonical')throw new Error('Dedicated local canonical fixture database required.');
const {Pool}=createRequire(path.resolve('work/explore-load-runtime/package.json'))('pg');
const pool=new Pool({connectionString:url,max:1});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids=Array.from({length:12},(_,n)=>id(8000+n));
const times={reference:[],optimized:[]},plans={};
const percentile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
try{
 for(const shop of ids){
  await pool.query("INSERT INTO locations VALUES($1,$2,'Empty public fixture','active',now()-interval '1 day') ON CONFLICT(id) DO NOTHING",[shop,id(9999)]);
  await pool.query("INSERT INTO salon_settings VALUES($1,true,now()-interval '1 day','America/Chicago') ON CONFLICT(salon_id) DO NOTHING",[shop]);
 }
 for(let n=0;n<22;n++)for(const [key,name] of [['reference','get_public_lumi_trust_signals_reference'],['optimized','get_public_lumi_trust_signals']]){
  const start=process.hrtime.bigint();
  const rows=(await pool.query(`SELECT * FROM public.${name}($1)`,[ids])).rows;
  if(rows.length!==12||rows.some(row=>Number(row.verified_visit_count)!==0))throw new Error('Expected twelve empty public shops.');
  if(n>=2)times[key].push(Number(process.hrtime.bigint()-start)/1e6);
 }
 for(const [key,name] of [['reference','get_public_lumi_trust_signals_reference'],['optimized','get_public_lumi_trust_signals']]){
  const definition=(await pool.query('SELECT pg_get_functiondef($1::regprocedure) AS value',[`public.${name}(uuid[])`])).rows[0].value;
  const body=definition.match(/AS (\$[a-zA-Z_]*\$)([\s\S]*)\1/)[2].replaceAll('target_salon_ids','$1::uuid[]');
  plans[key]=(await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+body,[ids])).rows[0]['QUERY PLAN'][0];
 }
 const result={fixture:'12 selected public salons; zero POS tickets; same exact canonical v2 evidence',samplesPerVariant:20,
  metrics:Object.fromEntries(Object.entries(times).map(([key,values])=>[key,{p50Ms:percentile(values,.5),p95Ms:percentile(values,.95)}])),plans};
 mkdirSync('work/explore-load-results',{recursive:true});writeFileSync('work/explore-load-results/canonical-read-cost.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({fixture:result.fixture,samplesPerVariant:result.samplesPerVariant,metrics:result.metrics}));
}finally{await pool.end();}
