import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import { PGlite } from "@electric-sql/pglite";

const baseline = readFileSync("supabase/migrations/202608300004_platform_admin_current_schema.sql", "utf8");
const migration = readFileSync("supabase/migrations/202610100001_admin_report_workflow.sql", "utf8");
const id = "00000000-0000-4000-8000-000000000001";
function sqlFunction(name) {
  const start = baseline.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0);
  return baseline.slice(start, baseline.indexOf("$$;", baseline.indexOf("as $$", start)) + 3);
}
async function setup() {
  const db = new PGlite();
  await db.exec(`
    create table platform_reports(id uuid primary key, priority text default 'normal', status text default 'new', summary text default 'Mobile save issue', description text, resolution text, resolved_by_user_id uuid, resolved_at timestamptz, closed_by_user_id uuid, closed_at timestamptz);
    create table platform_admin_audit_logs(actor_user_id uuid, action text, target_type text, target_id uuid, reason text, before_data jsonb, after_data jsonb);
    create function platform_admin_has_permission(text) returns boolean language sql as $$select $1 = any(string_to_array(current_setting('test.permissions',true),','))$$;
    create function platform_admin_require_permission(text) returns table(actor_user_id uuid, actor_role_slug text) language plpgsql as $$begin
      if not coalesce(platform_admin_has_permission($1),false) then raise exception 'Permission denied'; end if;
      return query select '${id}'::uuid, current_setting('test.role',true);
    end$$;
    create function platform_admin_normalize_reason(text) returns text language plpgsql as $$begin
      if nullif(trim($1),'') is null then raise exception 'Reason is required'; end if; return trim($1);
    end$$;
  `);
  await db.exec(sqlFunction("platform_report_transition_allowed"));
  await db.exec(sqlFunction("update_platform_admin_report"));
  await db.exec(sqlFunction("resolve_platform_admin_report"));
  await db.exec(sqlFunction("close_platform_admin_report"));
  await db.exec(migration);
  await db.query("insert into platform_reports(id) values($1)", [id]);
  await actor(db);
  return db;
}
async function actor(db, role = "platform_owner", permissions = "admin.reports.update,admin.reports.resolve") {
  await db.query("select set_config('test.role',$1,false),set_config('test.permissions',$2,false)", [role, permissions]);
}
async function update(db, status, reason = "Verified the issue") {
  return db.query("select update_platform_admin_report($1,'high',$2,'Updated summary','Updated description',$3)", [id, status, reason]);
}
const resolve = db => db.query("select resolve_platform_admin_report($1,'Fixed mobile save visibility','Verified fix')", [id]);
const close = db => db.query("select close_platform_admin_report($1,'Confirmed resolution')", [id]);
const row = async db => (await db.query("select * from platform_reports where id=$1", [id])).rows[0];

test("Report lifecycle: review, resolve, close, edit and reopen preserve consistent records and audit", async () => {
  const db = await setup();
  try {
    await update(db, "new");
    await assert.rejects(update(db, "resolved"), /Use Resolve report/);
    await assert.rejects(resolve(db), /Invalid report status transition/);
    await assert.rejects(close(db), /must be resolved/);
    await update(db, "under_review");
    await update(db, "action_required");
    await resolve(db);
    const resolved = await row(db);
    assert.equal(resolved.status, "resolved");
    assert.ok(resolved.resolved_at);
    assert.equal(resolved.resolved_by_user_id, id);
    await assert.rejects(update(db, "closed"), /Use Resolve report/);
    await close(db);
    const closed = await row(db);
    assert.deepEqual(closed.resolved_at, resolved.resolved_at);
    assert.ok(closed.closed_at);
    await actor(db, "support_agent", "admin.reports.update");
    await update(db, "closed");
    const edited = await row(db);
    for (const field of ["resolution", "resolved_at", "resolved_by_user_id", "closed_at", "closed_by_user_id"]) assert.deepEqual(edited[field], closed[field], field);
    await assert.rejects(update(db, "under_review"), /Invalid report status transition/);
    await actor(db);
    await update(db, "under_review");
    const reopened = await row(db);
    for (const field of ["resolution", "resolved_at", "resolved_by_user_id", "closed_at", "closed_by_user_id"]) assert.equal(reopened[field], null, field);
    const audit = (await db.query("select * from platform_admin_audit_logs")).rows;
    assert.equal(audit.length, 7);
    assert.equal(audit.at(-1).before_data.status, "closed");
    assert.equal(audit.at(-1).before_data.resolution, "Fixed mobile save visibility");
    assert.equal(audit.at(-1).after_data.status, "under_review");
    assert.equal(audit.at(-1).after_data.resolution, null);
    assert.equal(audit.at(-1).reason, "Verified the issue");
  } finally { await db.close(); }
});

test("Report mutations enforce permissions, reason and resolution without partial writes", async () => {
  const db = await setup();
  try {
    await actor(db, "auditor", "admin.reports.read");
    await assert.rejects(update(db, "new"), /Permission denied/);
    await assert.rejects(resolve(db), /Permission denied/);
    await assert.rejects(close(db), /Permission denied/);
    await actor(db, "support_agent", "admin.reports.update");
    await assert.rejects(update(db, "under_review", ""), /Reason is required/);
    await update(db, "under_review");
    await assert.rejects(resolve(db), /Permission denied/);
    await actor(db);
    await assert.rejects(db.query("select resolve_platform_admin_report($1,'','Verified')", [id]), /Resolution must/);
    assert.equal((await row(db)).status, "under_review");
    assert.equal((await db.query("select count(*)::int n from platform_admin_audit_logs")).rows[0].n, 1);
    await resolve(db);
    await actor(db, "support_agent", "admin.reports.update");
    await update(db, "resolved");
    assert.ok((await row(db)).resolved_at);
    await update(db, "under_review");
    assert.equal((await row(db)).resolution, null);
  } finally { await db.close(); }
});

test("Report UI offers only SQL-valid transitions and gates lifecycle actions", async () => {
  const code = transformSync(readFileSync("lib/platform-admin/report-workflow.ts", "utf8"), { loader: "ts", format: "esm" }).code;
  const workflow = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  const db = await setup();
  try {
    for (const role of ["platform_owner", "operations_admin", "support_agent", "moderator", "auditor"]) {
      for (const status of ["new", "under_review", "action_required", "resolved", "closed"]) {
        for (const option of workflow.reportUpdateStatusOptions(status, role)) {
          const result = await db.query("select platform_report_transition_allowed($1,$2,$3) allowed", [status, option.value, role]);
          assert.equal(result.rows[0].allowed, true, `${role}: ${status} -> ${option.value}`);
          if (option.value !== status) assert.ok(!["resolved", "closed"].includes(option.value));
        }
        const result = await db.query("select platform_report_transition_allowed($1,'resolved',$2) allowed", [status, role]);
        assert.equal(workflow.reportCanResolve(status), result.rows[0].allowed);
        assert.equal(workflow.reportCanClose(status, "Fixed"), status === "resolved");
        assert.equal(workflow.reportCanClose(status, ""), false);
      }
    }
    assert.deepEqual(workflow.reportUpdateStatusOptions("new", "platform_owner").map(o => o.value), ["new", "under_review"]);
    assert.deepEqual(workflow.reportUpdateStatusOptions("closed", "support_agent").map(o => o.value), ["closed"]);
  } finally { await db.close(); }
});
