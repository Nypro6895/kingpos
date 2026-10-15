import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("commerce settings isolate bank details and enforce a single bounded USD configuration", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(await readFile("supabase/migrations/20261009160001_market_commerce_configuration.sql", "utf8"));
    const { rows } = await db.query("select plugin_prices, tax_bps, fee_bps from market_commerce_configuration");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].plugin_prices["booking-deposit"], 590);
    assert.equal(rows[0].tax_bps, 0);
    await assert.rejects(db.exec("update market_commerce_configuration set fee_bps=10001"));
    await assert.rejects(db.exec("update market_commerce_configuration set fixed_fee_cents=-1"));
    await assert.rejects(db.exec("update market_commerce_configuration set currency='EUR'"));
    await assert.rejects(db.exec("insert into market_commerce_configuration(id) values(false)"));
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select bank_account from public.market_commerce_configuration"), /permission denied/);
    await db.exec("reset role; set role anon");
    await assert.rejects(db.query("select bank_account from public.market_commerce_configuration"), /permission denied/);
  } finally { await db.close(); }
});
test("checkout lifecycle migration preserves existing receipt contracts and creates separate reservation identities",async()=>{
 const db=new PGlite();try{
  await db.exec("create table public.checkin_receipt_subscriptions(salon_id uuid primary key, stripe_subscription text, paid_until timestamptz); insert into public.checkin_receipt_subscriptions values(gen_random_uuid(),'sub_existing',null),(gen_random_uuid(),null,null)");
  await db.exec(await readFile('supabase/migrations/20261009170001_checkin_receipt_checkout_lifecycle.sql','utf8'));
  const {rows}=await db.query('select stripe_subscription,checkout_reference from public.checkin_receipt_subscriptions');
  assert.equal(rows.length,2);assert.equal(rows[0].stripe_subscription,'sub_existing');assert.notEqual(rows[0].checkout_reference,rows[1].checkout_reference);
 }finally{await db.close();}
});
