import test from 'node:test';
import assert from 'node:assert/strict';
import {setupPhoneClaims,person,salon,reserve,confirm,patch} from './helpers/phone-claim-fixture.mjs';

test('second applicant uses support; incumbent access and operational data survive repeated disputes and rejected grants',async t=>{
 const db=await setupPhoneClaims();t.after(()=>db.close());await db.exec(patch());
 const s=await salon(db),owner=await person(db),challenger=await person(db);
 const first=await reserve(db,s,owner);assert.equal((await confirm(db,first)).status,'approved');
 await db.query('select set_config($1,$2,false)',['test.uid',challenger]);
 assert.equal((await db.query('select get_business_claim_mode($1) mode',[s.id])).rows[0].mode,'support');
 await assert.rejects(reserve(db,s,challenger),e=>e.code==='PCL01');
 await db.query('update booking_settings set booking_enabled=true where salon_id=$1',[s.id]);
 // Existing owner writes are deliberately outside the claim subsystem.
 await db.exec('create table owner_activity(id int primary key,account_id uuid,salon_id uuid,created_by uuid,kind text,payload jsonb)');
 await db.query(`insert into owner_activity select n,$1,$2,$3,kind,jsonb_build_object('amount',100,'note','owner data') from unnest(array['booking','customer','ticket','payment']) with ordinality as t(kind,n)`,[s.account,s.id,owner]);
 async function state(){const out={};for(const name of ['accounts','locations','account_memberships','salon_memberships','booking_settings','owner_activity','salon_directory_listings'])out[name]=(await db.query(`select * from ${name}`)).rows;return out;}
 const before=await state();
 const request=(await db.query("select request_business_claim_support($1,'I dispute ownership and provide evidence for manual review.') id",[s.id])).rows[0].id;
 assert.equal((await db.query('select status from business_claim_requests where id=$1',[request])).rows[0].status,'waiting');
 assert.deepEqual(await state(),before);
 await db.query("update business_claim_requests set status='needs_info',review_reason='Please provide evidence' where id=$1",[request]);
 await db.query("select request_business_claim_support($1,'Here is the additional evidence for the administrator.')",[s.id]);
 assert.deepEqual(await state(),before);
 // Ordinary admin approval cannot turn a dispute into a takeover of the old tenant.
 await assert.rejects(db.query("select complete_business_claim($1,$2,'Reviewed evidence')",[request,owner]),/cannot be claimed|management access/);
 assert.deepEqual(await state(),before);
 assert.equal((await db.query('select status from users where id=$1',[owner])).rows[0].status,'active');
 assert.equal((await db.query('select status from business_claim_requests where id=$1',[first.id])).rows[0].status,'approved');
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'complete_business_claim(uuid,uuid,text)','execute') allowed",[role])).rows[0].allowed,false);
 assert.equal((await db.query("select has_function_privilege('anon','get_business_claim_mode(uuid)','execute') allowed")).rows[0].allowed,false);
});
