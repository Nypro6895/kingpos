// Owned local synthetic native write/read gate; never accepts a remote endpoint.
import {createRequire} from 'node:module';
import {writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {initializeNativeFixture,fixtureId,sourceHash} from '../tests/fixtures/explore-local-quality-native-bootstrap.mjs';
import {readQualityMigrationBundle} from '../tests/fixtures/explore-local-quality-migration-manifest.mjs';
import {prepareNativeQuality} from '../tests/fixtures/explore-local-quality-native-preparation.mjs';
const root=path.resolve('.'),runtime=path.resolve('work/explore-local-quality-runtime');
const {Client}=createRequire(path.join(runtime,'package.json'))('pg');
const stamp=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14),name='explore_load_local_quality_writeprobe_'+stamp;
const endpoint=db=>`postgresql://explore_local_bench@127.0.0.1:55441/${db}`;
const bundle=readQualityMigrationBundle({archiveDirectory:'work/explore-local-quality-evidence/frozen'});
const report={startedAt:new Date().toISOString(),environment:'Owned native PostgreSQL17 localhost55441 synthetic100salons only',database:name,qualitySha:bundle.identitySha256,migrationSource:bundle.receipt,scriptSha256:sourceHash(readFileSync(new URL(import.meta.url))),phases:[],limitations:['Small100salon fixture with up to5120same-salon public textposts; not production import throughput or large-directory concurrency proof.','Setup uses final read-model bulk seed; measured writes use actual existing source triggers and new statement projection triggers.','Read workers are SQL connections; HTTP/render/media/canonical application enrichment excluded.','Shared workstation; no OS cache eviction.','No existing database is dropped or reset.']};
const out=`work/explore-local-quality-evidence/native-write-pressure-${bundle.identitySha256.slice(0,12)}-${stamp}.json`;
const save=()=>writeFileSync(out,JSON.stringify(report,null,2)+'\n');
const admin=new Client({connectionString:endpoint('postgres'),application_name:'explore_local_quality_owned_write_probe'});let db;
const rpc=`SELECT search_public_explore_session(p_query=>'gel manicure',p_category=>'Nails',p_location=>'Milwaukee, WI',p_sort=>'relevance',p_limit=>12,p_scope_policy=>'fixed',p_content_query=>'gel manicure',p_query_kind=>'service',p_location_priority=>true) page`;
const styleRpc=rpc.replaceAll('gel manicure','velvet amber').replace("p_query_kind=>'service'","p_query_kind=>'style'");
try{
 await admin.connect();const actual=(await admin.query('SHOW data_directory')).rows[0].data_directory;
 if(path.resolve(actual).toLowerCase()!==path.join(runtime,'data').toLowerCase())throw Error('Unowned PostgreSQL data directory');
 await admin.query(`CREATE DATABASE "${name}"`);db=new Client({connectionString:endpoint(name)});await db.connect();await db.query('SET statement_timeout=60000');
 await initializeNativeFixture(db,{scale:100});const setupAt=performance.now();report.preparation=await prepareNativeQuality(db,{bundle,scale:100});report.qualitySetupMs=performance.now()-setupAt;bundle.verifyArchivedBytes();
 await db.query("CREATE TABLE local_write_probe_insert_count(n integer);CREATE FUNCTION local_write_probe_insert_count() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO local_write_probe_insert_count VALUES(1);RETURN NULL;END$$;CREATE TRIGGER local_write_probe_insert_count AFTER INSERT ON explore_local_quality_documents FOR EACH ROW EXECUTE FUNCTION local_write_probe_insert_count();");
 for(const amount of[100,1000,4000,'edit']){
  const phase={amount,readers:4,readRequests:0,readErrors:[],write:null};report.phases.push(phase);save();
  await db.query('TRUNCATE local_write_probe_insert_count');await db.query('SET statement_timeout=8000');
  const readers=await Promise.all(Array.from({length:4},async()=>{const c=new Client({connectionString:endpoint(name)});await c.connect();await c.query('SET statement_timeout=3000');return c;}));
  const writes=(async()=>{const at=performance.now();try{
   if(amount==='edit')await db.query("UPDATE salon_profile_updates SET caption='Velvet amber edited actual announcement with unique copper saffron' WHERE id='30000000-0000-4000-8000-000000400000'");
   else await db.query(`INSERT INTO salon_profile_updates(id,salon_id,title,caption,status,published_at) SELECT ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,'Velvet amber actual post','Velvet amber public announcement appointment detail '||n,'published',now() FROM generate_series($2::int,$3::int)n`,[fixtureId(4),amount*100,amount*100+amount-1]);phase.write={passed:true,durationMs:performance.now()-at};
  }catch(e){phase.write={passed:false,durationMs:performance.now()-at,code:e.code,message:e.message};}})();
  const timings=[];await Promise.all(readers.map(async c=>{try{for(let n=0;n<6;n++){const at=performance.now();try{const p=(await c.query(n%2?styleRpc:rpc)).rows[0].page;if(p.rankingBasis!=='local_quality_indexed_lanes')throw Error('Wrong search path');if(new Set(p.rows.map(x=>x.salon_id)).size!==p.rows.length)throw Error('Duplicate salon');phase.readRequests++;timings.push(performance.now()-at);}catch(e){phase.readErrors.push({kind:n%2?'style':'service',sample:n,durationMs:performance.now()-at,code:e.code,message:e.message,where:e.where});}}}finally{await c.end();}}));await writes;
  const sorted=timings.sort((a,b)=>a-b);phase.readMs={p50:sorted[Math.ceil(sorted.length*.5)-1]??null,p95:sorted[Math.ceil(sorted.length*.95)-1]??null,max:sorted.at(-1)??null};
  phase.projectionInserts=(await db.query('SELECT count(*)::int n FROM local_write_probe_insert_count')).rows[0].n;
  phase.activity=(await db.query('SELECT activity_count,quality FROM explore_local_quality_documents WHERE salon_id=$1 AND valid_to IS NULL',[fixtureId(4)])).rows[0];
  phase.fanout=(await db.query('SELECT (SELECT count(*) FROM explore_unified_content_history WHERE salon_id=$1 AND valid_to IS NULL AND NOT is_reference)::int actual_posts,(SELECT cardinality(post_terms) FROM explore_local_quality_documents WHERE salon_id=$1 AND valid_to IS NULL)::int post_terms,(SELECT count(*) FROM explore_local_quality_postings WHERE salon_id=$1 AND valid_to IS NULL)::int current_postings,pg_total_relation_size(\'explore_local_quality_documents\')::bigint document_bytes,pg_total_relation_size(\'explore_local_quality_postings\')::bigint posting_bytes',[fixtureId(4)])).rows[0];
  phase.actualPostVisible=(await db.query(amount==='edit'?styleRpc.replaceAll('velvet amber','copper saffron'):styleRpc)).rows[0].page.rows.some(row=>row.salon_id===fixtureId(4)&&row.is_primary_match);
  phase.passed=phase.write.passed&&phase.readErrors.length===0&&phase.readRequests===24&&phase.projectionInserts===(amount==='edit'?2:1)&&phase.activity.activity_count===5&&phase.actualPostVisible;save();
 }
 report.completedAt=new Date().toISOString();report.passed=report.phases.every(x=>x.passed);save();console.log(JSON.stringify({file:out,passed:report.passed,qualitySha:report.qualitySha,phases:report.phases}));if(!report.passed)process.exitCode=1;
}catch(e){report.fatal={code:e.code,message:e.message};save();throw e;}finally{await db?.end().catch(()=>{});await admin.end().catch(()=>{});}

