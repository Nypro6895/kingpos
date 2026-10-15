import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { setup, device, ip, uuid, hash } from "./fixtures/abuse-prevention-db.mjs";

const migration = fs.readFileSync("supabase/migrations/20261015190000_signup_admission_retries.sql", "utf8");
const preflight = async (db, { d = device, i = ip, email = "retry@example.test", action = "signup" } = {}) =>
  (await db.query("select abuse_preflight($1,null,$2,$3,'US',$4) result", [action, d, i, hash(`email:${email}`)])).rows[0].result;
const ticket = async (db, email, d = device, i = ip) =>
  (await db.query("select issue_abuse_signup_ticket($1,$2,$3) token", [hash(`email:${email}`), d, i])).rows[0].token;
const insert = (db, n, email, token) => db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [uuid(n, "40000000"), email, { abuse_signup_ticket: token }]);
const created = async (db, scope = "device", identifier = device) =>
  Number((await db.query("select coalesce(sum(count),0) n from abuse_counters where action='signup_created' and scope=$1 and identifier=$2 and expires_at>now()", [scope, identifier])).rows[0].n);
const pass = (db, d = device, i = ip) => db.query("insert into abuse_verification_passes(device_hash,ip_hash,expires_at) values($1,$2,now()+interval '15 minutes') on conflict(device_hash) do update set ip_hash=excluded.ip_hash,expires_at=excluded.expires_at", [d, i]);

test("challenge retries do not spend account quota; a verified signup charges once", async () => {
  const db = await setup();
  try {
    assert.equal((await preflight(db)).allowed, true);
    for (let n = 0; n < 5; n++) assert.equal((await preflight(db)).code, "security_check_required");
    assert.equal(await created(db), 0);
    const challenge = uuid(1, "20000000");
    await db.query("select create_abuse_challenge($1,$2,$3,'answer')", [challenge, device, ip]);
    assert.equal((await db.query("select verify_abuse_challenge($1,$2,$3,'answer') ok", [challenge, device, ip])).rows[0].ok, true);
    assert.equal((await preflight(db)).allowed, true);
    await insert(db, 1, "retry@example.test", await ticket(db, "retry@example.test"));
    assert.equal(await created(db), 1);
    assert.equal(await created(db, "ip", ip), 1);
    assert.equal(await created(db, "subject", hash("email:retry@example.test")), 1);
  } finally { await db.close(); }
});

test("failed Auth inserts roll back ticket consumption and all quota charges", async () => {
  const db = await setup();
  try {
    await db.exec("alter table auth.users add constraint fixture_auth_failure check (email <> 'rejected@example.test')");
    const token = await ticket(db, "rejected@example.test");
    await assert.rejects(insert(db, 1, "rejected@example.test", token), /fixture_auth_failure/);
    assert.equal(await created(db), 0);
    assert.equal(await created(db, "ip", ip), 0);
    assert.equal(await created(db, "subject", hash("email:rejected@example.test")), 0);
    assert.equal((await db.query("select consumed_at from abuse_signup_tickets where token=$1", [token])).rows[0].consumed_at, null);
    await db.exec("alter table auth.users drop constraint fixture_auth_failure");
    await insert(db, 1, "rejected@example.test", token);
    assert.equal(await created(db), 1);
    await assert.rejects(insert(db, 2, "rejected@example.test", token), /signup page/);
    assert.equal(await created(db), 1);
  } finally { await db.close(); }
});

test("parallel submissions cannot exceed three accounts and verification does not override quotas", async () => {
  const db = await setup();
  try {
    await pass(db);
    const tickets = await Promise.all(Array.from({ length: 10 }, (_, n) => ticket(db, `parallel${n}@example.test`)));
    const results = await Promise.allSettled(tickets.map((token, n) => insert(db, n + 1, `parallel${n}@example.test`, token)));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 3);
    assert.equal(await created(db), 3);
    assert.equal(await created(db, "ip", ip), 3);
    assert.equal((await preflight(db)).code, "rate_limited");
    assert.equal(Number((await db.query("select count(*) n from abuse_signup_tickets where consumed_at is not null")).rows[0].n), 3);
  } finally { await db.close(); }
});

test("the original network and email account caps hold across fresh devices", async () => {
  const db = await setup();
  try {
    for (let n = 0; n < 20; n++) {
      const email = `network${n}@example.test`;
      await insert(db, n + 1, email, await ticket(db, email, hash(`network-device:${n}`)));
    }
    await assert.rejects(insert(db, 21, "network20@example.test", await ticket(db, "network20@example.test", hash("network-device:20"))), /creation limit/);
    assert.equal(await created(db, "ip", ip), 20);
    assert.equal(await created(db, "device", hash("network-device:20")), 0);
    assert.equal((await preflight(db, { d: hash("network-device:21") })).code, "rate_limited");

    for (let n = 0; n < 5; n++) await insert(db, n + 100, "shared@example.test", await ticket(db, "shared@example.test", hash(`email-device:${n}`), hash(`email-ip:${n}`)));
    await assert.rejects(insert(db, 106, "shared@example.test", await ticket(db, "shared@example.test", hash("email-device:6"), hash("email-ip:6"))), /creation limit/);
    assert.equal(await created(db, "subject", hash("email:shared@example.test")), 5);
  } finally { await db.close(); }
});

test("separate device, network and email request flood limits still apply", async () => {
  const db = await setup();
  try {
    await pass(db);
    for (let n = 0; n < 30; n++) assert.equal((await preflight(db, { email: `flood${n}@example.test` })).allowed, true);
    assert.equal((await preflight(db, { email: "flood31@example.test" })).code, "rate_limited");
    assert.equal(await created(db), 0);

    const subjectDevice = hash("subject-device"), subjectIP = hash("subject-ip");
    await pass(db, subjectDevice, subjectIP);
    for (let n = 0; n < 15; n++) assert.equal((await preflight(db, { d: subjectDevice, i: subjectIP, email: "subject@example.test" })).allowed, true);
    assert.equal((await preflight(db, { d: subjectDevice, i: subjectIP, email: "subject@example.test" })).code, "rate_limited");

    const sharedIP = hash("flood-network");
    for (let n = 0; n < 200; n++) assert.equal((await preflight(db, { d: hash(`flood-device:${n}`), i: sharedIP, email: `networkflood${n}@example.test` })).allowed, true);
    assert.equal((await preflight(db, { d: hash("flood-device:201"), i: sharedIP, email: "networkflood201@example.test" })).code, "rate_limited");
    assert.equal(await created(db, "ip", sharedIP), 0);
    assert.ok(Number((await db.query("select count(*) n from abuse_events where reason='Request rate exceeded'")).rows[0].n) >= 3);
  } finally { await db.close(); }
});

test("tickets retain expiry, identity binding, replay and post-issuance bans", async () => {
  const db = await setup();
  try {
    const token = await ticket(db, "bound@example.test");
    await assert.rejects(insert(db, 1, "other@example.test", token), /signup page/);
    await assert.rejects(insert(db, 1, "bound@example.test", uuid(88)), /signup page/);
    await db.query("update abuse_signup_tickets set expires_at=now()-interval '1 second' where token=$1", [token]);
    await assert.rejects(insert(db, 1, "bound@example.test", token), /signup page/);
    const bannedToken = await ticket(db, "banned@example.test");
    await pass(db);
    await db.query("insert into abuse_restrictions(scope,identifier,mode,reason,expires_at) values('ip',$1,'deny','Fixture ban',now()+interval '1 hour')", [ip]);
    await assert.rejects(insert(db, 2, "banned@example.test", bannedToken), /temporarily restricted/);
    assert.equal((await preflight(db)).code, "restricted");
    assert.equal(await created(db), 0);
    assert.equal((await db.query("select consumed_at from abuse_signup_tickets where token=$1", [bannedToken])).rows[0].consumed_at, null);
  } finally { await db.close(); }
});

test("migration carries forward successful legacy signups, active tickets and unchanged ACLs", async () => {
  const db = await setup({ signupRetryMigration: false });
  try {
    const privileges = async () => (await db.query("select proname,proacl::text from pg_proc where pronamespace='public'::regnamespace and proname in ('abuse_preflight','abuse_guard_signup','issue_abuse_signup_ticket') order by proname")).rows;
    const before = await privileges();
    for (let n = 0; n < 2; n++) await insert(db, n + 1, `legacy${n}@example.test`, await ticket(db, `legacy${n}@example.test`));
    const active = await ticket(db, "legacy-active@example.test");
    await preflight(db);
    await db.exec(migration);
    assert.deepEqual(await privileges(), before);
    assert.equal(await created(db), 2);
    assert.equal(await created(db, "ip", ip), 2);
    assert.equal((await preflight(db)).challengeRequired, true);
    await insert(db, 3, "legacy-active@example.test", active);
    assert.equal(await created(db), 3);
    await db.exec(migration);
    assert.equal(await created(db), 3);
    assert.equal((await preflight(db)).code, "rate_limited");
    assert.equal((await preflight(db, { action: "login" })).allowed, true);
    assert.equal((await preflight(db, { action: "recovery" })).allowed, true);
  } finally { await db.close(); }
});
