import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setup, device, ip, uuid, hash } from "./fixtures/abuse-prevention-db.mjs";

// Optional real multi-connection test; ordinary integration tests use PGlite.
// Supply an empty disposable localhost database and a locally installed pg driver.
const databaseURL = process.env.SIGNUP_CONCURRENCY_DATABASE_URL;
test("PostgreSQL concurrent Auth transactions cannot overrun signup quotas", { skip: !databaseURL }, async () => {
  const target = new URL(databaseURL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname), "Only a disposable localhost database is allowed");
  assert.match(target.pathname, /^\/signup_admission_test(?:_\d+)?$/, "Use a dedicated signup_admission_test database");
  const require = createRequire(import.meta.url);
  const { Client } = require(process.env.SIGNUP_TEST_PG_DRIVER || "pg");
  const primary = new Client({ connectionString: databaseURL });
  await primary.connect();
  const workers = [];
  try {
    assert.equal((await primary.query("select to_regclass('auth.users') as existing")).rows[0].existing, null, "Database must be empty");
    await setup({ database: { query: (...args) => primary.query(...args), exec: sql => primary.query(sql) } });
    const tokens = [];
    for (let n = 0; n < 12; n++) tokens.push((await primary.query("select issue_abuse_signup_ticket($1,$2,$3) token", [hash(`email:race${n}@example.test`), device, ip])).rows[0].token);
    for (let n = 0; n < tokens.length; n++) {
      const client = new Client({ connectionString: databaseURL });
      await client.connect();
      workers.push(client);
    }
    await Promise.all(workers.map(client => client.query("begin")));
    const results = await Promise.all(workers.map(async (client, n) => {
      try {
        await client.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [uuid(n + 1, "50000000"), `race${n}@example.test`, { abuse_signup_ticket: tokens[n] }]);
        // Keep locks briefly so the other connections overlap the transaction.
        await client.query("select pg_sleep(0.05)");
        await client.query("commit");
        return true;
      } catch (error) {
        await client.query("rollback");
        assert.match(error.message, /Account creation limit reached/);
        return false;
      }
    }));
    assert.equal(results.filter(Boolean).length, 3);
    assert.equal(Number((await primary.query("select count(*) n from abuse_signup_tickets where consumed_at is not null")).rows[0].n), 3);
    const counts = (await primary.query("select scope,count from abuse_counters where action='signup_created' and scope in ('device','ip') order by scope")).rows;
    assert.deepEqual(counts, [{ scope: "device", count: 3 }, { scope: "ip", count: 3 }]);
  } finally {
    await Promise.all(workers.map(client => client.end()));
    await primary.end();
  }
});
