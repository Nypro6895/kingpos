import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test(
  "personal Tax: sanitized data, owner handover, immutable history, staff custody, concurrency and storage isolation",
  { timeout: 120000 },
  async (t) => {
    const db = new PGlite({ extensions: { pgcrypto } }),
      owner = id(2),
      otherOwner = id(3),
      tax = id(4),
      successor = id(8),
      staffUser = id(6),
      stranger = id(7),
      salon = id(10),
      otherSalon = id(11),
      run = id(30),
      draft = id(31),
      staff = id(40),
      anotherStaff = id(41);
    const actor = async (user) =>
      db.query("select set_config('app.actor',$1,false)", [user]);
    const rpc = async (name, args = []) => {
      const result = await db.query(
        `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as value`,
        args,
      );
      return result.rows[0].value;
    };
    const role = () => db.exec("set role authenticated"),
      reset = () => db.exec("reset role");
    try {
      const fixture = readFileSync(
        "tests/market-bank-billing.integration.test.mjs",
        "utf8",
      );
      const setup = fixture.slice(
        fixture.indexOf("const id="),
        fixture.indexOf("test('real bank"),
      );
      await db.exec(vm.runInNewContext(`${setup}\nbootstrap`));
      await db.exec(`create schema extensions;create extension pgcrypto with schema extensions;
   alter table users add column email text,add column phone text,add column auth_user_id uuid;
   insert into users(id,status,display_name,email) values('${staffUser}','active','Anna','anna@example.test'),('${stranger}','active','Stranger','stranger@example.test'),('${successor}','active','New professional','new@example.test');
   alter table locations add column address_line1 text,add column address_line2 text,add column city text,add column state text,add column postal_code text,add column country text,add column phone text,add column account_id uuid default '${id(20)}';
   create table accounts(id uuid primary key,name text);insert into accounts values('${id(20)}','Account');
   create table staff(id uuid primary key,salon_id uuid,account_user_id uuid,user_id uuid,is_active boolean default true,display_name text);
   insert into staff values('${staff}','${salon}','${staffUser}',null,true,'Anna'),('${anotherStaff}','${otherSalon}',null,null,true,'Other employee');
   create table salon_payroll_settings(id uuid primary key default gen_random_uuid(),salon_id uuid,cycle_type text,biweekly_anchor_date date);
   insert into salon_payroll_settings(salon_id,cycle_type) values('${salon}','semi_monthly');
   create table staff_payroll_settings(id uuid primary key default gen_random_uuid(),salon_id uuid,staff_id uuid,effective_from date,effective_to date,tax_rate numeric default 10,tax_tips boolean default false,tax_bonus boolean default false,cash_to_tax_company boolean default false,commission_rate numeric default 60,check_rate numeric default 100,pay_type text default 'commission',fixed_pay_amount numeric default 0,tip_payout_method text default 'cash',bonus_payout_method text default 'check',apply_tax_to_fixed_pay boolean default true,updated_at timestamptz default now());
   create table market_card_purchases(id uuid primary key default gen_random_uuid(),plugin_id text,snapshot jsonb default jsonb_build_object());
   insert into market_card_purchases(plugin_id) values ('tax-company');
   create schema storage;grant usage on schema storage to authenticated;
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
   alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;
   create table payroll_runs(id uuid primary key,salon_id uuid,status text,period_start date,period_end date,version integer,cycle_type text);
   insert into payroll_runs values('${run}','${salon}','printed','2026-10-01','2026-10-15',1,'semi_monthly'),('${draft}','${salon}','draft','2026-11-01','2026-11-15',1,'semi_monthly');
   create table payroll_staff_lines(id uuid primary key,salon_id uuid,payroll_run_id uuid,staff_id uuid,staff_display_name_snapshot text,staff_legal_name_snapshot text,tax_company_reported_wage_gross numeric default 1350,is_mixed_rate boolean default false,tax_company_taxable_gross numeric default 1350,tax_withheld numeric default 135,final_check_amount numeric default 1215,base_check_amount numeric default 1065,cash_to_tax_company_snapshot boolean default false,tax_company_cash_amount numeric default 800,tax_tips_snapshot boolean default false,tip_amount numeric default 150,tax_bonus_snapshot boolean default false,bonus_amount numeric default 70,tip_payout_method_snapshot text default 'check',bonus_payout_method_snapshot text default 'check',tax_rate_used numeric default 10,tax_company_enabled_snapshot boolean default true,private_owner_note text default 'NOT SHARED',gross_sales numeric default 9999);
   insert into payroll_staff_lines(id,salon_id,payroll_run_id,staff_id,staff_display_name_snapshot,staff_legal_name_snapshot) values('${id(100)}','${salon}','${run}','${staff}','Anna','Anna Legal'),('${id(101)}','${salon}','${draft}','${staff}','Anna','Anna Legal');
   create table payroll_paystubs(id uuid primary key default gen_random_uuid(),salon_id uuid,payroll_run_id uuid,staff_id uuid,uploaded_by uuid,file_url_or_path text,file_name text,mime_type text,size_bytes bigint,created_at timestamptz default now(),updated_at timestamptz default now());
   alter table payroll_runs enable row level security;alter table payroll_staff_lines enable row level security;alter table payroll_paystubs enable row level security;
   grant select on payroll_runs,payroll_staff_lines to authenticated;grant select,insert,update on payroll_paystubs to authenticated;
   create policy legacy_owner_storage_delete on storage.objects for delete to authenticated using(true);`);
      for (const file of [
        "20261009160001_market_commerce_configuration.sql",
        "20261009180001_market_bank_billing.sql",
        "20261009210001_tax_company_plugin.sql",
        "20261011110001_tax_company_workspace.sql",
        "20261109230000_tax_personal_workspace.sql",
        "20261110230000_tax_period_alignment.sql",
        "20261110234500_tax_activation_handoff.sql",
      ])
        await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
      await db.exec("alter table tax_company_subscriptions add column if not exists trial_ends_at timestamptz");
      await db.exec(readFileSync("supabase/migrations/20261111020000_tax_invites_and_renewal.sql","utf8"));
      await actor(owner);
      await t.test("inline reservation captures the owner page only on INSERT and rejects non-owner/invalid destinations",async()=>{
        // Reservation internals have their own integration suite; this fixture
        // exercises the real new wrapper and INSERT trigger without a provider.
        await db.exec(`create function market_card_reserve(p_salon uuid,p_plugin text) returns jsonb language plpgsql as $body$ declare item market_card_purchases; begin select * into item from market_card_purchases where snapshot ? 'test_reservation' limit 1; if not found then insert into market_card_purchases(plugin_id,snapshot) values(p_plugin,'{"test_reservation":true}') returning * into item; end if; return to_jsonb(item); end $body$;
        create function market_card_reserve_safari(p_salon uuid,p_plugin text) returns jsonb language sql as $body$select market_card_reserve(p_salon,p_plugin)$body$;`);
        const first=await rpc('tax_card_reserve',[salon,true,'/payroll/tax-company/workspace']);
        assert.equal(first.snapshot.tax_return_path,'/payroll/tax-company/workspace');
        const recovered=await rpc('tax_card_reserve',[salon,false,'/payroll/tax-company/settings']);
        assert.equal(recovered.id,first.id);assert.equal(recovered.snapshot.tax_return_path,first.snapshot.tax_return_path);
        await assert.rejects(rpc('tax_card_reserve',[salon,false,'https://evil.test']),/Invalid Tax return/);
        await actor(tax);await assert.rejects(rpc('tax_card_reserve',[salon,false,'/payroll/tax-company/settings']),/owner/i);await actor(owner);
        await db.query('delete from market_card_purchases where id=$1',[first.id]);
      });
      await t.test("activation return target is frozen only on new Tax reservations",async()=>{
        assert.equal((await db.query("select snapshot from market_card_purchases")).rows[0].snapshot.tax_activation_setup,undefined);
        const taxPurchase=await db.query("insert into market_card_purchases(plugin_id) values('tax-company') returning snapshot");
        assert.equal(taxPurchase.rows[0].snapshot.tax_activation_setup,true);
        const other=await db.query("insert into market_card_purchases(plugin_id) values('booking-policy') returning snapshot");
        assert.equal(other.rows[0].snapshot.tax_activation_setup,undefined);
      });
      await t.test(
        "settings start only at whole payroll boundaries and notify Tax without sharing draft amounts",
        async () => {
          await assert.rejects(
            db.query(
              "insert into staff_payroll_settings(salon_id,staff_id,effective_from) values($1,$2,'2026-10-09')",
              [salon, staff],
            ),
            /whole payroll period/,
          );
          await db.query(
            "insert into staff_payroll_settings(salon_id,staff_id,effective_from) values($1,$2,'2026-10-16')",
            [salon, staff],
          );
          const notice = await db.query(
            "select detail from tax_events where action='payroll_settings_changed'",
          );
          assert.equal(notice.rows.length, 1);
          assert.equal(notice.rows[0].detail.effective_from, "2026-10-16");
          assert.equal(notice.rows[0].detail.whole_period, true);
          assert.ok(!JSON.stringify(notice.rows).includes("tax_rate"));
          await assert.rejects(
            db.query(
              "update staff_payroll_settings set effective_to='2026-10-24' where salon_id=$1",
              [salon],
            ),
            /whole payroll period boundary/,
          );
          await db.query(
            "update staff_payroll_settings set effective_to='2026-10-31' where salon_id=$1",
            [salon],
          );
          await db.exec(
            "update salon_payroll_settings set cycle_type='monthly'",
          );
          await assert.rejects(
            db.query(
              "insert into staff_payroll_settings(salon_id,staff_id,effective_from) values($1,$2,'2026-11-16')",
              [salon, staff],
            ),
            /whole payroll period/,
          );
          await db.query(
            "insert into staff_payroll_settings(salon_id,staff_id,effective_from) values($1,$2,'2026-11-01')",
            [salon, staff],
          );
          await db.exec(
            "update salon_payroll_settings set cycle_type='biweekly',biweekly_anchor_date='2026-01-02'",
          );
          await assert.rejects(
            db.query(
              "insert into staff_payroll_settings(salon_id,staff_id,effective_from) values($1,$2,'2026-01-15')",
              [salon, staff],
            ),
            /whole payroll period/,
          );
          await db.query(
            "insert into staff_payroll_settings(salon_id,staff_id,effective_from) values($1,$2,'2026-01-16')",
            [salon, staff],
          );
          await db.exec(
            "update salon_payroll_settings set cycle_type='semi_monthly',biweekly_anchor_date=null",
          );
        },
      );
      await db.exec(
        `insert into tax_company_subscriptions(salon_id,paid_until) values('${salon}',now()+interval '1 month');`,
      );
      const settings = await rpc("tax_company_settings", [
        salon,
        "salon-password-123",
        false,
      ]);
      await actor(tax);
      await role();
      const profile = await rpc("tax_save_profile", [
        "Taylor",
        "taylor@example.test",
        "",
        "Evergreen",
      ]);
      assert.equal(profile.display_name, "Taylor");
      assert.equal(
        (await db.query("select * from tax_profiles")).rows.length,
        1,
      );
      await assert.rejects(
        db.query(
          `insert into tax_profiles(user_id,display_name,contact_email)values('${stranger}','Bad','bad@example.test')`,
        ),
        /permission denied/,
      );
      await reset();
      await rpc("tax_company_connect", [
        settings.login_id,
        "salon-password-123",
      ]);
      await t.test("owner invitations resume independently, redeem once and respect revocation/expiry/entitlement",async()=>{
        await actor(owner);const invitation=await rpc('tax_create_invitation',[salon]);
        assert.match(invitation.token,/^[0-9a-f]{64}$/);
        assert.notEqual((await db.query('select token_hash from tax_invitations')).rows[0].token_hash,invitation.token);
        await actor(stranger);await assert.rejects(rpc('tax_accept_invitation',[invitation.token]),/Activate your Tax profile/);
        await actor(tax);await role();
        await assert.rejects(db.query('select * from tax_invitations'),/permission denied/);
        assert.equal((await rpc('tax_invitation_preview',[invitation.token])).salon_id,salon);
        assert.equal(await rpc('tax_accept_invitation',[invitation.token]),salon);
        assert.equal(await rpc('tax_accept_invitation',[invitation.token]),salon);
        await reset();await actor(successor);await assert.rejects(rpc('tax_invitation_preview',[invitation.token]),/unavailable/);
        await actor(owner);const pending=await rpc('tax_create_invitation',[salon]);
        await db.query("update tax_company_subscriptions set paid_until=now()-interval '1 second' where salon_id=$1",[salon]);
        await actor(tax);assert.equal((await rpc('tax_invitation_preview',[pending.token])).active,false);
        await assert.rejects(rpc('tax_accept_invitation',[pending.token]),/owner needs to renew/);
        await db.query("update tax_company_subscriptions set paid_until=now()+interval '1 month' where salon_id=$1",[salon]);
        await db.query('update tax_company_credentials set generation=generation+1 where salon_id=$1',[salon]);
        await assert.rejects(rpc('tax_accept_invitation',[pending.token]),/unavailable/);
        await db.query('update tax_company_credentials set generation=generation-1 where salon_id=$1',[salon]);
        await actor(owner);await rpc('tax_revoke_invitation',[salon]);await actor(tax);await assert.rejects(rpc('tax_accept_invitation',[pending.token]),/unavailable/);
        await actor(owner);const expired=await rpc('tax_create_invitation',[salon]);await db.exec("update tax_invitations set expires_at=now()-interval '1 second' where accepted_by is null");
        await actor(tax);await assert.rejects(rpc('tax_accept_invitation',[expired.token]),/unavailable/);
        await assert.rejects(rpc('tax_create_invitation',[salon]),/owner access/);
      });
      await t.test(
        "expiry keeps only a paused business label; renewal restores it and revoked generations reveal nothing",
        async () => {
          await db.query(
            "update tax_company_subscriptions set paid_until=now()-interval '1 second' where salon_id=$1",
            [salon],
          );
          const list = await rpc("tax_businesses");
          assert.equal(list.length, 1);
          assert.equal(list[0].active, false);
          assert.equal(list[0].id, salon);
          assert.equal(list[0].pending_count, null);
          assert.equal(list[0].missing_paystubs, null);
          assert.match(list[0].inactive_reason, /renew/);
          await assert.rejects(rpc("tax_workspace_data", [salon]), /inactive/);
          await db.query(
            "update tax_company_credentials set generation=generation+1 where salon_id=$1",
            [salon],
          );
          assert.deepEqual(await rpc("tax_businesses"), []);
          await db.query(
            "update tax_company_credentials set generation=generation-1 where salon_id=$1",
            [salon],
          );
          await db.query(
            "update tax_company_subscriptions set paid_until=now()+interval '1 month' where salon_id=$1",
            [salon],
          );
          assert.equal((await rpc("tax_businesses"))[0].active, true);
          assert.equal(
            (await rpc("tax_workspace_data", [salon])).lines.length,
            1,
          );
        },
      );
      await t.test(
        "report returns only permitted published fields; raw payroll is denied",
        async () => {
          await role();
          const report = await rpc("tax_workspace_data", [salon]);
          assert.equal(report.runs.length, 1);
          assert.equal(report.lines.length, 1);
          assert.equal(report.people.length, 1);
          assert.equal(report.people[0].id, staff);
          assert.ok(!report.people.some((p) => p.id === anotherStaff));
          assert.equal(report.lines[0].cash_reported, null);
          assert.equal(report.lines[0].tip, null);
          assert.equal(report.lines[0].bonus, null);
          assert.ok(!JSON.stringify(report).includes("NOT SHARED"));
          assert.ok(!JSON.stringify(report).includes("9999"));
          assert.equal(
            (await db.query("select * from payroll_staff_lines")).rows.length,
            0,
          );
          assert.equal(
            (await db.query("select * from payroll_runs")).rows.length,
            0,
          );
          await reset();
          await actor(otherOwner);
          await assert.rejects(rpc("tax_workspace_data", [salon]), /inactive/);
          await actor(tax);
        },
      );
      await t.test(
        "taxable cash tips remain reported without sharing wage cash",
        async () => {
          await db.exec(
            `update payroll_staff_lines set tax_tips_snapshot=true,tip_payout_method_snapshot='cash',tax_company_cash_amount=150 where payroll_run_id='${run}'`,
          );
          const report = await rpc("tax_workspace_data", [salon]);
          assert.equal(report.lines[0].cash_reported, 150);
          assert.equal(report.lines[0].tip_method, "cash");
          await db.exec(
            `update payroll_staff_lines set tax_tips_snapshot=false,tip_payout_method_snapshot='check',tax_company_cash_amount=800 where payroll_run_id='${run}'`,
          );
        },
      );
      await t.test(
        "published reported breakdown handles historical partial tip inclusion without inventing a zero tax rate",
        async () => {
          await db.query(
            "update payroll_staff_lines set tax_tips_snapshot=true,tip_amount=200,tax_company_reported_wage_gross=1350,tax_company_taxable_gross=1450,is_mixed_rate=true,tax_rate_used=0 where payroll_run_id=$1",
            [run],
          );
          const report = await rpc("tax_workspace_data", [salon]);
          assert.equal(report.lines[0].reported_wage, 1350);
          assert.equal(report.lines[0].tip, 100);
          assert.equal(report.lines[0].tax_rate, null);
          assert.equal(report.lines[0].mixed_settings, true);
          await db.query(
            "update payroll_staff_lines set tax_bonus_snapshot=true,bonus_amount=70,tax_company_taxable_gross=1520 where payroll_run_id=$1",
            [run],
          );
          const bonus = (await rpc("tax_workspace_data", [salon])).lines[0];
          assert.equal(bonus.tip, 100);
          assert.equal(bonus.bonus, 70);
          assert.equal(
            bonus.reported_wage + bonus.tip + bonus.bonus,
            bonus.reported_gross,
          );
          await db.query(
            "update payroll_staff_lines set tax_tips_snapshot=false,tip_amount=150,tax_company_taxable_gross=1350,tax_bonus_snapshot=false,is_mixed_rate=false,tax_rate_used=10 where payroll_run_id=$1",
            [run],
          );
        },
      );
      const upload = async ({
        supersedes = null,
        runId = run,
        staffId = staff,
        kind = "paystub",
        share = false,
      } = {}) => {
        const reservation = await rpc("tax_begin_upload", [
          salon,
          kind,
          staffId,
          runId,
          "paystub.pdf",
          "application/pdf",
          500,
          supersedes,
          share,
        ]);
        await role();
        await db.query(
          "insert into storage.objects(bucket_id,name)values($1,$2)",
          ["payroll-paystubs", reservation.path],
        );
        await reset();
        return {
          doc: await rpc("tax_finish_upload", [reservation.id]),
          reservation,
        };
      };
      const first = await upload();
      let second;
      await t.test(
        "upload retains old file, delivers staff ownership and keeps My Pay current",
        async () => {
          second = await upload({ supersedes: first.doc.id });
          assert.equal(second.doc.version, 2);
          assert.equal(
            (
              await db.query(
                "select archived_at from tax_documents where id=$1",
                [first.doc.id],
              )
            ).rows[0].archived_at !== null,
            true,
          );
          assert.equal(
            (await db.query("select file_url_or_path from payroll_paystubs"))
              .rows[0].file_url_or_path,
            second.reservation.path,
          );
          assert.equal(
            (await db.query("select count(*)::int n from storage.objects"))
              .rows[0].n,
            2,
          );
          assert.deepEqual(
            await rpc("tax_finish_upload", [second.reservation.id]),
            second.doc,
            "completion is idempotent",
          );
          await role();
          await assert.rejects(
            db.query("delete from tax_documents"),
            /permission denied/,
          );
          await db.query("delete from storage.objects where name=$1", [
            first.reservation.path,
          ]);
          await reset();
          assert.equal(
            (await db.query("select count(*)::int n from storage.objects"))
              .rows[0].n,
            2,
            "restrictive policy defeats legacy permissive deletion",
          );
        },
      );
      await t.test(
        "cross-business, draft and stale uploads/statuses fail",
        async () => {
          await assert.rejects(upload({ runId: draft }), /published payroll/);
          await assert.rejects(
            upload({ staffId: anotherStaff }),
            /another business/,
          );
          await assert.rejects(upload({ supersedes: first.doc.id }), /Refresh/);
          const status = await rpc("tax_set_work", [
            salon,
            run,
            staff,
            "reviewed",
            0,
          ]);
          assert.equal(status.version, 1);
          await assert.rejects(
            rpc("tax_set_work", [salon, run, staff, "complete", 0]),
            /another device/,
          );
          await assert.rejects(
            rpc("tax_set_work", [salon, draft, staff, "complete", 0]),
            /Published/,
          );
        },
      );
      await rpc("tax_send_message", [
        salon,
        "Handover message",
        staff,
        run,
        null,
      ]);
      const receipt = await rpc("tax_save_receipt", [
        salon,
        "service_fee",
        "Payroll service",
        35000,
        "2026-11-06",
        "received",
        second.doc.id,
        id(600),
      ]);
      assert.equal(receipt.amount_cents, 35000);
      assert.equal(
        (
          await rpc("tax_save_receipt", [
            salon,
            "service_fee",
            "Payroll service",
            35000,
            "2026-11-06",
            "received",
            second.doc.id,
            id(600),
          ])
        ).id,
        receipt.id,
        "receipt replay is idempotent",
      );
      await t.test(
        "owner sees all history; successor resumes it and revoked operator sees nothing",
        async () => {
          await actor(owner);
          const before = await rpc("tax_workspace_data", [salon]);
          assert.equal(before.documents.length, 2);
          assert.equal(before.messages[0].body, "Handover message");
          await rpc("tax_company_settings", [
            salon,
            "replacement-password-123",
            false,
          ]);
          await actor(tax);
          await role();
          assert.equal(
            (await db.query("select * from tax_documents")).rows.length,
            0,
          );
          assert.equal(
            (await db.query("select * from tax_messages")).rows.length,
            0,
          );
          assert.equal(
            (await db.query("select * from storage.objects")).rows.length,
            0,
          );
          await assert.rejects(rpc("tax_workspace_data", [salon]), /inactive/);
          await assert.rejects(
            rpc("tax_finish_upload", [second.reservation.id]),
            /unavailable/,
          );
          await reset();
          await actor(successor);
          await rpc("tax_save_profile", [
            "Successor",
            "new@example.test",
            "",
            "",
          ]);
          await rpc("tax_company_connect", [
            settings.login_id,
            "replacement-password-123",
          ]);
          const inherited = await rpc("tax_workspace_data", [salon]);
          assert.equal(inherited.documents.length, 2);
          assert.equal(inherited.receipts.length, 1);
          assert.equal(inherited.messages[0].body, "Handover message");
          assert.equal(inherited.lines[0].work_status, "reviewed");
          await assert.rejects(
            rpc("tax_owner_delete_document", [second.doc.id]),
            /owner access/,
          );
        },
      );
      await t.test(
        "staff keeps current/archive after termination, revocation and owner removal",
        async () => {
          await actor(owner);
          await rpc("tax_owner_delete_document", [second.doc.id]);
          await db.exec(
            `update staff set is_active=false,account_user_id=null where id='${staff}';`,
          );
          await actor(staffUser);
          await role();
          const docs = (await db.query("select * from tax_documents")).rows;
          assert.equal(docs.length, 2);
          assert.ok(docs.some((d) => d.archived_at));
          assert.equal(
            (await db.query("select * from tax_messages")).rows.length,
            0,
          );
          assert.equal(
            (await db.query("select * from tax_receipts")).rows.length,
            0,
          );
          assert.equal(
            (await db.query("select * from storage.objects")).rows.length,
            2,
          );
          assert.equal(await rpc("tax_document_access", [second.doc.id]), true);
          await reset();
          await actor(stranger);
          await role();
          assert.equal(
            (await db.query("select * from tax_documents")).rows.length,
            0,
          );
          assert.equal(
            (await db.query("select * from storage.objects")).rows.length,
            0,
          );
          await reset();
        },
      );
      await t.test(
        "the owner removal also blocks legacy raw storage paths for the new tax operator",
        async () => {
          await actor(successor);
          await role();
          assert.equal(
            (
              await db.query("select * from storage.objects where name=$1", [
                second.reservation.path,
              ])
            ).rows.length,
            0,
          );
          await reset();
        },
      );
      await t.test(
        "a payroll revision arriving during upload blocks stale completion",
        async () => {
          await actor(successor);
          const reservation = await rpc("tax_begin_upload", [
            salon,
            "paystub",
            staff,
            run,
            "late.pdf",
            "application/pdf",
            500,
            null,
            false,
          ]);
          await role();
          await db.query(
            "insert into storage.objects(bucket_id,name)values($1,$2)",
            ["payroll-paystubs", reservation.path],
          );
          await reset();
          await db.exec(
            `insert into payroll_runs values('${id(33)}','${salon}','printed','2026-10-01','2026-10-15',2,'semi_monthly');`,
          );
          await assert.rejects(
            rpc("tax_finish_upload", [reservation.id]),
            /newer version/,
          );
          await assert.rejects(
            rpc("tax_set_work", [salon, run, staff, "complete", 1]),
            /newer version/,
          );
        },
      );
    } finally {
      await db.close();
    }
  },
);
