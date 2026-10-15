import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const account='10000000-0000-0000-0000-000000000001';
const id=n=>`20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('service-only directory geocoding respects bounded scan, lease and current-source CAS',async t=>{
 const db=new PGlite();
 try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
   CREATE TABLE accounts(id uuid PRIMARY KEY,status text);INSERT INTO accounts VALUES('${account}','active');
   CREATE TABLE locations(id uuid PRIMARY KEY,account_id uuid REFERENCES accounts(id),phone text,address_line1 text,address_line2 text,
    city text,state text,postal_code text,country text,status text,latitude float8,longitude float8,geocoded_at timestamptz,
    geocoding_address_fingerprint text,geocoding_error_code text,geocoding_place_id text,geocoding_provider text,geocoding_status text);
   CREATE TABLE salon_settings(salon_id uuid PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,public_discovery_enabled boolean,public_discovery_published_at timestamptz,
    address_line1 text,address_line2 text,city text,state text,postal_code text,country text);
   CREATE TABLE salon_directory_listings(salon_id uuid PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,listing_id text UNIQUE,claim_state text);
   CREATE TABLE salon_directory_suppressions(listing_id text PRIMARY KEY,identity_key text,reason text);
   CREATE INDEX suppression_identity_idx ON salon_directory_suppressions(identity_key);
   CREATE FUNCTION directory_import_identity(text,text,text,text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT upper(btrim(coalesce($1,'')))||'|'||lower(btrim(coalesce($2,'')))||'|'||regexp_replace(coalesce($3,''),'[^0-9]','','g')||'|'||lower(btrim(coalesce($4,''))) $$;
   CREATE TABLE projection(id uuid PRIMARY KEY,latitude float8,longitude float8);
   CREATE FUNCTION sync_coords() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    INSERT INTO projection VALUES(NEW.id,NEW.latitude,NEW.longitude) ON CONFLICT(id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude;RETURN NEW;END $$;
   CREATE TRIGGER coordinate_projection AFTER UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION sync_coords();
   INSERT INTO locations(id,account_id,phone,address_line1,city,state,postal_code,country,status)
    SELECT ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${account}','2620000000','420 6th St Suite 3','Racine','WI','53403','US','active' FROM generate_series(1,300)n;
   INSERT INTO salon_settings(salon_id,public_discovery_enabled) SELECT id,true FROM locations;
   INSERT INTO salon_directory_listings SELECT id,'listing-'||id,'unclaimed' FROM locations;`);
  await db.exec(readFileSync('supabase/migrations/20261009122031_directory_geocode_worker.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009124031_directory_geocode_yield_locks.sql','utf8'));
  const snapshot=async n=>(await db.query('SELECT directory_geocode_address_snapshot($1) AS item',[id(n)])).rows[0].item;
  const claim=async(n,fp)=>(await db.query('SELECT claim_directory_geocode_job($1,$2) AS token',[id(n),fp])).rows[0].token;
  const match=fp=>({latitude:42.72667,longitude:-87.785287,fingerprint:fp,provider:'us_census',accuracy:'address_range_interpolated',matchedAddress:'420 6TH ST, RACINE, WI, 53403',tigerLineId:'77910452',side:'R'});
  const finish=async(n,fp,token,value=match(fp),reason=null)=>(await db.query('SELECT finish_directory_geocode_job($1,$2,$3,$4,$5) AS outcome',[id(n),fp,token,value,reason])).rows[0].outcome;
  const page=async after=>(await db.query('SELECT get_directory_geocode_candidates($1,99,999) AS page',[after])).rows[0].page;
  const isolated=async(name,run)=>t.test(name,async()=>{await db.exec('BEGIN');try{await run();}finally{await db.exec('ROLLBACK');}});
  await isolated('raw source scan is capped256 and cursor does not skip the eligible sixth salon',async()=>{
   const first=await page(null);assert.equal(first.scanned,256);assert.equal(first.candidates.length,5);assert.equal(first.nextAfter,id(5));assert.equal(first.hasMore,true);
   const second=await page(first.nextAfter);assert.equal(second.candidates[0].salonId,id(6));assert.equal(second.scanned,256);
   const deep=await page(id(295));assert.equal(deep.candidates.length,5);assert.equal(deep.scanned,5);assert.equal(deep.hasMore,false);
  });
  await isolated('only service role can invoke selection and mutation functions',async()=>{
   for(const role of ['anon','authenticated']){await db.exec('SAVEPOINT permission_check; SET ROLE '+role);await assert.rejects(db.query('SELECT get_directory_geocode_candidates(NULL,5,256)'),/permission denied/);await db.exec('ROLLBACK TO permission_check; RELEASE permission_check');}
   await db.exec('SET ROLE service_role');assert.equal((await page(null)).candidates.length,5);await db.exec('RESET ROLE');
  });
  await isolated('successful current fingerprint writes once and propagates projection without changing address',async()=>{
   const item=await snapshot(1);assert.equal(item.fingerprint,'420 6th st suite 3|racine|wi|53403|us');const token=await claim(1,item.fingerprint);assert.ok(token);assert.equal(await claim(1,item.fingerprint),null);
   assert.equal(await finish(1,item.fingerprint,token),'succeeded');assert.equal(await finish(1,item.fingerprint,token),'lease_lost');
   const row=(await db.query('SELECT * FROM locations WHERE id=$1',[id(1)])).rows[0];assert.equal(row.address_line1,'420 6th St Suite 3');assert.equal(row.geocoding_provider,'us_census');assert.equal(row.geocoding_address_fingerprint,item.fingerprint);
   assert.equal((await db.query('SELECT latitude FROM projection WHERE id=$1',[id(1)])).rows[0].latitude,42.72667);assert.equal(await snapshot(1),null);
  });
  await isolated('address edit, claim, hide, inactive account, suppression and owner pin make pending result stale',async()=>{
   const cases=[`UPDATE salon_settings SET address_line1='421 6th St' WHERE salon_id=$1`,
    `UPDATE salon_directory_listings SET claim_state='claimed' WHERE salon_id=$1`,
    `UPDATE salon_settings SET public_discovery_enabled=false WHERE salon_id=$1`,
    `UPDATE salon_settings SET public_discovery_published_at=now()+interval '1 day' WHERE salon_id=$1`,
    `UPDATE accounts SET status='inactive' WHERE id=(SELECT account_id FROM locations WHERE id=$1)`,
    `INSERT INTO salon_directory_suppressions SELECT listing_id,'other','removed' FROM salon_directory_listings WHERE salon_id=$1`,
    `UPDATE locations SET latitude=43,longitude=-88,geocoding_provider='maptiler' WHERE id=$1`];
   for(const statement of cases){await db.exec('SAVEPOINT change_case');const item=await snapshot(2);const token=await claim(2,item.fingerprint);await db.query(statement,[id(2)]);assert.equal(await finish(2,item.fingerprint,token),'stale');assert.equal((await db.query('SELECT status FROM directory_geocode_jobs WHERE salon_id=$1',[id(2)])).rows[0].status,'stale');await db.exec('ROLLBACK TO change_case; RELEASE change_case');}
  });
  await isolated('delete removes job; existing and partial owner coordinates are never selected or overwritten',async()=>{
   const item=await snapshot(3);const token=await claim(3,item.fingerprint);await db.query('DELETE FROM locations WHERE id=$1',[id(3)]);assert.equal(await finish(3,item.fingerprint,token),'lease_lost');
   await db.query('UPDATE locations SET latitude=43 WHERE id=$1',[id(4)]);assert.equal(await snapshot(4),null);assert.equal(await claim(4,item.fingerprint),null);
  });
  await isolated('expired lease, wrong token and malformed match cannot write coordinates',async()=>{
   const item=await snapshot(5);const token=await claim(5,item.fingerprint);
   assert.equal(await finish(5,item.fingerprint,id(99)),'lease_lost');
   for(const value of [{...match(item.fingerprint),latitude:null},{...match(item.fingerprint),latitude:'43'}, {...match(item.fingerprint),latitude:91},{...match(item.fingerprint),fingerprint:'old'}, {...match(item.fingerprint),accuracy:'rooftop'}])assert.equal(await finish(5,item.fingerprint,token,value),'invalid_match');
   assert.equal((await db.query('SELECT latitude FROM locations WHERE id=$1',[id(5)])).rows[0].latitude,null);
   await db.query("UPDATE directory_geocode_jobs SET lease_until=now()-interval '1 second' WHERE salon_id=$1",[id(5)]);assert.equal(await finish(5,item.fingerprint,token),'lease_lost');assert.notEqual(await claim(5,item.fingerprint),token);
  });
  await isolated('transient failure backs off and retries at most3; permanent mismatch stays rejected',async()=>{
   const item=await snapshot(6);let token=await claim(6,item.fingerprint);assert.equal(await finish(6,item.fingerprint,token,null,'timeout'),'retry');assert.equal(await claim(6,item.fingerprint),null);
   await db.query("UPDATE directory_geocode_jobs SET next_attempt_at=now()-interval '1 second' WHERE salon_id=$1",[id(6)]);token=await claim(6,item.fingerprint);assert.ok(token);assert.equal(await finish(6,item.fingerprint,token,null,'network'),'retry');
   await db.query("UPDATE directory_geocode_jobs SET next_attempt_at=now()-interval '1 second' WHERE salon_id=$1",[id(6)]);token=await claim(6,item.fingerprint);assert.equal(await finish(6,item.fingerprint,token,null,'timeout'),'rejected');assert.equal(await claim(6,item.fingerprint),null);
   const other=await snapshot(7);token=await claim(7,other.fingerprint);assert.equal(await finish(7,other.fingerprint,token,null,'street_name_mismatch'),'rejected');assert.equal(await claim(7,other.fingerprint),null);
  });
 } finally {await db.close();}
});
