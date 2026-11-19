// Rich synthetic profile/storage gate on the task's isolated native server only.
import {createRequire} from 'node:module';
import {writeFileSync,mkdirSync,readFileSync,statSync,openSync,readSync,closeSync} from 'node:fs';
import path from 'node:path';
import {initializeNativeFixture,sourceHash} from '../tests/fixtures/explore-local-quality-native-bootstrap.mjs';
import {readQualityMigrationBundle} from '../tests/fixtures/explore-local-quality-migration-manifest.mjs';
import {prepareNativeQuality} from '../tests/fixtures/explore-local-quality-native-preparation.mjs';
const taskRoot=path.resolve('.'),runtime=path.resolve('work/explore-local-quality-runtime');
const {Client}=createRequire(path.join(runtime,'package.json'))('pg');
const database='explore_load_local_quality_rich_'+new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);
const url=name=>`postgresql://explore_local_bench@127.0.0.1:55441/${name}`;
const bundle=readQualityMigrationBundle({archiveDirectory:'work/explore-local-quality-evidence/frozen'});
const file=`work/explore-local-quality-evidence/native-rich-profile-10000-${bundle.identitySha256.slice(0,12)}-${database.slice(-14)}.json`;mkdirSync(path.dirname(file),{recursive:true});
const report={startedAt:new Date().toISOString(),database,salons:10000,engine:'Owned native PostgreSQL17 localhost55441 synthetic profiles',qualitySha:bundle.identitySha256,migrationSource:bundle.receipt,scriptSha256:sourceHash(readFileSync(new URL(import.meta.url))),setup:[],requests:[],plans:[],actualRpcPlans:[],limitations:['Isolated10000salon rich-profile lower bound; do not extrapolate to production or1million.','Synthetic US phones/addresses and56worddescriptions; no real personal/business contact data.','Setup disables/restores source projection triggers and updates exact current source fingerprints before applying the unchanged additive quality migration; not importer throughput.','Request times include only SQL; HTTP/render/lifetime canonical card enrichment excluded.','Shared workstation; setup/I/O/cache history is not controlled cold-disk benchmarking.','Nested actual-RPC auto_explain captures run after all timing samples; their instrumented duration is excluded from latency claims.','No existing databases are dropped or reset.']};
const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
save();
const admin=new Client({connectionString:url('postgres'),application_name:'explore_local_quality_owned_rich_probe'});let db;
const percentile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.ceil(a.length*p)-1]??null;
function loggedPlans(raw){
 const plans=[];
 for(const record of raw.split(/(?=^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/m)){
  const start=record.indexOf('{');if(start<0||!record.includes('plan:'))continue;
  let depth=0,quoted=false,escaped=false,end=-1;
  for(let n=start;n<record.length;n++){
   const c=record[n];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
   else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=n+1;break;}
  }
  if(end>=0)try{plans.push(JSON.parse(record.slice(start,end)));}catch{/* Raw evidence retains incomplete records. */}
 }
 return plans;
}
function summarizePlan(plan){
 const scans=[],sorts=[];let visits=0,filtered=0;
 const walk=node=>{
  visits+=(node['Actual Rows']??0)*(node['Actual Loops']??0);filtered+=((node['Rows Removed by Filter']??0)+(node['Rows Removed by Join Filter']??0))*(node['Actual Loops']??0);
  if(/Scan/.test(node['Node Type']??''))scans.push({type:node['Node Type'],relation:node['Relation Name'],index:node['Index Name'],rows:node['Actual Rows'],loops:node['Actual Loops'],removed:node['Rows Removed by Filter'],condition:node['Index Cond']});
  if(/Sort/.test(node['Node Type']??''))sorts.push({type:node['Node Type'],rows:node['Actual Rows'],method:node['Sort Method'],spaceKb:node['Sort Space Used']});
  for(const child of node.Plans??[])walk(child);
 };walk(plan.Plan);
 return{query:plan['Query Text'],nodeRowVisits:visits,nodeFilteredVisits:filtered,scans,sorts,sharedHitBlocks:plan.Plan['Shared Hit Blocks'],sharedReadBlocks:plan.Plan['Shared Read Blocks']};
}
const description='Our neighborhood studio welcomes families and offers attentive personal care in a comfortable accessible space. Experienced professionals discuss each appointment carefully, explain available options, respect individual preferences, and maintain clean organized workstations. Guests appreciate wheelchair accessible entry, convenient parking, friendly communication, flexible scheduling, thoughtful consultations, reliable service, and a relaxing environment for their regular beauty routine.';
try{
 await admin.connect();const data=(await admin.query('SHOW data_directory')).rows[0].data_directory;
 if(path.resolve(data).toLowerCase()!==path.join(runtime,'data').toLowerCase())throw Error('Unowned PostgreSQL server');
 await admin.query(`CREATE DATABASE "${database}"`);db=new Client({connectionString:url(database)});await db.connect();await db.query('SET statement_timeout=300000');
 let at=performance.now();await initializeNativeFixture(db,{scale:10000});report.setup.push({phase:'base fixture final source projection',durationMs:performance.now()-at});
 at=performance.now();await db.query('ALTER TABLE explore_salon_documents DISABLE TRIGGER USER');
 try{
  await db.query(`UPDATE explore_salon_documents SET phone='(414) 555-'||lpad((right(salon_id::text,12)::int%10000)::text,4,'0'),address_line1=(1000+right(salon_id::text,12)::int)::text||' Oak Avenue',address_line2='Suite '||(1+right(salon_id::text,12)::int%50),description=$1`,[description]);
  await db.query(`UPDATE explore_unified_salon_history h SET fingerprint=explore_unified_salon_fingerprint(d),profile_search_text=explore_unified_profile_text(d),phone_search_digits=regexp_replace(d.phone,'[^0-9]','','g'),address_line1=d.address_line1,address_line2=d.address_line2,city=d.city FROM explore_salon_documents d WHERE d.salon_id=h.salon_id AND h.valid_to IS NULL`);
 }finally{await db.query('ALTER TABLE explore_salon_documents ENABLE TRIGGER USER');}
 report.setup.push({phase:'synthetic rich profile source setup',durationMs:performance.now()-at});
 report.richness=(await db.query("SELECT count(*)::int salons,count(phone)::int phones,count(address_line1)::int streets,count(address_line2)::int suites,min(cardinality(regexp_split_to_array(description,'\\s+'))) description_min_words,max(cardinality(regexp_split_to_array(description,'\\s+'))) description_max_words FROM explore_salon_documents")).rows[0];
 at=performance.now();report.preparation=await prepareNativeQuality(db,{bundle,scale:10000});report.setup.push({phase:'exact migration pair and bounded preparation/activation',durationMs:performance.now()-at});bundle.verifyArchivedBytes();
 report.storage=(await db.query("SELECT relname,pg_relation_size(oid)::bigint table_bytes,pg_indexes_size(oid)::bigint index_bytes,pg_total_relation_size(oid)::bigint total_bytes FROM pg_class WHERE oid IN('explore_local_quality_documents'::regclass,'explore_local_quality_postings'::regclass) ORDER BY relname")).rows;
 report.fanout=(await db.query('SELECT (SELECT count(*) FROM explore_local_quality_documents)::bigint documents,(SELECT count(*) FROM explore_local_quality_postings)::bigint postings,(SELECT count(*)::numeric/10000 FROM explore_local_quality_postings) postings_per_salon')).rows[0];save();
 await db.query('SET statement_timeout=3000');
 const cases=[{name:'broad city',query:'',kind:'service'},{name:'common rich profile terms',query:'wheelchair accessible',kind:'name'},{name:'formatted phone',query:'414 555 0004',kind:'name'},{name:'street words',query:'1004 oak avenue',kind:'name'},{name:'absent one letter name',query:'z',kind:'name'},{name:'absent two letter name',query:'zz',kind:'name'},{name:'GPS dense',query:'',kind:'service',location:'',latitude:43.0389,longitude:-87.9065},{name:'GPS sparse',query:'',kind:'service',location:'',latitude:43.0731,longitude:-89.4012},{name:'GPS zero',query:'',kind:'service',location:'',latitude:44.5133,longitude:-88.0133},{name:'newest broad city',query:'',kind:'service',sort:'newest'},{name:'newest service city',query:'dip powder',kind:'service',sort:'newest'},{name:'Closest GPS dense',query:'',kind:'service',sort:'closest',location:'',latitude:43.0389,longitude:-87.9065},{name:'Closest service GPS dense',query:'dip powder',kind:'service',sort:'closest',location:'',latitude:43.0389,longitude:-87.9065}];
 const rpc=`SELECT search_public_explore_session(p_query=>$1,p_category=>'Nails',p_location=>$4,p_latitude=>$5,p_longitude=>$6,p_sort=>$7,p_limit=>12,p_cursor=>$2::jsonb,p_scope_policy=>'fixed',p_content_query=>$1,p_query_kind=>$3,p_location_priority=>true) page`;
 for(const c of cases){
  const entry={name:c.name,first:[],next:[],errors:[],counts:[]};report.requests.push(entry);
  for(let sample=0;sample<8;sample++){
   try{at=performance.now();const first=(await db.query(rpc,[c.query,null,c.kind,c.location??'Milwaukee, WI',c.latitude??null,c.longitude??null,c.sort??'relevance'])).rows[0].page;entry.first.push(performance.now()-at);if(first.rankingBasis!=='local_quality_indexed_lanes')throw Error('Wrong search path');entry.counts.push({primary:first.primaryCount,reference:first.referenceCount});
    if(first.hasMore){at=performance.now();const next=(await db.query(rpc,[c.query,first.nextCursor,c.kind,c.location??'Milwaukee, WI',c.latitude??null,c.longitude??null,c.sort??'relevance'])).rows[0].page;entry.next.push(performance.now()-at);const seen=new Set(first.rows.map(x=>x.salon_id));if(next.rows.some(x=>seen.has(x.salon_id)))throw Error('Duplicate continuation');}
   }catch(e){entry.errors.push({code:e.code,message:e.message});}
  }
  entry.firstMs={p50:percentile(entry.first,.5),p95:percentile(entry.first,.95),max:Math.max(...entry.first)};entry.nextMs={p50:percentile(entry.next,.5),p95:percentile(entry.next,.95),max:entry.next.length?Math.max(...entry.next):null};save();
 }
 for(const c of [{name:'broad scoped lane',lane:0,probe:'nails\x1f',terms:[],query:''},{name:'profile scoped lane',lane:8,probe:'nails\x1fwheelchair',terms:['access','wheelchair'],query:'wheelchair accessible'},{name:'phone scoped lane',lane:8,probe:'nails\x1f4145550004',terms:['4145550004'],query:'414 555 0004'}]){
  const canonical=`JOIN LATERAL(SELECT live.* FROM explore_salon_documents live WHERE live.salon_id=h.salon_id OFFSET 0)d ON true`;
  const proof=`d.has_public_profile AND salon_profile_public_salon_exists(d.salon_id) AND EXISTS(SELECT 1 FROM explore_unified_salon_incarnations i WHERE i.salon_id=h.salon_id AND i.source_token=h.source_token OFFSET 0)`;
  const sql=c.lane===8?`SELECT h.salon_id FROM explore_local_quality_documents h ${canonical} WHERE h.profile_terms @> $1::text[] AND h.state_code='WI' AND h.city_search='milwaukee' AND h.valid_to IS NULL AND ${proof} ORDER BY h.quality_order,h.post_order,h.salon_id LIMIT 64`:`SELECT p.salon_id FROM explore_local_quality_postings p JOIN LATERAL(SELECT row.* FROM explore_local_quality_documents row WHERE row.salon_id=p.salon_id AND row.valid_from=p.valid_from OFFSET 0)h ON true ${canonical} WHERE p.lane=$1 AND p.probe=$2 AND p.state_code='WI' AND p.city_search='milwaukee' AND p.valid_to IS NULL AND h.valid_to IS NULL AND ${proof} ORDER BY p.quality_order,p.post_order,p.salon_id LIMIT 64`;
  const plan=(await db.query('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+sql,c.lane===8?[c.terms]:[c.lane,c.probe])).rows[0]['QUERY PLAN'];report.plans.push({name:c.name,representativeOnly:true,sql,plan});save();
 }
 // Instrumentation starts only after every latency sample and representative
 // plan. These are actual public RPC calls, including nested lane retrieval.
 const log=path.join(runtime,'server-error.log');
 await db.query("LOAD 'auto_explain';SET auto_explain.log_min_duration=0;SET auto_explain.log_nested_statements=on;SET auto_explain.log_analyze=on;SET auto_explain.log_buffers=on;SET auto_explain.log_format=json;SET auto_explain.log_timing=off;SET statement_timeout=30000;");
 const actualCases=[...cases.filter(item=>['broad city','common rich profile terms','formatted phone'].includes(item.name)),{name:'unconstrained broad',query:'',kind:'service',location:''},{name:'unconstrained phone',query:'414 555 0004',kind:'name',location:''}];
 for(const c of actualCases){
  const entry={name:c.name,actualRpc:true,thresholdMs:0,instrumentedTimingExcluded:true,errors:[]},offset=statSync(log).size;
  try{
   const result=(await db.query(rpc,[c.query,null,c.kind,c.location??'Milwaukee, WI',c.latitude??null,c.longitude??null,c.sort??'relevance'])).rows[0].page;
   entry.result={primary:result.primaryCount,reference:result.referenceCount,basis:result.rankingBasis};
  }catch(error){entry.errors.push({code:error.code,message:error.message});}
  const length=statSync(log).size-offset,bytes=Buffer.alloc(length),fd=openSync(log,'r');try{readSync(fd,bytes,0,length,offset);}finally{closeSync(fd);}
  const raw=bytes.toString('utf8'),rawFile=file.replace(/\.json$/,`-actual-${c.name.replaceAll(' ','-')}.log`);writeFileSync(rawFile,raw);entry.rawFile=rawFile;
  entry.plans=loggedPlans(raw);entry.summaries=entry.plans.map(summarizePlan);report.actualRpcPlans.push(entry);save();
 }
 await db.query('SET auto_explain.log_min_duration=-1');
 report.completedAt=new Date().toISOString();report.passed=report.requests.every(x=>x.errors.length===0&&x.first.length===8)&&report.richness.salons===10000&&report.actualRpcPlans.every(x=>x.errors.length===0&&x.plans.length>0);save();console.log(JSON.stringify({file,passed:report.passed,setup:report.setup,richness:report.richness,fanout:report.fanout,storage:report.storage,requests:report.requests.map(x=>({name:x.name,first:x.firstMs,next:x.nextMs,errors:x.errors.length})),plans:report.plans.length,actualRpcPlans:report.actualRpcPlans.map(x=>({name:x.name,plans:x.plans.length,errors:x.errors.length}))}));
}catch(e){report.fatal={code:e.code,message:e.message};save();throw e;}finally{await db?.end().catch(()=>{});await admin.end().catch(()=>{});}
