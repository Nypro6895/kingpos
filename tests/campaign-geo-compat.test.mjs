import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const owner='00000000-0000-0000-0000-000000000001';
const viewer='00000000-0000-0000-0000-000000000002';
const salon='10000000-0000-0000-0000-000000000001';
const post='20000000-0000-0000-0000-000000000001';
const campaign='30000000-0000-0000-0000-000000000001';
const nonce='40000000-0000-0000-0000-000000000001';
const visitor='a'.repeat(64);
const area={country:'US',state:'WI',city:'Milwaukee',zipcode:'53202',neighborhood:'East Town'};
const migration=fs.readFileSync('supabase/migrations/20261021030000_campaign_geo_alias_compat.sql','utf8');
const signatures=[
 'owner_campaign_candidates(jsonb,text,uuid)',
 'owner_campaign_search_candidates(jsonb,text,uuid,text,text,text)',
 'owner_campaign_admit_without_wallet(uuid,text,text,jsonb,uuid,uuid)',
 'owner_campaign_admit(uuid,text,text,jsonb,uuid,uuid)',
];

async function fixture(){
 const db=new PGlite();
 await db.exec(`
  create role anon;create role authenticated;create role service_role;
  create table users(id uuid primary key,email text);
  create table accounts(id uuid primary key,status text);
  create table locations(id uuid primary key,status text,account_id uuid,name text);
  create table app_notifications(id uuid primary key default gen_random_uuid(),account_id uuid,salon_id uuid,recipient_user_id uuid,recipient_kind text,notification_type text,title text,body text,href text,event_key text);
  create unique index notice_event_once on app_notifications(recipient_user_id,event_key) where event_key is not null;
  create table salon_settings(salon_id uuid,public_discovery_enabled boolean);
  create table beauty_profiles(id uuid,visibility text);
  create table bookings(id uuid primary key,customer_user_id uuid,source_reference_id uuid,source_reference_type text,status text,confirmation_status text,salon_id uuid,created_at timestamptz default now());
  create table salon_profile_looks(id uuid primary key,salon_id uuid,title text,caption text,status text,author_user_id uuid,safety_hold boolean default false,deleted_at timestamptz);
  create table salon_profile_updates(like salon_profile_looks including all);
  create table salon_profile_look_saves(id uuid primary key,user_id uuid,look_id uuid);
  create table account_post_saves(id uuid primary key,user_id uuid,source_type text,source_id uuid);
  create table salon_profile_comments(id uuid primary key,author_user_id uuid,look_id uuid,update_id uuid,beauty_post_id uuid,status text,is_salon_reply boolean);
  create table salon_profile_booking_requests(id uuid primary key,customer_user_id uuid,look_id uuid,status text);
  create table beauty_posts(like salon_profile_looks including all);
  alter table beauty_posts add column visibility text;alter table beauty_posts add column moderation_status text;
  create function lifecycle_user_is_salon_owner(uuid,uuid,boolean) returns boolean language sql as $$select $1='${salon}'::uuid and $2='${owner}'::uuid$$;
  create function post_safety_table(text) returns text language sql as $$select case $1 when 'beauty_post' then 'beauty_posts' when 'salon_profile_look' then 'salon_profile_looks' when 'salon_profile_update' then 'salon_profile_updates' end$$;
  create function current_public_user_id() returns uuid language sql as $$select null::uuid$$;
  create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table platform_admin_permissions(id uuid default gen_random_uuid(),code text unique,name text,description text,category text);
  create table platform_admin_roles(id uuid,slug text);
  create table platform_admin_role_permissions(role_id uuid,permission_id uuid,primary key(role_id,permission_id));
  create table explore_salon_documents(salon_id uuid,salon_name_search text,service_search_text text,service_category_search_text text);
  create table explore_unified_content_source(salon_id uuid,source_type text,content_id uuid,is_reference boolean,search_terms tsvector);
  insert into users values('${owner}','owner@example.invalid'),('${viewer}','viewer@example.invalid');
  insert into accounts values('${salon}','active');
  insert into locations values('${salon}','active','${salon}','Fixture Nails');
  insert into salon_settings values('${salon}',true);
 `);
 // Execute complete cumulative Campaign migrations, including real wallet and
 // settings-snapshot wrappers. Exclude only the external pg_net/cron scheduler.
 for(const file of [
  '202610080002_owner_campaigns.sql','202610080003_payroll_data_plugin.sql',
  '202610080004_campaign_market_credits.sql','20261017210000_owner_campaign_workspace.sql',
  '20261017235000_campaign_admin_operations.sql','20261018230000_campaign_admin_workspace.sql',
  '20261019170000_campaign_local_rotation.sql','20261021010000_campaign_selection_daily_cap.sql',
  '20261021020000_campaign_search_relevance.sql',
 ]) await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8'));
 await db.exec(`
  insert into salon_profile_looks values('${post}','${salon}','Red nails','Gel manicure','published','${owner}',false,null);
  insert into explore_salon_documents values('${salon}','Fixture Nails','gel manicure','Nails');
  insert into explore_unified_content_source values('${salon}','salon_profile_look','${post}',false,to_tsvector('english','red nails'));
 `);
 await db.query('select campaign_plugin_set($1,$2,true)',[salon,owner]);
 // This is the actual owner-create RPC used by the app, not a row whose geo is
 // changed after creation. Its real nested RPCs trim and retain the full names.
 await db.query(`select campaign_create_versioned(1,$1,$2,$3,'salon_profile_look',$4,'city',' Milwaukee ',' United States ',' Wisconsin ',' Milwaukee ',500,3,300,false,false)`,[campaign,salon,owner,post]);
 await db.query('select campaign_credit_fund($1,$2,$3,false)',[campaign,salon,owner]);
 await db.query('select owner_campaign_review($1,true)',[campaign]);
 await db.exec("update owner_campaigns set starts_at=now()-interval '1 day'");
 return db;
}
async function functions(db){
 return (await db.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.prosecdef,p.proconfig,p.proacl::text acl,p.proowner
  from pg_proc p where p.oid=any($1::regprocedure[]) order by p.oid`,[signatures])).rows;
}
async function state(db){
 return (await db.query(`select (select jsonb_agg(to_jsonb(c)) from owner_campaigns c) campaigns,
  (select jsonb_agg(to_jsonb(w)) from campaign_wallets w) wallets,
  (select count(*)::int from owner_campaign_events) events,
  (select jsonb_agg(to_jsonb(l) order by id) from campaign_credit_ledger l) ledger`)).rows[0];
}
async function candidates(db,geo=area,person=viewer,terms='gel',kind='service'){
 const plain=(await db.query('select id from owner_campaign_candidates($1,$2,$3)',[geo,visitor,person])).rows.map(row=>row.id);
 const search=(await db.query('select id from owner_campaign_search_candidates($1,$2,$3,$4,$5,$6)',[geo,visitor,person,terms,kind,'Nails'])).rows.map(row=>row.id);
 return {plain,search};
}
async function admit(db,geo=area,person=viewer,ticket=nonce){
 return (await db.query("select owner_campaign_admit($1,$2,'view',$3,$4,$5) ok",[campaign,visitor,geo,person,ticket])).rows[0].ok;
}
async function isolated(db,run){await db.exec('begin');try{await run()}finally{await db.exec('rollback')}}

test('cumulative Campaign SQL: geo aliases are exact, shared by selectors/admission and preserve accounting',async t=>{
 const db=await fixture();
 try{
  const beforeFunctions=await functions(db);
  await t.test('real owner create stores full names and reproduces the pre-migration miss',async()=>{
   assert.deepEqual((await db.query('select country,state,city,location,status from owner_campaigns')).rows[0],{country:'United States',state:'Wisconsin',city:'Milwaukee',location:'Milwaukee',status:'running'});
   assert.deepEqual(await candidates(db),{plain:[],search:[]});
   const initial=await state(db);assert.equal(await admit(db),false);assert.deepEqual(await state(db),initial);
   assert.deepEqual(await candidates(db,{...area,country:'United States',state:'Wisconsin'}),{plain:[campaign],search:[campaign]});
  });
  await t.test('migration changes only three geo predicates, retaining wrapper, attributes, ACLs and all rows',async()=>{
   const beforeRows=await state(db);await db.exec(migration);
   assert.deepEqual(await state(db),beforeRows,'migration does not rewrite stored geography or money');
   const after=await functions(db);
   const geo=/lower\(trim\(c\.country\)\)=lower\(trim\(p_area->>'country'\)\)[\s\S]*?lower\(trim\(c\.location\)\)=lower\(trim\(p_area->>'neighborhood'\)\)\)/g;
   for(const [index,prior] of beforeFunctions.entries()){
    const current=after[index];
    const {definition:oldDefinition,...oldAttrs}=prior;
    const {definition:newDefinition,...newAttrs}=current;
    assert.deepEqual(newAttrs,oldAttrs,prior.signature+' metadata unchanged');
    if(prior.signature.startsWith('owner_campaign_admit('))assert.equal(newDefinition,oldDefinition,'wallet wrapper byte-for-byte unchanged');
    else{
     assert.equal([...oldDefinition.matchAll(geo)].length,1);
     assert.equal(newDefinition,oldDefinition.replace(geo,'public.owner_campaign_area_matches(c,p_area)'),prior.signature+' only approved predicate changed');
    }
    assert.equal(current.prosecdef,true);assert.deepEqual(current.proconfig,['search_path=public']);
   }
   await db.exec(migration);assert.deepEqual(await functions(db),after,'idempotent retry');
   for(const signature of signatures){
    const acl=(await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service",[signature])).rows[0];
    assert.equal(acl.anon,false);assert.equal(acl.authenticated,false);
    assert.equal(acl.service,!signature.startsWith('owner_campaign_admit_without_wallet('));
   }
  });
  await t.test('US codes/full names work in both directions; rejected geography and owner create no side effects',async()=>{
   const snapshot=await state(db);
   for(const country of ['US','USA','United States','United States of America','U.S.A.']){
    for(const region of ['WI','Wisconsin',' wisconsin '])assert.deepEqual(await candidates(db,{...area,country,state:region}),{plain:[campaign],search:[campaign]});
   }
   assert.deepEqual(await candidates(db,area,viewer,'haircut'),{plain:[campaign],search:[]},'search mismatch still excludes ad');
   for(const geo of [{...area,country:'CA'},{...area,state:'IL'},{...area,city:'Madison'},{...area,country:''},{...area,state:''},{}]){
    assert.deepEqual(await candidates(db,geo),{plain:[],search:[]});assert.equal(await admit(db,geo),false);
   }
   assert.deepEqual(await candidates(db,area,owner),{plain:[],search:[]});assert.equal(await admit(db,area,owner),false);
   assert.deepEqual(await state(db),snapshot,'select/search/denials never charge or create events');
   await isolated(db,async()=>{
    await db.exec("update owner_campaigns set country='US',state='WI'");
    const full={...area,country:'United States',state:'Wisconsin'};
    assert.deepEqual(await candidates(db,full),{plain:[campaign],search:[campaign]});assert.equal(await admit(db,full),true);
   });
  });
  await t.test('country/state/city/ZIP/neighborhood remain exact at the configured level',async()=>{
   for(const [level,location,wrong] of [
    ['country','United States',{...area,country:'CA'}],
    ['state','Wisconsin',{...area,state:'IL'}],
    ['city','Milwaukee',{...area,city:'Madison'}],
    ['zipcode','53202',{...area,zipcode:'53203'}],
    ['neighborhood','East Town',{...area,neighborhood:'West Town'}],
   ])await isolated(db,async()=>{
    await db.query('update owner_campaigns set area=$1,location=$2',[level,location]);
    assert.deepEqual(await candidates(db),{plain:[campaign],search:[campaign]},level);
    assert.deepEqual(await candidates(db,wrong),{plain:[],search:[]},level+' mismatch');
    assert.equal(await admit(db,wrong),false);assert.equal(await admit(db),true,level+' admit');
   });
   await isolated(db,async()=>{
    await db.exec("update owner_campaigns set area='zipcode',location='53202-1234'");
    assert.deepEqual(await candidates(db),{plain:[],search:[]},'no SQL ZIP prefix widening');
   });
  });
  await t.test('non-US states stay exact; country aliases do not apply US state aliases abroad',async()=>{
   for(const [country,code] of [['Canada','CA'],['United Kingdom','GB'],['France','France']])await isolated(db,async()=>{
    await db.query("update owner_campaigns set country=$1,state='Washington'",[country]);
    const exact={...area,country:code,state:'Washington'},wrong={...exact,state:'WA'};
    assert.deepEqual(await candidates(db,exact),{plain:[campaign],search:[campaign]});
    assert.deepEqual(await candidates(db,wrong),{plain:[],search:[]});assert.equal(await admit(db,wrong),false);
    assert.equal(await admit(db,exact),true);
   });
   assert.equal((await db.query("select owner_campaign_geo_state('CA','Ontario')='on' ok")).rows[0].ok,false,'no unapproved Canadian province aliases');
  });
  await t.test('real wallet admission, replay, frequency and total-day caps retain original accounting',async()=>{
   await isolated(db,async()=>{
    // A one-view fixture threshold avoids depending on time since Chicago midnight.
    await db.exec("update owner_campaigns set settings_snapshot=jsonb_set(settings_snapshot,'{dailyFrequency}','1')");
    assert.equal(await admit(db),true);
    const after=await state(db);
    assert.equal(after.events,1);assert.equal(after.campaigns[0].views,1);assert.equal(after.campaigns[0].spent_cents,1);assert.equal(after.wallets[0].reserved_credits,299);
    assert.equal(await admit(db),true);assert.deepEqual(await state(db),after,'same nonce has no second charge');
    assert.equal(await admit(db,area,viewer,'40000000-0000-0000-0000-000000000002'),false);
    assert.deepEqual(await candidates(db),{plain:[],search:[]});assert.deepEqual(await state(db),after,'snapshot frequency cap retained');
   });
   await isolated(db,async()=>{
    await db.exec("update owner_campaigns set settings_snapshot=jsonb_set(settings_snapshot,'{maxAdsPerDay}','1')");
    assert.equal(await admit(db,area,viewer,'40000000-0000-0000-0000-000000000010'),true);
    const capped=await state(db);assert.deepEqual(await candidates(db),{plain:[],search:[]});assert.equal(await admit(db),false);assert.deepEqual(await state(db),capped,'total-day cap retained');
   });
   await isolated(db,async()=>{
    await db.exec('update owner_campaigns set starts_at=now()');
    assert.equal(await admit(db),true);const after=await state(db);
    assert.equal(await admit(db,area,viewer,'40000000-0000-0000-0000-000000000002'),false);assert.deepEqual(await state(db),after,'initial pacing slot retained');
   });
  });
  await t.test('unrecognized newer predicate aborts atomically without overwriting it',async()=>{
   for(const row of beforeFunctions)await db.exec(row.definition);
   const search=beforeFunctions.find(row=>row.signature.startsWith('owner_campaign_search_candidates('));
   await db.exec(search.definition.replace("c.area='state' and","c.area='state' and false and"));
   const changed=await functions(db);
   await assert.rejects(db.exec(migration),/Campaign geo compatibility: changed predicate/);
   await db.exec('rollback');assert.deepEqual(await functions(db),changed,'earlier function rewrites also rolled back');
  });
 }finally{await db.close()}
});
