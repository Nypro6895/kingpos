import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), manager = id(2), salon = id(10), otherSalon = id(11), staff = id(20), otherStaff = id(21), previousId = id(30);
function definition(file, name) {
  const source = readFileSync("supabase/migrations/" + file, "utf8");
  const found = source.match(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
  assert.ok(found, name); return found[0];
}
const values = { pay_type: "commission", commission_rate: 60, fixed_pay_amount: 0, check_rate: 60, tax_rate: 10, apply_tax_to_fixed_pay: true, tax_tips: false, tax_bonus: false, cash_to_tax_company: false, tax_company_enabled: true, tip_payout_method: "cash", bonus_payout_method: "check", legal_name: "Anna" };

test("item settings migration: nullable legacy fallback, exact logical save, history and authorization", { timeout: 120000 }, async t => {
  const db = new PGlite();
  const actor = async user => { await db.exec("reset role"); await db.query("select set_config('test.actor',$1,false)", [user]); await db.exec("set role authenticated"); };
  const call = async (date, data, previous, request = randomUUID()) => (await db.query("select save_owner_payroll_setting_with_notice($1,$2,$3,$4::jsonb,$5,$6,$7,false) result", [salon, staff, date, JSON.stringify(data), previous?.id ?? null, previous?.updated_at ?? null, request])).rows[0].result;
  try {
    await db.exec(`create role anon;create role authenticated;grant usage on schema public to authenticated;
      create table staff(id uuid primary key,salon_id uuid,display_name text,account_user_id uuid);
      insert into staff values('${staff}','${salon}','Anna',null),('${otherStaff}','${otherSalon}','Other',null);
      create table staff_payroll_settings(id uuid primary key default gen_random_uuid(),salon_id uuid,staff_id uuid,effective_from date,effective_to date,pay_type text,commission_rate numeric,fixed_pay_amount numeric,check_rate numeric,tax_rate numeric,apply_tax_to_fixed_pay boolean,tax_tips boolean,tax_bonus boolean,cash_to_tax_company boolean,tax_company_enabled boolean,tip_payout_method text,bonus_payout_method text,legal_name text,created_at timestamptz default now(),updated_at timestamptz default clock_timestamp());
      insert into staff_payroll_settings(id,salon_id,staff_id,effective_from,pay_type,commission_rate,fixed_pay_amount,check_rate,tax_rate,apply_tax_to_fixed_pay,tax_tips,tax_bonus,cash_to_tax_company,tax_company_enabled,tip_payout_method,bonus_payout_method,legal_name) values('${previousId}','${salon}','${staff}','2026-01-01','commission',60,0,60,10,true,false,false,false,true,'cash','check','Anna');
      create table payroll_staff_lines(id uuid primary key,payroll_run_id uuid,final_check_amount numeric,final_cash_amount numeric,tax_withheld numeric);
      insert into payroll_staff_lines values('${id(40)}','${id(41)}',540,400,60);
      create table salon_payroll_settings(salon_id uuid,cycle_type text,biweekly_anchor_date date);insert into salon_payroll_settings values('${salon}','monthly',null);
      create table payroll_live_change_history(id uuid primary key default gen_random_uuid(),salon_id uuid,staff_id uuid,staff_snapshot jsonb,source_table text,source_id uuid,period_start date,period_end date,before_values jsonb,after_values jsonb,actor_id uuid,created_at timestamptz default now());
      create table payroll_setting_save_receipts(salon_id uuid,actor_id uuid,request_id uuid,payload jsonb,result jsonb,primary key(salon_id,actor_id,request_id));
      create table captured_events(kind text,before_values jsonb,after_values jsonb,notify boolean);
      create table tax_events(salon_id uuid,action text,detail jsonb);
      create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create function payroll_live_is_owner(s uuid) returns boolean language sql stable as $$select s='${salon}'::uuid and public.current_public_user_id()='${owner}'::uuid$$;
      create function tax_event(s uuid,a text,subject uuid,d jsonb) returns void language sql as $$insert into public.tax_events values(s,a,d)$$;
      create function record_financial_input_event(s uuid,k text,day date,source uuid,b jsonb,a jsonb,n text,staff_changes jsonb default '[]',request uuid default null,notify boolean default true) returns uuid language plpgsql as $$begin insert into public.captured_events values(k,b,a,notify);return gen_random_uuid();end$$;
      create function stamp_setting() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;
      create trigger stamp_setting before update on staff_payroll_settings for each row execute function stamp_setting();`);
    const before = (await db.query("select to_jsonb(s) row from staff_payroll_settings s")).rows[0].row;
    const published = (await db.query("select to_jsonb(l) row from payroll_staff_lines l")).rows[0].row;
    await db.exec(definition("20261029100000_financial_input_history.sql", "audit_payroll_live_change"));
    await db.exec("create trigger payroll_live_setting_audit after insert or update or delete on staff_payroll_settings for each row execute function audit_payroll_live_change()");
    for (const name of ["payroll_setting_period_start", "tax_whole_period_setting_guard", "tax_setting_change_notice"]) await db.exec(definition("20261110230000_tax_period_alignment.sql", name));
    await db.exec("create trigger tax_whole_period_settings before insert or update on staff_payroll_settings for each row execute function tax_whole_period_setting_guard();create trigger tax_settings_notice after insert or update on staff_payroll_settings for each row execute function tax_setting_change_notice()");
    await db.exec(readFileSync("supabase/migrations/20261117140000_tax_item_settings.sql", "utf8"));
    await db.exec(definition("20261029101000_staff_day_financial_inputs.sql", "save_owner_payroll_setting_with_notice"));
    await db.exec(definition("20261029101000_staff_day_financial_inputs.sql", "guard_payroll_setting_direct_write"));
    await db.exec("create trigger payroll_setting_logical_save_only before insert or update or delete on staff_payroll_settings for each row execute function guard_payroll_setting_direct_write();revoke all on function save_owner_payroll_setting_with_notice(uuid,uuid,date,jsonb,uuid,timestamptz,uuid,boolean) from public,anon;grant execute on function save_owner_payroll_setting_with_notice(uuid,uuid,date,jsonb,uuid,timestamptz,uuid,boolean) to authenticated;");
    let current = before;
    await t.test("migration leaves every historical setting value and published payout unchanged", async () => {
      const after = (await db.query("select to_jsonb(s) row from staff_payroll_settings s")).rows[0].row;
      for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key], key);
      for (const key of ["show_check_to_tax_company", "show_cash_to_tax_company", "show_tip_to_tax_company", "show_bonus_to_tax_company", "tax_check", "tax_cash", "check_tax_rate", "cash_tax_rate", "tip_tax_rate", "bonus_tax_rate"]) assert.equal(after[key], null);
      assert.deepEqual((await db.query("select to_jsonb(l)-'tax_reporting_snapshot' row from payroll_staff_lines l")).rows[0].row, published);
      assert.equal((await db.query("select tax_reporting_snapshot from payroll_staff_lines")).rows[0].tax_reporting_snapshot, null);
    });
    await t.test("logical owner save persists independent flags/rates, records history, replays once and rejects stale state", async () => {
      await actor(owner);
      const input = { ...values, show_check_to_tax_company: false, show_cash_to_tax_company: true, show_tip_to_tax_company: true, show_bonus_to_tax_company: false, tax_check: true, tax_cash: false, check_tax_rate: 7.25, cash_tax_rate: 0, tip_tax_rate: 12.5, bonus_tax_rate: 0 };
      const request = randomUUID(); current = await call("2026-01-01", input, before, request);
      assert.deepEqual(await call("2026-01-01", input, before, request), current);
      for (const [key, value] of Object.entries(input)) assert.deepEqual(current[key], value, key);
      await assert.rejects(call("2026-01-01", { ...input, tax_cash: true }, before), /changed on another screen/);
      await assert.rejects(call("2026-01-01", { ...input, tax_cash: true }, before, request), /Request ID already used/);
      await db.exec("reset role");
      const audit = (await db.query("select before_values,after_values from payroll_live_change_history order by created_at desc limit 1")).rows[0];
      assert.equal(audit.after_values.show_cash_to_tax_company, true); assert.equal(audit.after_values.tax_cash, false); assert.equal(audit.after_values.check_tax_rate, 7.25);
      const events = (await db.query("select * from captured_events")).rows; assert.equal(events.length, 1); assert.equal(events[0].notify, false);
    });
    await t.test("older clients changing compensation preserve configured disclosure and rates across effective periods", async () => {
      await actor(owner); current = await call("2026-02-01", { ...values, commission_rate: 65 }, current);
      assert.equal(current.show_check_to_tax_company, false); assert.equal(current.show_cash_to_tax_company, true); assert.equal(current.tax_cash, false); assert.equal(current.cash_tax_rate, 0); assert.equal(current.check_tax_rate, 7.25);
      current = await call("2026-02-01", { ...values, commission_rate: 65, show_cash_to_tax_company: null, tax_cash: null, cash_tax_rate: null }, current);
      assert.equal(current.show_cash_to_tax_company, null); assert.equal(current.tax_cash, null); assert.equal(current.cash_tax_rate, null); assert.equal(current.show_check_to_tax_company, false);
    });
    await t.test("owner/role/salon authority, whole-period rules, validation and direct-write guard remain intact", async () => {
      await actor(manager); await assert.rejects(call("2026-03-01", values, current), /Only the Owner/);
      await actor(owner);
      await assert.rejects(db.query("select save_owner_live_payroll_setting($1,$2,$3,$4::jsonb,$5,$6)", [salon, staff, "2026-03-01", JSON.stringify(values), current.id, current.updated_at]), /permission denied/);
      await assert.rejects(call("2026-03-10", values, current), /whole payroll period/);
      for (const bad of [{ cash_tax_rate: 101 }, { tip_tax_rate: -1 }, { bonus_tax_rate: "10" }, { tax_cash: "yes" }]) await assert.rejects(call("2026-03-01", { ...values, ...bad }, current), /tax rate|payroll item|invalid input/);
      await db.exec("reset role;grant update on staff_payroll_settings to authenticated"); await actor(owner);
      await assert.rejects(db.query("update staff_payroll_settings set tax_cash=true"), /Owner settings form/);
      await db.exec("reset role"); assert.deepEqual((await db.query("select to_jsonb(l)-'tax_reporting_snapshot' row from payroll_staff_lines l")).rows[0].row, published);
    });
  } finally { await db.close(); }
});
