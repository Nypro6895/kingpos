import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createRequire } from "node:module";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = {
  admin: id(1),
  owner: id(2),
  other: id(3),
  operator: id(4),
  suspended: id(5),
  salon: id(10),
  otherSalon: id(11),
};
const bootstrap = readFileSync(
  "tests/fixtures/check-writer-bootstrap.sql",
  "utf8",
)
  
  .replace(/\$\{(\w+)\}/g, (_, name) => ids[name]);
test(
  "Check Writer database: isolation, atomic issuance, unchanged payroll and audited lifecycle",
  { timeout: 120000 },
  async (t) => {
    // Optional disposable PostgreSQL target. Never accept a remote DB URL.
    let db;
    if (process.env.CHECK_WRITER_LOCAL_POSTGRES === "true") {
      const require = createRequire(import.meta.url);
      const {
        Client,
      } = require("../work/check-writer-readiness/node_modules/pg");
      const connection = {
        host: "127.0.0.1",
        port: 55478,
        user: "postgres",
        database: "check_writer_qa",
        password: "local-disposable-qa",
      };
      const admin = new Client(connection);
      await admin.connect();
      const database = "check_writer_qa_" + Date.now();
      await admin.query('create database "' + database + '"');
      await admin.end();
      db = new Client({ ...connection, database });
      await db.connect();
      db.exec = (sql) => db.query(sql);
      db.close = () => db.end();
      db.fork = async () => {
        const client = new Client({ ...connection, database });
        await client.connect();
        return client;
      };
    } else db = new PGlite();
    const value = async (sql, args = []) =>
      (await db.query(sql, args)).rows[0]?.value;
    const rpc = async (name, args = []) =>
      value(
        `select ${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as value`,
        args.map((a) => (a && typeof a === "object" ? JSON.stringify(a) : a)),
      );
    const version = () =>
      value(
        "select version as value from check_writer_settings where salon_id=$1",
        [ids.salon],
      );
    const config = {
      issuer: "Demo Salon",
      address: "100 Sample Ave",
      stock: "blank",
      stubs: { same: true, payee: [], salon: [] },
    };
    const item = {
      payee: "Demo Payee",
      amountCents: 124580,
      memo: "Payroll example",
      date: "2026-10-27",
      issuer: "Demo Salon",
      address: "100 Sample Ave",
      stock: "blank",
      stubs: { same: false, payee: ["tip"], salon: ["cash", "bonus"] },
    };
    const issue = async (
      batch,
      items = [item],
      actor = ids.owner,
      salon = ids.salon,
      hash = "hash",
    ) =>
      rpc("check_writer_issue", [
        salon,
        actor,
        id(batch),
        hash,
        await version(),
        items,
      ]);
    let first, second;
    try {
      await db.exec(
        process.env.CHECK_WRITER_LOCAL_POSTGRES === "true"
          ? bootstrap.replace(
              /create role (anon|authenticated|service_role)[^;]*;/g,
              "",
            )
          : bootstrap,
      );
      await db.exec("alter table users add column email text");
      for (const f of [
        "20261009160001_market_commerce_configuration.sql",
        "20261009180001_market_bank_billing.sql",
        "20261010210001_market_card_system.sql",
        "20261011010001_market_automatic_tax.sql",
      ])
        await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
      await db.exec(
        "create table tax_company_subscriptions (like booking_policy_subscriptions including all)",
      );
      const tax = readFileSync(
        "supabase/migrations/20261009210001_tax_company_plugin.sql",
        "utf8",
      );
      await db.exec(
        tax.slice(tax.indexOf("-- Extend the existing audited bank")),
      );
      await db.exec(
        readFileSync(
          "supabase/migrations/20261011120001_tax_company_card_bridge.sql",
          "utf8",
        ),
      );
      await db.exec(`create table payroll_runs(id uuid primary key,salon_id uuid,period_start date,period_end date,version integer,status text);
    create table payroll_staff_lines(id uuid primary key,salon_id uuid,payroll_run_id uuid,staff_id uuid,updated_at timestamptz,final_check_amount numeric,final_cash_amount numeric,tip_amount numeric,bonus_amount numeric,gross_sales numeric,check_number text);`);
      await db.exec(
        readFileSync(
          "supabase/migrations/20261028040000_check_writer.sql",
          "utf8",
        ),
      );
      await t.test(
        "checkout stays closed at zero price with Reylumi ownership",
        async () => {
          const catalog = (
            await db.query(
              "select * from market_billing_catalog where plugin_id='print-check'",
            )
          ).rows[0];
          assert.equal(catalog.price_cents, 0);
          assert.equal(catalog.fulfillment_ready, false);
          assert.equal(catalog.publisher, "Reylumi");
          await db.query("select set_config('app.actor',$1,false)", [
            ids.owner,
          ]);
          await assert.rejects(
            rpc("market_card_reserve", [ids.salon, "print-check"]),
          );
          const def = await value(
            "select pg_get_functiondef('market_card_apply(uuid,text,text,text,text,integer,integer,text,timestamptz,timestamptz)'::regprocedure) as value",
          );
          assert.match(def, /check_writer_subscriptions/);
        },
      );
      await db.exec(
        readFileSync(
          "supabase/migrations/20261028193000_check_writer_output_and_price.sql",
          "utf8",
        ),
      );
      await t.test(
        "approved monthly price is 490 cents and fulfillment is enabled",
        async () => {
          const row = (
            await db.query(
              "select * from market_billing_catalog where plugin_id='print-check'",
            )
          ).rows[0];
          assert.equal(row.price_cents, 490);
          assert.equal(row.fulfillment_ready, true);
        },
      );
      await db.exec(
        readFileSync(
          "supabase/migrations/20261029040000_check_writer_sales_hold.sql",
          "utf8",
        ),
      );
      await t.test(
        "release hold preserves approved price but prevents card reservation",
        async () => {
          const row = (
            await db.query(
              "select * from market_billing_catalog where plugin_id='print-check'",
            )
          ).rows[0];
          assert.equal(row.price_cents, 490);
          assert.equal(row.fulfillment_ready, false);
          await assert.rejects(
            rpc("market_card_reserve", [ids.salon, "print-check"]),
          );
        },
      );
      await t.test("unpaid and cross-tenant owners cannot write", async () => {
        await assert.rejects(
          rpc("check_writer_save_settings", [
            ids.salon,
            ids.owner,
            "cipher",
            config,
            1001,
            0,
          ]),
        );
        await db.query(
          "insert into check_writer_subscriptions(salon_id,paid_until,payment_owner) values($1,now()+interval '1 day',$2)",
          [ids.salon, ids.owner],
        );
        await assert.rejects(
          rpc("check_writer_save_settings", [
            ids.salon,
            ids.other,
            "cipher",
            config,
            1001,
            0,
          ]),
        );
        await rpc("check_writer_save_settings", [
          ids.salon,
          ids.owner,
          "encrypted-bank-v1",
          config,
          1001,
          0,
        ]);
      });
      await t.test(
        "authenticated/anonymous have no direct bank, check or RPC access",
        async () => {
          for (const role of ["authenticated", "anon"]) {
            await db.exec("set role " + role);
            try {
              await assert.rejects(
                db.query("select * from check_writer_settings"),
              );
              await assert.rejects(
                rpc("check_writer_assert", [ids.salon, ids.owner, false]),
              );
            } finally {
              await db.exec("reset role");
            }
          }
        },
      );
      await t.test(
        "idempotent replay, hash mismatch and unique numbering",
        async () => {
          first = await issue(100);
          assert.equal(first.length, 1);
          assert.deepEqual(await issue(100), first);
          await assert.rejects(
            issue(100, [item], ids.owner, ids.salon, "changed"),
          );
          second = await issue(101);
          assert.equal(
            await value(
              "select number::integer as value from check_writer_checks where id=$1",
              [second[0]],
            ),
            1002,
          );
          assert.equal(
            await value(
              "select count(*)::integer as value from check_writer_checks",
            ),
            2,
          );
        },
      );
      await t.test(
        "invalid batch rolls back checks, batch reservation and number",
        async () => {
          const before = await value(
            "select next_number::integer as value from check_writer_settings",
          );
          await assert.rejects(
            issue(102, [item, { ...item, amountCents: -1 }]),
          );
          assert.equal(
            await value(
              "select next_number::integer as value from check_writer_settings",
            ),
            before,
          );
          assert.equal(
            await value(
              "select count(*)::integer as value from check_writer_batches where id=$1",
              [id(102)],
            ),
            0,
          );
        },
      );
      await db.query(
        "insert into payroll_runs values($1,$2,'2026-10-12','2026-10-25',3,'locked')",
        [id(30), ids.salon],
      );
      await db.query(
        "insert into payroll_staff_lines values($1,$2,$3,$4,'2026-10-27T12:00:00Z',1245.80,200,120,50,2000,null)",
        [id(31), ids.salon, id(30), id(32)],
      );
      const payrollItem = {
        ...item,
        source: {
          runId: id(30),
          lineId: id(31),
          staffId: id(32),
          version: 3,
          updatedAt: "2026-10-27T12:00:00Z",
          periodStart: "2026-10-12",
          periodEnd: "2026-10-25",
        },
      };
      const payrollBefore = await value(
        "select to_jsonb(p) as value from payroll_staff_lines p",
      );
      await t.test(
        "canonical payroll amounts and stub fields; payroll remains unchanged",
        async () => {
          const checks = await issue(103, [payrollItem]);
          const snapshot = await value(
            "select snapshot as value from check_writer_checks where id=$1",
            [checks[0]],
          );
          assert.equal(snapshot.payroll.check, 124580);
          assert.equal(snapshot.payroll.cash, 20000);
          assert.equal(snapshot.payroll.tip, 12000);
          assert.equal(snapshot.payroll.bonus, 5000);
          assert.equal(snapshot.payroll.gross, 200000);
          assert.equal(snapshot.bankEncrypted, "encrypted-bank-v1");
          assert.deepEqual(
            await value(
              "select to_jsonb(p) as value from payroll_staff_lines p",
            ),
            payrollBefore,
          );
          await assert.rejects(issue(104, [payrollItem]));
        },
      );
      await t.test(
        "stale payroll, changed amount and draft payroll fail closed",
        async () => {
          await assert.rejects(
            issue(105, [
              { ...payrollItem, source: { ...payrollItem.source, version: 2 } },
            ]),
          );
          await assert.rejects(
            issue(106, [{ ...payrollItem, amountCents: 100 }]),
          );
          await db.query("update payroll_runs set status='draft'");
          await assert.rejects(issue(107, [payrollItem]));
          await db.query("update payroll_runs set status='locked'");
        },
      );
      await t.test(
        "reprint reasons, void cannot print, number never reused",
        async () => {
          const event = (action, reason = "") =>
            rpc("check_writer_event", [
              ids.salon,
              ids.owner,
              first[0],
              action,
              reason,
            ]);
          await event("pdf_prepared");
          await assert.rejects(event("pdf_prepared"));
          await event("pdf_prepared", "Printer jam");
          await event("print_confirmed");
          await assert.rejects(event("void"));
          await event("void", "Wrong payee");
          await assert.rejects(event("pdf_prepared", "Retry"));
          await assert.rejects(
            rpc("check_writer_save_settings", [
              ids.salon,
              ids.owner,
              "cipher",
              config,
              1001,
              await version(),
            ]),
          );
          assert.equal(
            await value(
              "select count(*)::integer as value from check_writer_events where check_id=$1",
              [first[0]],
            ),
            4,
          );
        },
      );
      await t.test(
        "live Payroll snapshots stay inside the plugin and block overlapping or stale checks",
        async () => {
          const live = {
            ...item,
            payroll: {
              check: 124580,
              cash: 20000,
              tip: 12000,
              bonus: 5000,
              gross: 200000,
              period: "October",
            },
            source: {
              kind: "live",
              lineId: "live-" + id(33),
              runId: "live:2026-10-12:2026-10-25",
              staffId: id(33),
              updatedAt: "a".repeat(64),
              calculatedAt: new Date().toISOString(),
              periodStart: "2026-10-12",
              periodEnd: "2026-10-25",
            },
          };
          const checks = await issue(110, [live]);
          assert.equal(
            await value(
              "select payroll_line_id is null as value from check_writer_checks where id=$1",
              [checks[0]],
            ),
            true,
          );
          assert.deepEqual(
            await value(
              "select to_jsonb(p) as value from payroll_staff_lines p",
            ),
            payrollBefore,
          );
          await assert.rejects(
            issue(111, [
              {
                ...live,
                source: {
                  ...live.source,
                  periodStart: "2026-10-20",
                  periodEnd: "2026-10-31",
                },
              },
            ]),
          );
          await assert.rejects(
            issue(112, [
              {
                ...live,
                source: {
                  ...live.source,
                  staffId: id(34),
                  calculatedAt: "2020-01-01T00:00:00Z",
                },
              },
            ]),
          );
        },
      );
      await t.test(
        "lost creation recovery and cancellation block late requests",
        async () => {
          const args = [ids.salon, ids.owner, id(700)];
          await rpc("check_writer_reserve_creation", [...args, "hash"]);
          assert.equal(
            (await rpc("check_writer_recover_creation", [...args, false]))
              .status,
            "pending",
          );
          const checks = await issue(700);
          assert.deepEqual(
            (await rpc("check_writer_recover_creation", [...args, true])).ids,
            checks,
          );
          await assert.rejects(
            rpc("check_writer_recover_creation", [
              ids.otherSalon,
              ids.other,
              id(700),
              false,
            ]),
          );
          for (const n of [701, 702]) {
            if (n === 701)
              await rpc("check_writer_reserve_creation", [
                ids.salon,
                ids.owner,
                id(n),
                "hash",
              ]);
            assert.equal(
              (
                await rpc("check_writer_recover_creation", [
                  ids.salon,
                  ids.owner,
                  id(n),
                  true,
                ])
              ).status,
              "canceled",
            );
            await assert.rejects(issue(n));
            await assert.rejects(
              rpc("check_writer_reserve_creation", [
                ids.salon,
                ids.owner,
                id(n),
                "hash",
              ]),
            );
          }
        },
      );
      await t.test(
        "batch output is atomic, stale counters and repeated dispatch are rejected",
        async () => {
          const checks = await issue(710, [item, item]);
          const prepare = (ticket, expected, reason = "") =>
            rpc("check_writer_prepare_output", [
              ids.salon,
              ids.owner,
              id(ticket),
              "{" + checks.join(",") + "}",
              expected,
              reason,
            ]);
          const counts = () =>
            value(
              "select jsonb_object_agg(id,delivery_count) as value from check_writer_checks where id=any($1::uuid[])",
              [checks],
            );
          const zero = Object.fromEntries(checks.map((x) => [x, 0]));
          await assert.rejects(prepare(720, { ...zero, [checks[1]]: 99 }));
          assert.deepEqual(await counts(), zero);
          await prepare(720, zero);
          await assert.rejects(prepare(721, zero, "Second browser tab"));
          const one = Object.fromEntries(checks.map((x) => [x, 1]));
          assert.deepEqual(await counts(), one);
          await assert.rejects(prepare(721, one));
          await rpc("check_writer_dispatch_output", [
            ids.salon,
            ids.owner,
            id(720),
            "print",
          ]);
          await assert.rejects(
            rpc("check_writer_dispatch_output", [
              ids.salon,
              ids.owner,
              id(720),
              "print",
            ]),
          );
          await assert.rejects(
            rpc("check_writer_dispatch_output", [
              ids.salon,
              ids.owner,
              id(720),
              "download",
            ]),
          );
          await prepare(721, one, "Printer jam; previous paper destroyed");
          await db.query(
            "update check_writer_outputs set created_at=now()-interval '6 minutes' where id=$1",
            [id(721)],
          );
          await assert.rejects(
            rpc("check_writer_dispatch_output", [
              ids.salon,
              ids.owner,
              id(721),
              "download",
            ]),
          );
          const two = Object.fromEntries(checks.map((x) => [x, 2]));
          await prepare(722, two, "Retry expired output");
          await rpc("check_writer_event", [
            ids.salon,
            ids.owner,
            checks[0],
            "void",
            "Wrong payee",
          ]);
          await assert.rejects(
            rpc("check_writer_dispatch_output", [
              ids.salon,
              ids.owner,
              id(722),
              "download",
            ]),
          );
          await db.exec("set role authenticated");
          try {
            for (const table of [
              "check_writer_outputs",
              "check_writer_creation_requests",
            ])
              await assert.rejects(db.query("select * from " + table));
          } finally {
            await db.exec("reset role");
          }
        },
      );
      if (db.fork)
        await t.test(
          "real PostgreSQL concurrent sessions issue once and allow only one output",
          async () => {
            const clients = await Promise.all([db.fork(), db.fork()]);
            try {
              const v = await version();
              const issued = await Promise.all(
                clients.map((client) =>
                  client.query(
                    "select check_writer_issue($1,$2,$3,$4,$5,$6) as value",
                    [
                      ids.salon,
                      ids.owner,
                      id(730),
                      "concurrent",
                      v,
                      JSON.stringify([item]),
                    ],
                  ),
                ),
              );
              const checks = issued[0].rows[0].value;
              assert.deepEqual(issued[1].rows[0].value, checks);
              const attempts = await Promise.allSettled(
                clients.map((client, i) =>
                  client.query(
                    "select check_writer_prepare_output($1,$2,$3,$4,$5,$6)",
                    [
                      ids.salon,
                      ids.owner,
                      id(731 + i),
                      checks,
                      JSON.stringify({ [checks[0]]: 0 }),
                      "",
                    ],
                  ),
                ),
              );
              assert.equal(
                attempts.filter((r) => r.status === "fulfilled").length,
                1,
              );
              assert.equal(
                attempts.filter((r) => r.status === "rejected").length,
                1,
              );
              assert.equal(
                await value(
                  "select delivery_count as value from check_writer_checks where id=$1",
                  [checks[0]],
                ),
                1,
              );
            } finally {
              await Promise.all(clients.map((c) => c.end()));
            }
          },
        );
      await t.test(
        "existing card pipeline grants and revokes only verified paid access",
        async () => {
          await db.exec(`insert into platform_payment_settings(id,encrypted_config,public_config) values(true,'test','{"enabled":true,"mode":"live","accountId":"acct_demo"}');
    update market_billing_catalog set price_cents=490,fulfillment_ready=true where plugin_id='print-check';
    update check_writer_subscriptions set paid_until=null;`);
          await db.query("select set_config('app.actor',$1,false)", [
            ids.owner,
          ]);
          const purchase = await rpc("market_card_reserve", [
            ids.salon,
            "print-check",
          ]);
          assert.ok(purchase.id);
          assert.equal(purchase.snapshot.price_cents, 490);
          const apply = (amount, refunded, at) =>
            rpc("market_card_apply", [
              purchase.id,
              "sub_check_demo",
              "cus_check_demo",
              "active",
              "in_check_demo",
              amount,
              refunded,
              "pi_check_demo",
              "2030-02-01T00:00:00Z",
              at,
            ]);
          await assert.rejects(
            apply(purchase.amount_cents + 1, 0, "2030-01-01T00:00:00Z"),
          );
          await apply(purchase.amount_cents, 0, "2030-01-01T00:00:00Z");
          assert.equal(
            await value(
              "select paid_until>now() as value from check_writer_subscriptions",
            ),
            true,
          );
          await apply(
            purchase.amount_cents,
            purchase.amount_cents,
            "2030-01-02T00:00:00Z",
          );
          assert.equal(
            await value(
              "select paid_until is null as value from check_writer_subscriptions",
            ),
            true,
          );
          // A refund alone must not create a second recurring subscription.
          assert.equal(
            (await rpc("market_card_reserve", [ids.salon, "print-check"])).id,
            purchase.id,
          );
          await db.query(
            "update market_card_purchases set status='canceled',synced_at=now() where id=$1",
            [purchase.id],
          );
          const renewed = await rpc("market_card_reserve", [
            ids.salon,
            "print-check",
          ]);
          assert.notEqual(renewed.id, purchase.id);
          assert.equal(renewed.snapshot.price_cents, 490);
        },
      );
      await t.test(
        "expired access blocks issuance, retains void and history",
        async () => {
          await db.query(
            "update check_writer_subscriptions set paid_until=now()-interval '1 second'",
          );
          await assert.rejects(issue(109));
          await rpc("check_writer_event", [
            ids.salon,
            ids.owner,
            second[0],
            "void",
            "Expired subscription; retain safety controls",
          ]);
          assert.equal(
            await value(
              "select status as value from check_writer_checks where id=$1",
              [second[0]],
            ),
            "void",
          );
        },
      );
      await t.test("unlock attempts are durably rate limited", async () => {
        for (let i = 0; i < 5; i++)
          assert.equal(
            await rpc("check_writer_unlock_attempt", [ids.owner]),
            true,
          );
        assert.equal(
          await rpc("check_writer_unlock_attempt", [ids.owner]),
          false,
        );
      });
    } finally {
      await db.close();
    }
  },
);
