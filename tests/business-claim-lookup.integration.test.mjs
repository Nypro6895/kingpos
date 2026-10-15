import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('indexed claim lookup preserves ranking, normalization, visibility and grants at directory scale', { timeout: 120000 }, async () => {
  const db = new PGlite();
  try {
    const original = readFileSync('supabase/migrations/202610050006_business_claims.sql', 'utf8');
    await db.exec(`create role anon; create role authenticated;
      create table locations(id uuid primary key default gen_random_uuid(),name text,phone text,address_line1 text,address_line2 text,city text,state text,postal_code text,status text default 'active',created_at timestamptz default now());
      create table salon_settings(salon_id uuid primary key,public_discovery_enabled boolean default true,public_discovery_published_at timestamptz);
      create table salon_directory_listings(salon_id uuid primary key,claim_state text default 'unclaimed');
      create function salon_profile_public_salon_exists(uuid) returns boolean language sql stable as $$
        select exists(select 1 from locations l join salon_settings s on s.salon_id=l.id where l.id=$1 and l.status='active' and s.public_discovery_enabled
        and (l.created_at is null or l.created_at<=now()) and (s.public_discovery_published_at is null or s.public_discovery_published_at<=now())) $$;
      ${original.slice(original.indexOf('create function public.business_claim_phone'), original.indexOf('create table public.business_claim_requests'))}
      ${original.slice(original.indexOf('create function public.find_business_claim_matches'), original.indexOf('-- All grant paths')).replaceAll('public.find_business_claim_matches(', 'public.legacy_claim_matches(')}
    `);
    await db.exec(readFileSync('supabase/migrations/20261015051000_business_claim_lookup_indexes.sql','utf8'));
    const insert = async (name,phone,address,unit,city,state,extra={}) => {
      const {rows:[{id}]}=await db.query('insert into locations(name,phone,address_line1,address_line2,city,state,status,created_at) values($1,$2,$3,$4,$5,$6,$7,$8) returning id',[name,phone,address,unit,city,state,extra.status??'active',extra.created??new Date().toISOString()]);
      await db.query('insert into salon_settings values($1,$2,$3)',[id,extra.public??true,extra.published??null]);
      if(extra.directory!==false)await db.query('insert into salon_directory_listings values($1,$2)',[id,extra.claimed?'claimed':'unclaimed']);
      return id;
    };
    const main=await insert('Drayko Nails','(555) 234-6789','123 Main Street','Suite 2','Madison','WI');
    await insert('Drayko','5552346788','123 Main St','Ste 3','Madison','WI',{claimed:true});
    await insert('Nails','5552346789','456 Oak Road',null,'Madison','WI',{directory:false});
    await insert('Other Name','5552346777','123 Main St','Ste 2','Madison','WI');
    await insert('Drayko Nails East','5552346778','123 Main Street','Suite 2','Madison','AL');
    await insert('Drayko Nails West',null,null,null,'Middleton','WI');
    for(const extra of [{public:false},{status:'inactive'},{created:'2099-01-01'},{published:'2099-01-01'}])await insert('Invisible','5552346789','123 Main Street','Suite 2','Madison','WI',extra);
    const inputs=[['','','','','',''],['Drayko','','','','',''],['Drayko','','','','Madison','WI'],['Drayko Nails Deluxe','','','','Madison',''],['','+1 (555) 234-6789','','','',''],['Drayko','5552346789','123 Main St','Ste 2','Madison','WI'],['','','123 Main St','Suite 2','','WI'],['','','123 Main St','Suite 2','Madison',''],['','','123 Main St','Suite 3','Madison','WI'],['Nails','','','','Madison','WI'],['','','123 Main St','Suite 2','',''],[null,null,null,null,null,null],['ab','','','','Madison',''],['Drayko','','','','Unknown','WI']];
    for(const args of inputs){
      const {rows:[row]}=await db.query('select legacy_claim_matches($1,$2,$3,$4,$5,$6) old,find_business_claim_matches($1,$2,$3,$4,$5,$6) new',args);
      assert.deepEqual(row.new,row.old,JSON.stringify(args));
      assert.ok(row.new.every(r=>r.name!=='Invisible'));
    }
    const {rows:[rank]}=await db.query("select find_business_claim_matches('Drayko','5552346789','123 Main St','Ste 2','Madison','WI') matches");
    assert.equal(rank.matches[0].salon_id,main);assert.equal(rank.matches[0].score,100);
    // A generic/no-name input and a small city must not normalize every directory row.
    await db.exec(`insert into locations(name,phone,address_line1,city,state)
      select 'Volume Salon '||n,'212'||lpad(n::text,7,'0'),n||' Scale Avenue','City '||(n%1000),'NY' from generate_series(1,30000)n;
      insert into salon_settings(salon_id) select id from locations on conflict do nothing;
      analyze locations; analyze salon_settings;`);
    const timings=[];
    for(const args of [inputs[1],inputs[2],inputs[4],inputs[6]]){
      const started=performance.now();const {rows:[row]}=await db.query('select find_business_claim_matches($1,$2,$3,$4,$5,$6) matches',args);
      const elapsed=performance.now()-started;timings.push(Math.round(elapsed));assert.ok(elapsed<2000,`Lookup exceeded 2s: ${elapsed}ms`);
      assert.ok(Array.isArray(row.matches));assert.ok(row.matches.length<=5);
    }
    const {rows:[priv]}=await db.query("select has_function_privilege('anon','find_business_claim_matches(text,text,text,text,text,text)','execute') anon,has_function_privilege('authenticated','find_business_claim_matches(text,text,text,text,text,text)','execute') member");
    assert.equal(priv.anon,false);assert.equal(priv.member,true);
    console.log('Claim lookup at 30000 rows (ms): '+timings.join(', '));
  } finally { await db.close(); }
});
