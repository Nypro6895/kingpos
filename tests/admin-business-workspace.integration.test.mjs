import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;
create function platform_admin_has_permission(p text) returns boolean language sql as $$select coalesce(current_setting('test.permissions',true),'') like '%'||p||'%'$$;
create function platform_admin_require_permission(p text) returns table(actor_user_id uuid) language plpgsql as $$begin if not platform_admin_has_permission(p) then raise exception 'Access denied';end if;return query select '${id(1)}'::uuid;end;$$;
create table users(id uuid primary key,display_name text,email text,phone text);create table locations(id uuid primary key,account_id uuid,name text,status text,created_at timestamptz,updated_at timestamptz,address_line1 text,address_line2 text,city text,state text,postal_code text,country text,phone text,created_by_user_id uuid);
create table roles(id uuid primary key,code text);create table account_memberships(account_id uuid,user_id uuid,role_id uuid,status text);create table salon_memberships(salon_id uuid,user_id uuid,role_id uuid,status text);
create table business_claim_requests(id uuid primary key,salon_id uuid,status text,created_at timestamptz);
create table salon_verification_requests(id uuid primary key,salon_id uuid,status text,attempt integer,created_at timestamptz);
create table platform_admin_attention(target_id uuid,target_type text,reason text,due_at timestamptz,assigned_user_id uuid);
create function set_platform_admin_attention(kind text,target uuid,marked boolean,reason text) returns jsonb language plpgsql as $$begin if length(coalesce(reason,''))<3 then raise exception 'Reason required';end if;insert into platform_admin_attention(target_id,target_type,reason) values(target,kind,reason);return '{}';end;$$;
create function update_platform_admin_location_status(target uuid,new_status text,reason text) returns jsonb language plpgsql as $$begin if new_status not in ('active','inactive') then raise exception 'Invalid status';end if;update locations set status=new_status where id=target;return '{}';end;$$;
create table platform_admin_audit_logs(actor_user_id uuid,action text,target_type text,target_id uuid,reason text,after_data jsonb);
insert into users values('${id(1)}','Admin','admin@example.test',null),('${id(2)}','Owner','owner@example.test',null),('${id(3)}','Creator','creator@example.test',null);
insert into roles values('${id(10)}','OWNER');
select set_config('test.permissions','admin.locations.read admin.locations.update_status admin.users.read admin.users.read_sensitive admin.businesses.read',false);
insert into locations select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(90)}','Business '||n,'active',now()-interval '1 day'*case when n>102 then 2 else 0 end,now(),'10 Main',null,'Madison','WI','53703','US','5551234567','${id(3)}' from generate_series(100,130)n;
insert into account_memberships values('${id(90)}','${id(2)}','${id(10)}','active');
insert into salon_memberships values('${id(100)}','${id(2)}','${id(10)}','active');
insert into salon_verification_requests values('${id(40)}','${id(100)}','approved',1,now()),('${id(41)}','${id(100)}','waiting',2,now());
insert into business_claim_requests values('${id(50)}','${id(100)}','waiting',now()),('${id(51)}','${id(101)}','waiting',now());`);
  await db.exec(
    fs.readFileSync(
      "supabase/migrations/202610080001_admin_business_workspace.sql",
      "utf8",
    ),
  );
  return db;
}
const search = async (db, ...args) =>
  (
    await db.query(
      `select search_platform_admin_business_workspace(${args.map((v, i) => (i === 0 ? String(v) : "'" + v.replaceAll("'", "''") + "'")).join(",")}) value`,
    )
  ).rows[0].value;
test("Business workspace: real scoped data, ownership, latest verification, pagination and filters", async () => {
  const db = await setup();
  try {
    const all = await search(db, 1, "", "all", "", "", "", "created_desc");
    assert.equal(all.total, 31);
    assert.equal(all.items.length, 25);
    assert.equal(all.counts.new, 3);
    const b = all.items.find((b) => b.id === id(100));
    assert.equal(b.owners.length, 1, "deduplicate inherited and direct owner");
    assert.equal(b.creator.name, "Creator");
    assert.equal(b.owners[0].name, "Owner");
    assert.equal(
      b.verification,
      "waiting",
      "latest attempt controls verification",
    );
    assert.equal(b.ownership, "pending");
    const second = await search(db, 2, "", "all", "", "", "", "created_desc");
    assert.equal(second.items.length, 6);
    assert.equal(
      new Set([...all.items, ...second.items].map((r) => r.id)).size,
      31,
    );
    assert.equal(
      (await search(db, 1, "", "new", "", "", "", "created_desc")).total,
      3,
    );
    assert.equal(
      (await search(db, 1, "", "review", "", "", "", "created_desc")).total,
      2,
    );
    assert.equal(
      (await search(db, 1, "owner@example.test", "all", "", "", "", "name_asc"))
        .total,
      31,
    );
    await db.exec(
      "select set_config('test.permissions','admin.locations.read',false)",
    );
    const restricted = await search(
      db,
      1,
      "",
      "all",
      "",
      "",
      "",
      "created_desc",
    );
    assert.equal(restricted.items[0].creator, null);
    assert.deepEqual(restricted.items[0].owners, []);
    assert.equal(
      (await search(db, 1, "owner@example.test", "all", "", "", "", "name_asc"))
        .total,
      0,
    );
    await db.exec("select set_config('test.permissions','',false)");
    await assert.rejects(
      search(db, 1, "", "all", "", "", "", "created_desc"),
      /Access denied/,
    );
  } finally {
    await db.close();
  }
});
test("Take review: permission, idempotency, conflicting assignee and obsolete requests", async () => {
  const db = await setup();
  try {
    await db.query(
      `select take_platform_admin_business_review('claims','${id(50)}')`,
    );
    await db.query(
      `select take_platform_admin_business_review('claims','${id(50)}')`,
    );
    assert.equal(
      (await db.query("select count(*)::int n from platform_admin_audit_logs"))
        .rows[0].n,
      1,
    );
    await db.exec(
      `update platform_admin_business_review_assignments set assigned_user_id='${id(2)}'`,
    );
    await assert.rejects(
      db.query(
        `select take_platform_admin_business_review('claims','${id(50)}')`,
      ),
      /already taken/,
    );
    await assert.rejects(
      db.query(
        `select take_platform_admin_business_review('verification','${id(40)}')`,
      ),
      /no longer waiting/,
    );
    await db.exec(
      `update business_claim_requests set status='approved' where id='${id(51)}'`,
    );
    await assert.rejects(
      db.query(
        `select take_platform_admin_business_review('claims','${id(51)}')`,
      ),
      /no longer waiting/,
    );
  } finally {
    await db.close();
  }
});

test("Bulk follow-up is atomic and business status rejects stale changes", async () => {
  const db = await setup();
  try {
    await assert.rejects(
      db.query(
        `select bulk_platform_admin_business_followup(array['${id(100)}'::uuid,'${id(999)}'::uuid],'Review contact')`,
      ),
      /existing businesses/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from platform_admin_attention"))
        .rows[0].n,
      0,
    );
    await db.query(
      `select bulk_platform_admin_business_followup(array['${id(100)}'::uuid,'${id(101)}'::uuid],'Review contact')`,
    );
    assert.equal(
      (await db.query("select count(*)::int n from platform_admin_attention"))
        .rows[0].n,
      2,
    );
    await db.query(
      `select set_platform_admin_business_workspace_status('${id(100)}','inactive','active','Temporary closure')`,
    );
    assert.equal(
      (await db.query(`select status from locations where id='${id(100)}'`))
        .rows[0].status,
      "inactive",
    );
    assert.equal(
      (await db.query(`select status from locations where id='${id(101)}'`))
        .rows[0].status,
      "active",
    );
    assert.equal(
      (await db.query("select count(*)::int n from users")).rows[0].n,
      3,
    );
    await assert.rejects(
      db.query(
        `select set_platform_admin_business_workspace_status('${id(100)}','active','active','Restore access')`,
      ),
      /status changed/,
    );
    await db.exec(
      "select set_config('test.permissions','admin.locations.read',false)",
    );
    await assert.rejects(
      db.query(
        `select bulk_platform_admin_business_followup(array['${id(102)}'::uuid],'Review contact')`,
      ),
      /Access denied/,
    );
  } finally {
    await db.close();
  }
});
