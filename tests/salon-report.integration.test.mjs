import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table users(id uuid primary key,status text default 'active',display_name text);
    create table accounts(id uuid primary key);
    create table locations(id uuid primary key,name text,status text default 'active');
    create table platform_reports(id uuid primary key default gen_random_uuid(),report_number text default gen_random_uuid()::text,category text,priority text default 'normal',status text default 'new',summary text,description text,source text,reporter_user_id uuid,created_by_user_id uuid,subject_user_id uuid,subject_organization_id uuid,subject_location_id uuid references locations(id),assigned_membership_id uuid,resolution text,created_at timestamptz default now(),updated_at timestamptz default now(),resolved_at timestamptz,closed_at timestamptz);
    create table support_inbox_threads(id uuid primary key,customer_name text,customer_email text,message text,status text default 'new');
    create table app_notifications(id uuid default gen_random_uuid(),recipient_user_id uuid,recipient_kind text,notification_type text,title text,body text,href text,event_key text);
    create table platform_admin_audit_logs(actor_user_id uuid,action text,target_type text,target_id uuid,reason text,metadata jsonb);
    create function current_public_user_id() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function platform_admin_require_permission(text) returns table(actor_user_id uuid,actor_membership_id uuid) language plpgsql as $$begin if not $1=any(string_to_array(coalesce(current_setting('test.permissions',true),''),',')) then raise exception 'Permission denied'; end if; return query select current_public_user_id(),current_public_user_id(); end$$;
    create function platform_admin_normalize_page(int) returns int language sql as $$select greatest($1,1)$$;
    create function platform_admin_clamp_page_size(int) returns int language sql as $$select greatest(1,least($1,100))$$;
    create function abuse_guard_actor(text) returns jsonb language plpgsql as $$begin if current_setting('test.blocked',true)='yes' then raise exception 'Too many reports'; end if; return jsonb_build_object('device',nullif(current_setting('test.device',true),'')); end$$;
    create view platform_admin_businesses_compat as select id,''::text name from accounts;
    create table platform_admin_memberships(id uuid,user_id uuid,role_id uuid,status text);
    create table platform_admin_roles(id uuid,slug text);
    insert into users(id) values ('${id(1)}'),('${id(2)}');
    insert into locations(id,name) values ('${id(10)}','King Nails'),('${id(11)}','Another salon');
  `);
  for (const migration of ["202610070017_user_support_cases.sql", "202610070019_support_active_identity.sql", "20261012010001_salon_reports.sql"]) {
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  }
  return db;
}
async function actor(db, user, device = "device-a") {
  await db.query("select set_config('test.uid',$1,false),set_config('test.device',$2,false)", [user ? id(user) : "", device]);
}
async function submit(db, request = 20, salon = 10, reason = "incorrect_information", details = "Wrong address") {
  return (await db.query("select submit_salon_report($1,$2,$3,$4) result", [id(request), id(salon), reason, details])).rows[0].result;
}

test("salon reports persist the actual target and reuse the private support conversation on retry", async () => {
  const db = await setup();
  try {
    await actor(db, 1);
    const result = await submit(db);
    assert.deepEqual(await submit(db), result);
    assert.equal(result.supportHref, `/support/${result.id}`);
    const row = (await db.query("select * from platform_reports")).rows[0];
    assert.equal(row.subject_location_id, id(10));
    assert.equal(row.category, "salon_report");
    assert.equal(row.summary, "Salon report: King Nails");
    assert.equal(row.support_context.path, `/explore/salons/${id(10)}`);
    assert.equal(row.description, "Incorrect salon information\n\nWrong address");
    const conversation = (await db.query("select get_support_conversation($1) data", [result.id])).rows[0].data;
    assert.equal(conversation.messages.length, 1);
    assert.equal(conversation.messages[0].body, row.description);
    await db.query("select send_support_case_message($1,'Here is the correct address')", [result.id]);
    await actor(db, 2);
    await assert.rejects(db.query("select get_support_conversation($1)", [result.id]), /Permission denied/);
    await assert.rejects(submit(db), /close this report/);
    await actor(db, 1);
    await assert.rejects(submit(db, 20, 11), /close this report/);
  } finally { await db.close(); }
});

test("guests report directly with a trusted browser identity, without creating a fake support conversation", async () => {
  const db = await setup();
  try {
    await actor(db, null);
    await db.exec("set role anon");
    const result = await submit(db, 21, 11, "closed", "");
    assert.deepEqual(await submit(db, 21, 11, "closed", ""), result);
    assert.equal(result.supportHref, null);
    await db.exec("reset role");
    const row = (await db.query("select * from platform_reports")).rows[0];
    assert.equal(row.source, "guest_salon_report");
    assert.equal(row.reporter_user_id, null);
    assert.equal(row.subject_location_id, id(11));
    assert.equal((await db.query("select count(*)::int n from support_case_messages")).rows[0].n, 0);
    await actor(db, null, "device-b");
    await assert.rejects(submit(db, 21, 11), /close this report/);
    await actor(db, null, "");
    await assert.rejects(submit(db, 22), /use Reylumi/);
  } finally { await db.close(); }
});

test("invalid targets, reasons, long details and restricted callers cannot create salon reports", async () => {
  const db = await setup();
  try {
    await actor(db, 1);
    await assert.rejects(submit(db, 20, 999), /no longer available/);
    await assert.rejects(submit(db, 20, 10, "delete_salon"), /choose a reason/);
    await assert.rejects(submit(db, 20, 10, null), /choose a reason/);
    await assert.rejects(submit(db, 20, 10, "other", "x".repeat(2001)), /check your report/);
    await db.query("update locations set status='deleted' where id=$1", [id(10)]);
    await assert.rejects(submit(db), /no longer available/);
    await db.exec("select set_config('test.blocked','yes',false)");
    await assert.rejects(submit(db, 20, 11), /Too many reports/);
    await db.exec("select set_config('test.blocked','no',false)");
    await db.query("update users set status='suspended' where id=$1", [id(1)]);
    await assert.rejects(submit(db, 20, 11), /active account/);
    assert.equal((await db.query("select count(*)::int n from platform_reports")).rows[0].n, 0);
  } finally { await db.close(); }
});
