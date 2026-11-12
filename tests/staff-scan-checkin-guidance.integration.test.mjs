import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture, id, actor } from './helpers/personal-qr-fixture.mjs';

test('Scan distinguishes missing check-in, invalid QR and multiple visits; valid check-in still connects', async () => {
 const db = await fixture();
 try {
  await db.exec(fs.readFileSync('supabase/migrations/20261110183000_staff_scan_checkin_guidance.sql', 'utf8'));
  await actor(db,100);
  const token=(await db.query('select personal_qr_workspace() data')).rows[0].data.code.split(':')[2];
  const connect=()=>db.query('select personal_qr_connect_customer($1,$2)',[id(1),token]);
  await actor(db,10);
  const before=(await db.query('select count(*) n from customer_visits')).rows[0].n;
  await assert.rejects(connect(),/No check-in found.*check in, then scan their QR code again/);
  assert.equal((await db.query('select count(*) n from customer_visits')).rows[0].n,before);
  await db.query("update personal_qr_codes set expires_at=now()-interval '1 second' where token=$1",[token]);
  await assert.rejects(connect(),/QR code is no longer valid/);
  await db.query("update personal_qr_codes set expires_at=now()+interval '1 hour' where token=$1",[token]);
  await actor(db,100);
  const entry=(await db.query("select service_relay_entry('display-a') data")).rows[0].data;
  const visit=(await db.query('select personal_qr_checkin($1,$2,$3) data',[entry,[id(20)],id(800)])).rows[0].data;
  // Simulate legacy duplicate data that the fixture normally prevents.
  await db.exec('drop index fixture_active_visit');
  await db.query('insert into customer_visits(id,salon_id,customer_id) select $1,salon_id,customer_id from customer_visits where id=$2',[id(801),visit]);
  await actor(db,10);
  await assert.rejects(connect(),/more than one active check-in.*front desk/);
  await db.query('delete from customer_visits where id=$1',[id(801)]);
  const result=await connect();
  assert.equal(result.rows[0].personal_qr_connect_customer.visitId,visit);
  await actor(db,null);
  await assert.rejects(connect(),/Staff workspace/);
 } finally { await db.close(); }
});
