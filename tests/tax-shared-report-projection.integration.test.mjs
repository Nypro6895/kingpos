import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { calculatePayrollTaxSnapshot, mergePayrollTaxSnapshots } from "../lib/payroll-tax-settings.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner=id(1), professional=id(2), other=id(3), salon=id(10), anotherSalon=id(11), run=id(20), draft=id(21), staff=id(30), line=id(40);
const amountKeys=["gross","tax","net","check_gross","check_tax","check_net","cash_gross","cash_tax","cash_net"];
function component(gross, tax, payout_method, shown=true, applied=tax!==0, rate=applied ? 10 : null) {
  const net=Math.round((gross-tax)*100)/100, check=payout_method==="check";
  return { shown, gross, tax_applied:applied, tax_rate:rate, tax, net, payout_method,
    check_gross:check?gross:0,check_tax:check?tax:0,check_net:check?net:0,
    cash_gross:check?0:gross,cash_tax:check?0:tax,cash_net:check?0:net };
}
function snapshot(overrides={}) {
  const components={check_wage:component(600,60,"check"),cash_wage:component(400,40,"cash"),tip:component(150,15,"check"),bonus:component(50,0,"cash"),...overrides};
  const totals=Object.fromEntries(amountKeys.map(key=>[key,Object.values(components).reduce((sum,row)=>sum+Math.round(row[key]*100),0)/100]));
  return {version:1,components,totals};
}
function authFunction(file,name) {
  const sql=readFileSync(`supabase/migrations/${file}`,"utf8");
  const found=sql.match(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
  assert.ok(found, name); return found[0];
}

test("shared Tax projection: immutable components, null privacy, historical fallback and unchanged authority", {timeout:120000}, async t => {
  const db=new PGlite();
  const actor=async user=>db.query("select set_config('app.actor',$1,false)",[user]);
  const rpc=async name=>(await db.query(`select ${name}($1) as data`,[salon])).rows[0].data;
  const write=async value=>{ await db.exec("reset role"); await db.query("update payroll_staff_lines set tax_reporting_snapshot=$1 where id=$2",[value===null?null:JSON.stringify(value),line]); await db.exec("set role authenticated"); };
  try {
    await db.exec(`create role anon;create role authenticated;
      create table users(id uuid primary key,status text);
      insert into users values('${owner}','active'),('${professional}','active'),('${other}','active');
      create table locations(id uuid primary key,owner_id uuid,status text,name text,phone text,city text,state text,address_line1 text);
      insert into locations values('${salon}','${owner}','active','Salon',null,null,null,null),('${anotherSalon}','${other}','active','Other salon',null,null,null,null);
      create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('app.actor',true),'')::uuid$$;
      create function lifecycle_user_is_salon_owner(p_salon uuid,p_user uuid,p_flag boolean) returns boolean language sql stable as $$select exists(select 1 from locations where id=p_salon and owner_id=p_user)$$;
      create table tax_company_connections(salon_id uuid,user_id uuid,generation integer);
      create table tax_company_credentials(salon_id uuid,generation integer,enabled boolean);
      create table tax_company_subscriptions(salon_id uuid,paid_until timestamptz);
      create table payroll_runs(id uuid primary key,salon_id uuid,period_start date,period_end date,version integer,status text,cycle_type text);
      insert into payroll_runs values('${run}','${salon}','2026-11-01','2026-11-15',1,'printed','semi_monthly'),('${draft}','${salon}','2026-11-16','2026-11-30',2,'draft','semi_monthly');
      create table payroll_staff_lines(id uuid primary key,salon_id uuid,payroll_run_id uuid,staff_id uuid,staff_display_name_snapshot text,staff_legal_name_snapshot text,is_mixed_rate boolean default false,tax_company_reported_wage_gross numeric default 1000,tax_company_taxable_gross numeric default 1000,tax_withheld numeric default 100,final_check_amount numeric default 1100,base_check_amount numeric default 900,cash_to_tax_company_snapshot boolean default false,tax_company_cash_amount numeric default 0,tax_tips_snapshot boolean default false,tax_bonus_snapshot boolean default false,bonus_amount numeric default 50,tip_payout_method_snapshot text default 'check',bonus_payout_method_snapshot text default 'check',tax_rate_used numeric default 10,tax_company_enabled_snapshot boolean default true,tax_reporting_snapshot jsonb,private_note text default 'NEVER SHARED');
      insert into payroll_staff_lines(id,salon_id,payroll_run_id,staff_id,staff_display_name_snapshot,staff_legal_name_snapshot) values('${line}','${salon}','${run}','${staff}','Anna','Anna Legal'),('${id(41)}','${salon}','${draft}','${staff}','DRAFT HIDDEN','Hidden');
      alter table payroll_staff_lines enable row level security;
      create table tax_work_items(payroll_run_id uuid,staff_id uuid,status text,version integer);
      create table staff(id uuid,salon_id uuid,display_name text);
      insert into staff values('${staff}','${salon}','Anna');
      create table tax_documents(salon_id uuid,path text,bucket text,created_at timestamptz,owner_deleted_at timestamptz);
      create table tax_messages(salon_id uuid,created_at timestamptz,body text);
      create table tax_receipts(salon_id uuid,receipt_date date);
      create table tax_events(salon_id uuid,created_at timestamptz);
      insert into tax_messages values('${salon}',now(),'PRIVATE MESSAGE');`);
    await db.exec(authFunction("20261009210001_tax_company_plugin.sql","tax_company_has_access"));
    for(const name of ["tax_actor","tax_is_owner","tax_can_work"]) await db.exec(authFunction("20261109230000_tax_personal_workspace.sql",name));
    await db.exec(readFileSync("supabase/migrations/20261117150000_tax_shared_report_projection.sql","utf8"));
    await actor(owner); await db.exec("set role authenticated");
    await t.test("Owner needs no plugin; numeric RPC excludes all unrelated records and drafts",async()=>{
      const report=await rpc("tax_report_data");
      assert.deepEqual(Object.keys(report).sort(),["lines","runs","salon"]);
      assert.equal(report.runs.length,1);assert.equal(report.lines.length,1);
      assert.ok(!JSON.stringify(report).includes("PRIVATE"));assert.ok(!JSON.stringify(report).includes("NEVER SHARED"));assert.ok(!JSON.stringify(report).includes("DRAFT HIDDEN"));
      const full=await rpc("tax_workspace_data");
      assert.deepEqual(full.lines,report.lines);assert.deepEqual(full.runs,report.runs);assert.deepEqual(full.salon,report.salon);
      assert.equal(full.messages[0].body,"PRIVATE MESSAGE");
      await assert.rejects(db.query("select * from payroll_staff_lines"),/permission denied/);
      await assert.rejects(db.query("select tax_sanitize_report_snapshot(null)"),/permission denied/);
      await assert.rejects(db.query("select tax_project_report_line('{}','pending',0)"),/permission denied/);
    });
    await t.test("legacy headlines stay exact; component history is explicitly unavailable",async()=>{
      const value=(await rpc("tax_report_data")).lines[0];
      assert.equal(value.breakdown.state,"historical_unavailable");assert.equal(value.actual_check,1100);assert.equal(value.reported_gross,1000);assert.equal(value.tax,100);assert.equal(value.tip,null);assert.equal(value.bonus,null);
      for(const row of Object.values(value.breakdown.components)){assert.equal(row.shown,false);for(const field of amountKeys)assert.equal(row[field],null);}
    });
    await t.test("new snapshot reconciles cents and reports untaxed payouts independently of tax flags",async()=>{
      const input=snapshot({tip:component(150,0,"check"),bonus:component(50,0,"check")});
      await write(input);
      const value=(await rpc("tax_report_data")).lines[0];
      assert.equal(value.breakdown.state,"published");assert.deepEqual(value.breakdown.components,input.components);assert.deepEqual(value.breakdown.totals,input.totals);
      assert.equal(value.reported_gross,1200);assert.equal(value.reported_wage,1000);assert.equal(value.tax,100);assert.equal(value.actual_check,740);assert.equal(value.tip,150);assert.equal(value.bonus,50);assert.equal(value.cash_reported,400);
      assert.equal(value.breakdown.totals.check_net+value.breakdown.totals.cash_net+value.tax,value.reported_gross);
      await write(snapshot({check_wage:component(0.10,0,"check",true,false,0),cash_wage:component(0.20,0,"cash",true,false,0),tip:component(0,0,"check"),bonus:component(0,0,"cash")}));
      assert.equal((await rpc("tax_report_data")).lines[0].breakdown.totals.gross,0.30);
    });
    await t.test("visible Cash appears at zero rate and without taxing cash; hidden Cash and inferable totals are null",async()=>{
      await write(snapshot({cash_wage:component(400,0,"cash",true,false,0),tip:component(0,0,"check"),bonus:component(0,0,"cash")}));
      let value=(await rpc("tax_report_data")).lines[0];
      assert.equal(value.breakdown.components.cash_wage.gross,400);assert.equal(value.breakdown.components.cash_wage.net,400);assert.equal(value.cash_reported,400);
      await write(snapshot({cash_wage:component(417.83,41.78,"cash",false),tip:component(0,0,"check"),bonus:component(0,0,"cash")}));
      value=(await rpc("tax_report_data")).lines[0];
      assert.equal(value.breakdown.components.cash_wage.shown,false);
      for(const [key,amount] of Object.entries(value.breakdown.components.cash_wage))if(key!=="shown")assert.equal(amount,null,key);
      for(const key of ["gross","tax","net","cash_gross","cash_tax","cash_net"])assert.equal(value.breakdown.totals[key],null,key);
      for(const key of ["reported_wage","reported_gross","tax","cash_reported"])assert.equal(value[key],null,key);
      assert.equal(value.actual_check,540);assert.equal(value.breakdown.totals.check_gross,600);
      assert.ok(!JSON.stringify(value).includes("417.83"));assert.ok(!JSON.stringify(value).includes("376.05"));
      // Hidden zero components may not suppress independent, complete Check totals.
      await write(snapshot({cash_wage:component(0,0,"cash",false),tip:component(0,0,"check"),bonus:component(0,0,"cash")}));
      assert.equal((await rpc("tax_report_data")).lines[0].breakdown.totals.check_net,540);
    });
    await t.test("hidden Check Tip masks Check payout, while mixed channel detail reconciles without inventing a rate",async()=>{
      await write(snapshot({tip:component(177.77,0,"check",false)}));
      let value=(await rpc("tax_report_data")).lines[0];assert.equal(value.tip,null);assert.equal(value.actual_check,null);assert.equal(value.breakdown.totals.check_net,null);assert.equal(value.breakdown.totals.cash_net,410);
      const mixed={...component(100,10,"check"),payout_method:"mixed",tax_rate:null,tax_applied:null,check_gross:60,check_tax:6,check_net:54,cash_gross:40,cash_tax:4,cash_net:36};
      await write(snapshot({tip:mixed}));value=(await rpc("tax_report_data")).lines[0];
      assert.equal(value.breakdown.components.tip.payout_method,"mixed");assert.equal(value.breakdown.components.tip.tax_rate,null);assert.equal(value.breakdown.totals.check_net,594);assert.equal(value.breakdown.totals.cash_net,446);
    });
    await t.test("actual payroll engine snapshots and mixed-day merges pass the same immutable SQL projection",async()=>{
      const settings={pay_type:"commission",tax_rate:10,cash_to_tax_company:false,tax_tips:true,tax_bonus:false,tip_payout_method:"cash",bonus_payout_method:"check",show_check_to_tax_company:true,show_cash_to_tax_company:true,show_tip_to_tax_company:true,show_bonus_to_tax_company:true,tax_check:true,tax_cash:false,check_tax_rate:7.25,cash_tax_rate:0,tip_tax_rate:12.5,bonus_tax_rate:0};
      const daily=calculatePayrollTaxSnapshot(settings,1.02,3.03,4.04,5.05);
      await write(daily);let value=(await rpc("tax_report_data")).lines[0];assert.equal(value.breakdown.state,"published");assert.deepEqual(value.breakdown.components,daily.components);assert.deepEqual(value.breakdown.totals,daily.totals);
      const second=calculatePayrollTaxSnapshot({...settings,tip_payout_method:"check",tip_tax_rate:8},10.02,30.03,40.04,50.05);
      const merged=mergePayrollTaxSnapshots([daily,second]);await write(merged);value=(await rpc("tax_report_data")).lines[0];assert.equal(value.breakdown.state,"published");assert.deepEqual(value.breakdown.components,merged.components);assert.equal(value.breakdown.components.tip.tax_rate,null);assert.equal(value.breakdown.components.tip.payout_method,"mixed");
    });
    await t.test("malformed snapshots fail closed and never expose a raw payload or reinterpret current settings",async()=>{
      const invalid=[];
      invalid.push({}, {version:99}, {...snapshot(),version:"1"}, {...snapshot(),version:undefined}, {...snapshot(),totals:{gross:123}});
      const badNumber=snapshot();badNumber.components.cash_wage.gross="SECRET";invalid.push(badNumber);
      const badFlag=snapshot();badFlag.components.cash_wage.shown="false";invalid.push(badFlag);
      const badIdentity=snapshot();badIdentity.components.cash_wage.net=999;invalid.push(badIdentity);
      const badCents=snapshot();badCents.components.cash_wage.gross=1.001;invalid.push(badCents);
      for(const input of invalid){await write(input);const value=(await rpc("tax_report_data")).lines[0];assert.equal(value.breakdown.state,"historical_unavailable");for(const key of ["reported_gross","tax","actual_check","reported_wage","tip","bonus"])assert.equal(value[key],null,key);assert.ok(!JSON.stringify(value).includes("SECRET"));}
    });
    await t.test("professional entitlement, salon isolation and Owner/professional numeric equality stay authoritative",async()=>{
      await write(snapshot());const expected=await rpc("tax_report_data");
      await actor(professional);await assert.rejects(rpc("tax_report_data"),/inactive/);
      await db.exec("reset role");await db.exec(`insert into tax_company_credentials values('${salon}',1,true);insert into tax_company_subscriptions values('${salon}',now()+interval '1 day');insert into tax_company_connections values('${salon}','${professional}',1);`);await db.exec("set role authenticated");
      assert.deepEqual(await rpc("tax_report_data"),expected);assert.deepEqual((await rpc("tax_workspace_data")).lines,expected.lines);
      await actor(other);await assert.rejects(rpc("tax_report_data"),/inactive/);
      await actor(professional);await db.exec("reset role");await db.exec("update tax_company_subscriptions set paid_until=now()-interval '1 day'");await db.exec("set role authenticated");await assert.rejects(rpc("tax_report_data"),/inactive/);
      await actor(owner);assert.deepEqual(await rpc("tax_report_data"),expected);
      await db.exec("reset role");await db.exec("set role anon");await assert.rejects(rpc("tax_report_data"),/permission denied/);
    });
  } finally { await db.close(); }
});
