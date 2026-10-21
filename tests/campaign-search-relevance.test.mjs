import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';import {build} from 'esbuild';
const source=fs.readFileSync('tests/campaign-selection-daily-cap.test.mjs','utf8');
const fixture=source.slice(source.indexOf('await db.exec(`')+15,source.indexOf('`);',source.indexOf('await db.exec(`'))).replaceAll('${id}','00000000-0000-0000-0000-000000000001');
const area={country:'US',state:'WI',city:'Milwaukee',zipcode:'',neighborhood:''};
test('SQL filters before max6 and salon dedupe; real service/name/style evidence, geo, cap and ACL preserved',async()=>{
 const db=new PGlite();try{
 await db.exec(fixture);await db.exec(`create role anon;create role authenticated;create role service_role;
 create table explore_salon_documents(salon_id uuid,salon_name_search text,service_search_text text,service_category_search_text text);
 create table explore_unified_content_source(salon_id uuid,source_type text,content_id uuid,is_reference boolean,search_terms tsvector);
 insert into explore_salon_documents select salon_id,'First Salon','haircut','Hair' from owner_campaigns;
 insert into owner_campaigns select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,owner_id,'salon_profile_look',('30000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,status,starts_at,ends_at,payment_reference,approved_at,views,credit_view_limit,spent_cents,total_price_cents,country,area,location,state,city,daily_views,settings_snapshot,created_at,days from owner_campaigns cross join generate_series(2,9) n;
 insert into explore_salon_documents select salon_id,'Salon '||id,case when right(id::text,1) in ('8','9') then 'gel manicure pedicure' else 'haircut' end,case when right(id::text,1) in ('8','9') then 'Nails' else 'Hair' end from owner_campaigns where right(id::text,1)<>'1';
 insert into explore_unified_content_source select salon_id,source_type,source_id,false,to_tsvector('english','red chrome nails') from owner_campaigns;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261021010000_campaign_selection_daily_cap.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261021020000_campaign_search_relevance.sql','utf8'));
 const select=async(terms='',kind='service',category='',geo=area,viewer=null)=>(await db.query('select id from owner_campaign_search_candidates($1,$2,$3,$4,$5,$6)',[geo,'visitor',viewer,terms,kind,category])).rows.map(x=>x.id.slice(-1));
 assert.deepEqual(await select('gel manicure','service','Nails'),['8','9'],'eligible matches after first six');
 assert.deepEqual(await select('man','service'),[],'no blind substring');
 assert.deepEqual(await select('gel','service','Hair'),[],'category cannot be invented from photos');
 assert.deepEqual(await select('red chrome','style','Nails'),['8','9']);
 await db.exec("update explore_unified_content_source set is_reference=true where right(content_id::text,1)='8'");assert.deepEqual(await select('red chrome','style','Nails'),['9'],'reference text cannot prove style');
 assert.deepEqual(await select('purple','style','Nails'),[]);
 assert.deepEqual(await select('First Salon','name'),['1']);
 assert.deepEqual(await select('First','name','Nails'),[]);
 assert.equal((await select()).length,6,'empty search retains bound');assert.deepEqual(await select('','service','Nails'),['8','9']);
 assert.deepEqual(await select('gel','service','Nails',{...area,city:'Madison'}),[]);assert.deepEqual(await select('gel','service','Nails',{...area,country:'CA'}),[]);
 assert.deepEqual(await select('gel','service','Nails',area,'20000000-0000-0000-0000-000000000001'),[],'owner exclusion');
 await db.exec("update owner_campaigns set salon_id='10000000-0000-0000-0000-000000000008' where right(id::text,1)='9'");assert.deepEqual(await select('gel','service','Nails'),['8'],'salon dedupe');
 await db.exec("update owner_campaigns set status='paused' where right(id::text,1)='8'");assert.deepEqual(await select('gel','service','Nails'),['9'],'paused excluded before dedupe');
 await db.exec("update owner_campaigns set ends_at=now() where right(id::text,1)='9'");assert.deepEqual(await select('gel','service','Nails'),[],'end boundary');
 const acl=(await db.query("select has_function_privilege('anon','owner_campaign_search_candidates(jsonb,text,uuid,text,text,text)','EXECUTE') anon,has_function_privilege('service_role','owner_campaign_search_candidates(jsonb,text,uuid,text,text,text)','EXECUTE') service")).rows[0];assert.equal(acl.anon,false);assert.equal(acl.service,true);
 assert.equal((await db.query('select count(*)::int n from owner_campaign_events')).rows[0].n,0,'selection never creates billable events');
 }finally{await db.close()}
});
const bundle=await build({entryPoints:['lib/campaign-search-intent.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'server',setup(b){b.onResolve({filter:/^server-only$|^@\/lib\/supabase\/server$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createSupabaseServerClient=()=>{throw Error("Unexpected client")}',loader:'js'}))}}]});
const {campaignSearchIntent}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('uses actual Explore intent routing for services, category, styles, near me, names and failed lookups',async()=>{
 const rpc=async()=>({data:{version:1,areaCandidates:[]},error:null});
 assert.deepEqual(await campaignSearchIntent('gel manicure','Milwaukee, WI',rpc),{terms:'gel manicure',kind:'service',category:'Nails',location:'Milwaukee, WI'});
 assert.deepEqual(await campaignSearchIntent('nails near me','Milwaukee, WI',rpc),{terms:'',kind:'service',category:'Nails',location:'Milwaukee, WI'});
 assert.deepEqual(await campaignSearchIntent('red nails','Milwaukee, WI',rpc),{terms:'red',kind:'style',category:'Nails',location:'Milwaukee, WI'});
 const name=await campaignSearchIntent('"First Salon"','Milwaukee, WI',async()=>({data:{version:1,areaCandidates:[],exactOriginalSalonName:true},error:null}));assert.equal(name.kind,'name');assert.equal(name.terms,'First Salon');
 assert.equal(await campaignSearchIntent('gel manicure','Milwaukee',async()=>({data:null,error:{code:'failed'}})),null);
 assert.equal(await campaignSearchIntent('Madison','',async()=>({data:{version:1,areaCandidates:[{kind:'city',label:'Madison, WI',city:'Madison',stateCode:'WI'},{kind:'city',label:'Madison, AL',city:'Madison',stateCode:'AL'}]},error:null})),null);
});
