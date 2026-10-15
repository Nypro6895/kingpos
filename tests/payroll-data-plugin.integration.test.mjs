import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("Plugin installations are owner-only, salon-scoped, persistent and removable", async () => {
  const db = new PGlite();
  const salonA = "00000000-0000-4000-8000-000000000001";
  const salonB = "00000000-0000-4000-8000-000000000002";
  try {
    await db.exec(`
      create role authenticated;
      create table locations(id uuid primary key);
      create function current_public_user_id() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
      create function lifecycle_user_is_salon_owner(salon uuid, actor uuid, pending boolean) returns boolean language sql as $$select salon=actor$$;
      insert into locations values ('${salonA}'),('${salonB}');
    `);
    await db.exec(fs.readFileSync("supabase/migrations/202610080003_payroll_data_plugin.sql", "utf8"));
    await db.exec(`set role authenticated; select set_config('test.user','${salonA}',false);`);
    await db.query("insert into salon_market_plugins(salon_id,plugin_id) values ($1,'payroll-data-download')", [salonA]);
    await assert.rejects(db.query("insert into salon_market_plugins(salon_id,plugin_id) values ($1,'payroll-data-download')", [salonB]), /row-level security/);
    await db.exec(`select set_config('test.user','${salonB}',false);`);
    assert.equal((await db.query("select * from salon_market_plugins")).rows.length, 0);
    await db.query("delete from salon_market_plugins where salon_id=$1", [salonA]);
    await db.exec(`select set_config('test.user','${salonA}',false);`);
    assert.equal((await db.query("select * from salon_market_plugins")).rows.length, 1);
    await db.query("delete from salon_market_plugins where salon_id=$1", [salonA]);
    assert.equal((await db.query("select * from salon_market_plugins")).rows.length, 0);
    await db.exec("select set_config('test.user','',false);");
    await assert.rejects(db.query("insert into salon_market_plugins(salon_id,plugin_id) values ($1,'payroll-data-download')", [salonA]), /row-level security/);
  } finally { await db.close(); }
});
