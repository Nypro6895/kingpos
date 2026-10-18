import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("admin display reservations do not count unseen ads; confirmations remain atomic and idempotent", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create table users(id uuid primary key);
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    for (const name of ["202610060002_explore_advertising.sql", "202610070005_advertising_insights.sql", "202610170001_advertising_display_reservations.sql"])
      await db.exec(fs.readFileSync(`supabase/migrations/${name}`, "utf8"));
    const campaign = "10000000-0000-0000-0000-000000000001", session = "20000000-0000-0000-0000-000000000001", other = "20000000-0000-0000-0000-000000000002";
    const config = { name: "Offer", kind: "popup", enabled: true, repeat: "daily", startsAt: null, endsAt: null };
    await db.query("insert into explore_campaigns(id,config) values($1,$2)", [campaign, config]);
    const reserve = (sid = session, visitor = "visitor") => db.query("select reserve_advertising_display($1,$2,$3,'mobile','guest','/explore') token", [campaign, sid, visitor]).then(r => r.rows[0].token);
    const confirm = (token, sid = session, visitor = "visitor", cid = campaign) => db.query("select confirm_advertising_display($1,$2,$3,$4) ok", [token, sid, visitor, cid]).then(r => r.rows[0].ok);
    const count = table => db.query(`select count(*)::int n from ${table}`).then(r => r.rows[0].n);
    const token = await reserve(); assert.ok(token); assert.equal(await reserve(), token);
    assert.equal(await count("advertising_events"), 0); assert.equal(await count("explore_campaign_impressions"), 0);
    assert.equal(await reserve(other), null, "same visitor cannot reserve a second daily popup");
    assert.equal(await confirm(token, other), false); assert.equal(await confirm(token, session, "stranger"), false);
    assert.equal(await confirm(token, session, "visitor", "10000000-0000-0000-0000-000000000099"), false);
    await db.exec("update advertising_display_reservations set expires_at=now()-interval '1 second'");
    assert.equal(await confirm(token), false); assert.equal(await count("advertising_events"), 0);
    const replacement = await reserve(); assert.notEqual(replacement, token);
    assert.equal(await confirm(replacement), true); assert.equal(await confirm(replacement), true);
    assert.equal(await count("advertising_events"), 1); assert.equal(await count("explore_campaign_impressions"), 1);
    assert.equal(await reserve(), null); assert.equal(await reserve(other), null);
    const disabledToken = await reserve(other, "new visitor"); assert.ok(disabledToken);
    await db.query("update explore_campaigns set config=$1 where id=$2", [{ ...config, enabled: false }, campaign]);
    assert.equal(await confirm(disabledToken, other, "new visitor"), false); assert.equal(await count("advertising_events"), 1);
    const placement = "10000000-0000-0000-0000-000000000003", secondPlacement = "10000000-0000-0000-0000-000000000004";
    const fresh = "20000000-0000-0000-0000-000000000003";
    for (const id of [placement, secondPlacement]) await db.query("insert into explore_campaigns(id,config) values($1,$2)", [id, { ...config, kind: "placement" }]);
    await db.exec(`update advertising_settings set config='{"maxTotal":1,"maxPopups":1,"minPopupGapSeconds":60}'`);
    const reservePlacement = id => db.query("select reserve_advertising_display($1,$2,'fresh visitor','mobile','guest','/explore') token", [id, fresh]).then(r => r.rows[0].token);
    const held = await reservePlacement(placement); assert.ok(held);
    assert.equal(await reservePlacement(secondPlacement), null, "pending reservations also enforce the session cap");
    assert.equal(await count("advertising_events"), 1, "holding a slot must not inflate reports");
    assert.equal(await confirm(held, fresh, "fresh visitor", placement), true);
    assert.equal(await reservePlacement(secondPlacement), null, "confirmed view consumes exactly one slot");
    await db.exec("set role anon"); await assert.rejects(db.query("select * from advertising_display_reservations"), /permission denied/);
    await db.exec("reset role");
  } finally { await db.close(); }
});
