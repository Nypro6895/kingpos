import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';

const databaseUrl=process.env.EXPLORE_DECISION_TEST_DATABASE_URL;
const migration='supabase/migrations/20261009129034_explore_decision_selected_seek.sql';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const read=file=>readFileSync(file,'utf8');
const coreName='_explore_core_get_public_explore_decision_signals';
const publicName='get_public_explore_decision_signals';
const oldDefinition=JSON.parse(read('tests/fixtures/explore-canonical-production-contract.json')).find(row=>row.proname===publicName).definition;
const oldBody=oldDefinition.match(/AS (\$[^$]*\$)([\s\S]*?)\1/)[2].trim().replace(/;\s*$/,'');
const walk=plan=>[plan,...(plan.Plans??[]).flatMap(walk)];
const slim=plan=>({type:plan['Node Type'],relation:plan['Relation Name'],index:plan['Index Name'],rows:plan['Actual Rows'],loops:plan['Actual Loops'],removed:plan['Rows Removed by Filter']??0,hits:plan['Shared Hit Blocks'],reads:plan['Shared Read Blocks']});
const bootstrap=`
 CREATE SCHEMA IF NOT EXISTS extensions;
 DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
 END $$;
 CREATE TABLE locations(id uuid PRIMARY KEY,status text,created_at timestamptz);
 CREATE TABLE salon_settings(salon_id uuid PRIMARY KEY,public_discovery_enabled boolean,public_discovery_published_at timestamptz);
 CREATE TABLE booking_settings(salon_id uuid PRIMARY KEY,booking_enabled boolean,online_booking_visible boolean,guest_booking_enabled boolean);
 CREATE TABLE services(id uuid PRIMARY KEY,salon_id uuid,name text,is_active boolean,online_booking_enabled boolean);
 CREATE INDEX services_public_online_name_idx ON services(salon_id,name,id) WHERE is_active AND online_booking_enabled;
 CREATE TABLE salon_profile_reviews(id uuid PRIMARY KEY,salon_id uuid,rating integer,moderation_status text,created_at timestamptz);
 CREATE INDEX salon_profile_reviews_public_idx ON salon_profile_reviews(salon_id,moderation_status,created_at DESC);
 CREATE FUNCTION salon_profile_public_salon_exists(target_salon_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
 SELECT EXISTS(SELECT 1 FROM salon_settings settings JOIN locations salons ON salons.id=settings.salon_id
 WHERE settings.salon_id=target_salon_id AND settings.public_discovery_enabled AND salons.status='active'
 AND(salons.created_at IS NULL OR salons.created_at<=now())
 AND(settings.public_discovery_published_at IS NULL OR settings.public_discovery_published_at<=now())) $$;
 CREATE FUNCTION explore_canonical_salon_ids(p_ids uuid[]) RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
 DECLARE ids uuid[];
 BEGIN
  IF coalesce(cardinality(p_ids),0)=0 THEN RETURN '{}'::uuid[]; END IF;
  IF cardinality(p_ids)>100 THEN RAISE EXCEPTION 'At most 100 salon identities may be requested' USING ERRCODE='22023'; END IF;
  SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO ids FROM(SELECT DISTINCT id FROM unnest(p_ids) id WHERE id IS NOT NULL) requested WHERE public.salon_profile_public_salon_exists(id);
  RETURN ids;
 END $$;
 REVOKE ALL ON FUNCTION explore_canonical_salon_ids(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
`;

test('selected canonical decisions preserve live semantics and seek unknown array parameters', {skip:!databaseUrl,timeout:120000},async()=>{
 const endpoint=new URL(databaseUrl);
 assert.ok(['127.0.0.1','localhost'].includes(endpoint.hostname)&&endpoint.pathname==='/explore_load_decision129034','refuse remote, production and other benchmark databases');
 const {Pool}=createRequire(path.resolve('work/explore-load-runtime/package.json'))('pg');
 const db=new Pool({connectionString:databaseUrl,max:1});
 const notices=[];
 const client=await db.connect();client.on('notice',notice=>notices.push(notice.message));
 try{
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.query(bootstrap);
  await client.query(oldDefinition.replace(`FUNCTION public.${publicName}(`,`FUNCTION public.${coreName}(`));
  await client.query(`REVOKE ALL ON FUNCTION ${coreName}(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
   CREATE FUNCTION ${publicName}(target_salon_ids uuid[] DEFAULT NULL::uuid[]) RETURNS TABLE(salon_id uuid,average_rating numeric,review_count bigint,bookable_service_id uuid,bookable_service_name text,booking_enabled boolean,booking_href text,next_available_at timestamptz,next_availability_label text)
   LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit=off AS $$
   DECLARE ids uuid[];
   BEGIN ids:=public.explore_canonical_salon_ids(target_salon_ids); IF coalesce(cardinality(ids),0)=0 THEN RETURN; END IF;
   RETURN QUERY SELECT * FROM public.${coreName}(ids); END $$;
   REVOKE ALL ON FUNCTION ${publicName}(uuid[]) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION ${publicName}(uuid[]) TO anon,authenticated,service_role;`);
  for(let n=1;n<=10;n++){
   await client.query("INSERT INTO locations VALUES($1,$2,CASE WHEN $3 THEN now()+interval '1 day' ELSE now()-interval '1 day' END)",[id(n),n===4?'inactive':'active',n===5]);
   await client.query("INSERT INTO salon_settings VALUES($1,$2,CASE WHEN $3 THEN now()+interval '1 day' ELSE now()-interval '1 day' END)",[id(n),n!==3,n===2]);
   if(n!==6)await client.query('INSERT INTO booking_settings VALUES($1,$2,$3,$4)',[id(n),n!==9,n!==8,n===7?false:n===1?null:true]);
   await client.query("INSERT INTO services VALUES($1,$2,'Zeta',true,$3),($4,$2,'Alpha',true,$3),($5,$2,'Aardvark',false,true),($6,$2,'0 offline',true,false)",[id(1000+n),id(n),n!==10,id(1100+n),id(1200+n),id(1300+n)]);
  }
  await client.query("INSERT INTO salon_profile_reviews VALUES($1,$2,5,'visible',now()),($3,$2,3,'visible',now()),($4,$2,1,'hidden',now())",[id(2000),id(1),id(2001),id(2002)]);
  const inputs=[null,[],[null],[id(1),id(1),null,id(999)],Array.from({length:10},(_,n)=>id(n+1))];
  const baseline=[];
  for(const ids of inputs)baseline.push({core:(await client.query(`SELECT * FROM ${coreName}($1) ORDER BY salon_id`,[ids])).rows,public:(await client.query(`SELECT * FROM ${publicName}($1) ORDER BY salon_id`,[ids])).rows});
  await client.query(`CREATE VIEW canonical_dependency AS SELECT * FROM ${publicName}(ARRAY['${id(1)}','${id(2)}']::uuid[]);`);
  const before=(await client.query(`SELECT p.oid,p.proacl::text acl,p.proconfig,pg_get_functiondef(p.oid) definition FROM pg_proc p WHERE p.oid=ANY(ARRAY['${coreName}(uuid[])'::regprocedure,'${publicName}(uuid[])'::regprocedure]) ORDER BY p.proname`)).rows;
  await client.query(read(migration));
  const after=(await client.query(`SELECT p.oid,p.proacl::text acl,p.proconfig,pg_get_functiondef(p.oid) definition FROM pg_proc p WHERE p.oid=ANY(ARRAY['${coreName}(uuid[])'::regprocedure,'${publicName}(uuid[])'::regprocedure]) ORDER BY p.proname`)).rows;
  assert.deepEqual(after.map(({definition,...row})=>row),before.map(({definition,...row})=>row),'both OIDs, ACLs and execution policies remain identical');
  assert.equal(after[1].definition,before[1].definition,'public wrapper remains byte-for-byte unchanged');
  for(let n=0;n<inputs.length;n++){
   assert.deepEqual((await client.query(`SELECT * FROM ${coreName}($1) ORDER BY salon_id`,[inputs[n]])).rows,baseline[n].core,'owner NULL, duplicates, empty and selected semantics remain exact');
   assert.deepEqual((await client.query(`SELECT * FROM ${publicName}($1) ORDER BY salon_id`,[inputs[n]])).rows,baseline[n].public,'public publication/hidden/lifecycle guards remain exact');
  }
  const rows=baseline.at(-1).public;
  assert.deepEqual(rows.map(row=>row.salon_id),[1,6,7,8,9,10].map(id));
  const first=rows[0];assert.equal(Number(first.average_rating),4);assert.equal(first.review_count,'2');
  assert.equal(first.bookable_service_name,'Alpha');assert.equal(first.booking_enabled,true);assert.equal(first.booking_href,`/book/${id(1)}`);
  assert.equal(first.next_available_at,null);assert.equal(first.next_availability_label,'Request a time');
  assert.ok(rows.slice(1).every(row=>!row.booking_enabled&&row.booking_href===null&&row.next_availability_label===null));
  assert.equal((await client.query('SELECT * FROM canonical_dependency')).rows.length,1);
  for(const role of ['anon','authenticated','service_role']){
   assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,`${coreName}(uuid[])`])).rows[0].allowed,false);
   await client.query(`SET ROLE ${role}`);
   assert.equal((await client.query(`SELECT * FROM ${publicName}($1)`,[[id(1),id(2),id(3),id(4),id(5)]])).rows.length,1);
   await client.query('RESET ROLE');
  }
  await assert.rejects(client.query(`SELECT * FROM ${publicName}($1)`,[Array(101).fill(id(1))]),error=>error.code==='22023');
  // Realistic cardinality forces the old NULL-or-ANY generic plan to scan every
  // shop. Synthetic fixture IDs are local; no production records are copied.
  await client.query("INSERT INTO locations SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' FROM generate_series(10000,109999) n;");
  await client.query("INSERT INTO salon_settings SELECT id,true,now()-interval '1 day' FROM locations WHERE NOT EXISTS(SELECT 1 FROM salon_settings s WHERE s.salon_id=locations.id);");
  await client.query('ANALYZE locations; ANALYZE salon_settings; ANALYZE booking_settings; ANALYZE services; ANALYZE salon_profile_reviews; SET jit=off; SET plan_cache_mode=force_generic_plan;');
  const sourceQuery=oldBody.replace(/\btarget_salon_ids\b/g,'$1');
  const positiveQuery=sourceQuery.replace(/\(\s*\$1\s+is\s+null\s+or\s+salons\.id\s*=\s*any\(\$1\)\s*\)/i,'salons.id=ANY($1)');
  assert.notEqual(positiveQuery,sourceQuery);
  await client.query('PREPARE decision_before(uuid[]) AS '+sourceQuery);
  await client.query('PREPARE decision_after(uuid[]) AS '+positiveQuery);
  const report={scope:'native isolated PostgreSQL;100010 synthetic shops; generic unknown UUID[] parameters; actual nested function plans',samples:[]};
  // auto_explain captures the executed SPI query inside the new PL/pgSQL core,
  // proving the function itself seeks instead of merely testing copied SQL.
  await client.query("LOAD 'auto_explain'; SET auto_explain.log_min_duration=0; SET auto_explain.log_analyze=on; SET auto_explain.log_buffers=on; SET auto_explain.log_format=json; SET auto_explain.log_nested_statements=on; SET auto_explain.log_level=notice;");
  for(const limit of [12,50]){
   const ids=Array.from({length:limit},(_,n)=>id(10000+n));
   const args=`ARRAY[${ids.map(value=>`'${value}'`).join(',')}]::uuid[]`;
   const old=(await client.query('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE decision_before('+args+')')).rows[0]['QUERY PLAN'][0];
   const optimized=(await client.query('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE decision_after('+args+')')).rows[0]['QUERY PLAN'][0];
   const oldLocations=walk(old.Plan).find(node=>node['Relation Name']==='locations');
   const newLocations=walk(optimized.Plan).find(node=>node['Relation Name']==='locations');
   assert.equal(oldLocations['Node Type'],'Seq Scan');assert.ok(oldLocations['Rows Removed by Filter']>=99960);
   assert.ok(['Index Scan','Index Only Scan','Bitmap Heap Scan'].includes(newLocations['Node Type']));
   assert.equal(newLocations['Actual Rows'],limit);assert.equal(newLocations['Rows Removed by Filter']??0,0);
   notices.length=0;
   const functionRows=(await client.query(`SELECT * FROM ${coreName}($1)`,[ids])).rows;
   assert.equal(functionRows.length,limit);
   const nested=notices.flatMap(message=>{try{return [JSON.parse(message.slice(message.indexOf('{')))];}catch{return [];}}).find(plan=>plan['Query Text']?.includes('WHERE salons.id = ANY(target_salon_ids)'));
   assert.ok(nested,'actual nested selected core plan must be captured');
   const actualLocations=walk(nested.Plan).find(node=>node['Relation Name']==='locations');
   assert.ok(['Index Scan','Index Only Scan','Bitmap Heap Scan'].includes(actualLocations['Node Type']),'real cached function selected branch must seek');
   assert.equal(actualLocations['Actual Rows'],limit);assert.equal(actualLocations['Rows Removed by Filter']??0,0);
   assert.match(newLocations['Index Cond']??'',/\$1/,'generic positive predicate retains an unknown array parameter');
   report.samples.push({limit,beforeMs:old['Execution Time'],positiveGenericMs:optimized['Execution Time'],beforeLocations:slim(oldLocations),positiveLocations:slim(newLocations),executedFunctionLocations:slim(actualLocations)});
  }
  if(process.env.EXPLORE_DECISION_TEST_RECEIPT)writeFileSync(process.env.EXPLORE_DECISION_TEST_RECEIPT,JSON.stringify(report,null,2)+'\n');
 }finally{client.release();await db.end();}
});
