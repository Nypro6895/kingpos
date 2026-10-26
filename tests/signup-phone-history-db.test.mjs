import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const old=readFileSync('supabase/migrations/202608100003_customer_identity_claims.sql','utf8');
function fn(name){const start=old.indexOf(`create or replace function public.${name}(`);assert.ok(start>=0);return old.slice(start,old.indexOf('$$;',start)+3);}
async function fixture(){
 const db=new PGlite();
 await db.exec(`
  create role anon; create role authenticated;
  create table users(id uuid primary key,status text default 'active',display_name text);
  create table locations(id uuid primary key,name text);
  create table customers(id uuid primary key,location_id uuid references locations,name text,phone text,
    customer_user_id uuid references users,customer_account_claimed_at timestamptz,
    customer_account_claim_method text,customer_account_claim_metadata jsonb default '{}',updated_at timestamptz default now());
  create table customer_verified_phones(id uuid primary key default gen_random_uuid(),user_id uuid references users,
    normalized_phone text unique,verified_at timestamptz default now(),verification_method text,last_claimed_at timestamptz);
  create table customer_account_claims(salon_id uuid,customer_id uuid references customers,customer_user_id uuid,
    claim_method text,proof_type text,claim_status text,metadata jsonb,unique(customer_id,customer_user_id,claim_method));
  create table customer_claim_tokens(id uuid primary key,token_hash text,customer_id uuid,revoked_at timestamptz,
    used_at timestamptz,expires_at timestamptz,claimed_by_user_id uuid,metadata jsonb default '{}');
  create table customer_visits(id uuid primary key,customer_id uuid references customers,checked_in_at timestamptz default now());
  create table pos_tickets(id uuid primary key,customer_id uuid references customers,total numeric);
  create function current_public_user_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
  create function customer_name_key(value text) returns text language sql immutable as $$select regexp_replace(lower(btrim(coalesce(value,''))),'[^[:alnum:]]+','','g')$$;
  create function customer_claim_token_hash(value text) returns text language sql immutable as $$select md5(value)$$;
  insert into users values('${id(1)}','active','Mary'),('${id(2)}','active','Other');
  insert into locations values('${id(10)}','First salon'),('${id(11)}','Second salon');
  select set_config('test.actor','${id(1)}',false);
 `);
 for(const name of ['normalize_customer_claim_phone','record_customer_verified_phone_for_claim',
  'claim_customers_for_verified_phone_internal','auto_link_customer_to_verified_phone','claim_customers_for_verified_phone','claim_customer_from_token']) await db.exec(fn(name));
 await db.exec(`create trigger auto_link_customer_to_verified_phone before insert or update of phone,customer_user_id on customers for each row execute function auto_link_customer_to_verified_phone()`);
 await db.exec(readFileSync('supabase/migrations/20261025110000_signup_phone_history.sql','utf8'));
 return db;
}
test('signup history uses verified phone, selects shared names atomically and preserves visits',async t=>{
 const db=await fixture();
 const phone='+15035550100';
 const rpc=async(name,args=[])=>{const params=args.map((_,i)=>`$${i+1}`).join(',');return(await db.query(`select ${name}(${params}) result`,args)).rows[0].result;};
 const add=async(n,name,p=phone,owner=null,salon=10)=>db.query('insert into customers(id,location_id,name,phone,customer_user_id) values($1,$2,$3,$4,$5)',[id(n),id(salon),name,p,owner]);
 const owner=async n=>(await db.query('select customer_user_id from customers where id=$1',[id(n)])).rows[0].customer_user_id;
 try{
  await add(20,'Mary');await add(21,'MARY', '5035550100',null,11);
  await t.test('typing a phone cannot reveal or claim history before verification',async()=>{
   assert.equal((await rpc('get_my_phone_history_profiles',[phone])).ok,false);
   assert.equal((await rpc('claim_selected_phone_history',[phone,[id(20)]])).ok,false);
   assert.equal(await owner(20),null);
  });
  await rpc('record_customer_verified_phone_for_claim',[id(1),phone,'auth_phone']);
  await t.test('one identity automatically receives history across salons without moving records',async()=>{
   await db.query('insert into customer_visits values($1,$2,now());',[id(100),id(20)]);
   await db.query('insert into pos_tickets values($1,$2,75);',[id(101),id(21)]);
   const result=await rpc('claim_customers_for_verified_phone',[phone]);assert.equal(result.linkedCount,2);
   assert.equal(await owner(20),id(1));assert.equal(await owner(21),id(1));
   assert.equal((await db.query('select total from pos_tickets')).rows[0].total,'75');
   assert.equal((await rpc('claim_customers_for_verified_phone',[phone])).linkedCount,0);
  });
  await add(22,'David');await add(23,'David',phone,null,11);
  await t.test('new unrelated names sharing the verified phone remain unclaimed',async()=>{
   assert.equal(await owner(22),null);assert.equal(await owner(23),null);
   const result=await rpc('claim_customers_for_verified_phone',[phone]);assert.equal(result.selectionRequired,true);assert.equal(result.linkedCount,0);
   assert.equal(await owner(22),null);
  });
  await add(24,'Mary',phone,id(2));await add(25,'Not mine','5035550101');
  await t.test('choices exclude another account and other phone numbers',async()=>{
   const result=await rpc('get_my_phone_history_profiles',[phone]);
   assert.equal(result.profiles.length,4);assert.ok(result.profiles.every(row=>!['Not mine'].includes(row.name)));
   assert.ok(!result.profiles.some(row=>row.id===id(24)));
  });
  await t.test('a mixed invalid selection claims nothing',async()=>{
   assert.equal((await rpc('claim_selected_phone_history',[phone,[id(22),id(25)]])).ok,false);assert.equal(await owner(22),null);
   assert.equal((await rpc('claim_selected_phone_history',[phone,[id(22),id(24)]])).ok,false);assert.equal(await owner(22),null);
   assert.equal((await rpc('claim_selected_phone_history',[phone,[id(22),id(999)]])).ok,false);assert.equal(await owner(22),null);
  });
  await t.test('selecting one profile leaves the other person/profile alone and retries are safe',async()=>{
   assert.equal((await rpc('claim_selected_phone_history',[phone,[id(22),id(22)]])).linkedCount,1);
   assert.equal(await owner(22),id(1));assert.equal(await owner(23),null);
   assert.equal((await rpc('claim_selected_phone_history',[phone,[id(22)]])).linkedCount,0);
  });
  await t.test('choosing several profiles combines access without deleting the originals',async()=>{
   assert.equal((await rpc('claim_selected_phone_history',[phone,[id(20),id(23)]])).linkedCount,1);
   assert.equal(await owner(23),id(1));assert.equal((await db.query('select count(*)::int n from customers')).rows[0].n,6);
  });
  await t.test('anonymous and other accounts cannot use verified phone choices',async()=>{
   await db.exec(`select set_config('test.actor','${id(2)}',false)`);
   assert.equal((await rpc('get_my_phone_history_profiles',[phone])).ok,false);
   assert.equal((await rpc('claim_selected_phone_history',[phone,[id(20)]])).ok,false);
   await db.exec(`select set_config('test.actor','',false)`);
   assert.equal((await rpc('get_my_phone_history_profiles',[phone])).ok,false);
   await db.exec(`select set_config('test.actor','${id(1)}',false)`);
   assert.equal((await db.query("select has_function_privilege('anon','public.get_my_phone_history_profiles(text)','execute') allowed")).rows[0].allowed,false);
   assert.equal((await db.query("select has_function_privilege('authenticated','public.claim_customers_for_verified_phone_before_selection(uuid,text,text)','execute') allowed")).rows[0].allowed,false);
  });
  await t.test('receipt QR claims its profile without silently claiming another shared name',async()=>{
   const p='+15035550200';await add(30,'Alice',p);await add(31,'Bob',p);
   await db.query("insert into customer_claim_tokens(id,token_hash,customer_id,expires_at) values($1,md5('receipt-token'),$2,now()+interval '30 minutes')",[id(200),id(30)]);
   const result=await rpc('claim_customer_from_token',['receipt-token']);assert.equal(result.ok,true);assert.equal(result.linkedCount,1);
   assert.equal(await owner(30),id(1));assert.equal(await owner(31),null);
  });
  await t.test('unambiguous future matching check-ins link automatically',async()=>{
   const p='+15035550300';await add(40,'Mary',p);await rpc('record_customer_verified_phone_for_claim',[id(1),p,'auth_phone']);
   await rpc('claim_customers_for_verified_phone',[p]);await add(41,'Mary',p,null,11);assert.equal(await owner(41),id(1));
  });
 }finally{await db.close();}
});
