import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pathToFileURL } from "node:url";

// An isolated PostgreSQL engine; never executes against a linked salon DB.
test("draft SQL enforces authorization, atomic version checks and duplicate identity", {
  skip: !process.env.PGLITE_MODULE_PATH,
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table public.pos_live_drafts (
        id uuid primary key default gen_random_uuid(), token text, salon_id uuid,
        customer jsonb, completed_at timestamptz, customer_handoff_started_at timestamptz,
        discount numeric default 0, tax numeric default 0, reset_at timestamptz,
        last_customer_action_id text, last_tip_action_id text,
        receipt_version integer default 0, customer_version integer default 0,
        selected_staff_id text, staff_lines jsonb default '[]', status text default 'draft',
        subtotal numeric default 0, tip numeric default 0, total numeric default 0,
        total_before_tip numeric default 0, version integer default 0
      );
      create function public.pos_portable_access_salon_id(uuid,text) returns uuid
      language sql as $$ select case when $1 = '11111111-1111-4111-8111-111111111111'::uuid and $2 = 'valid'
        then '22222222-2222-4222-8222-222222222222'::uuid end $$;
      create function public.pos_portable_access_has_capability(uuid,text,text) returns boolean
      language sql as $$ select public.pos_portable_access_salon_id($1,$2) is not null and $3='portable.pos.use' $$;
      create function public.get_pos_live_draft_by_token(text) returns setof public.pos_live_drafts
      language sql as $$ select * from public.pos_live_drafts where token=$1 $$;
      insert into public.pos_live_drafts(token,salon_id) values ('receipt','22222222-2222-4222-8222-222222222222');
    `);
    await db.exec(readFileSync("supabase/migrations/202608150009_portable_live_draft_handoff_marker.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/202609230001_portable_draft_outbox.sql", "utf8"));
    const payload = { selectedStaffId: null, staffLines: [], subtotal: 50, tip: 5,
      total: 55, totalBeforeTip: 50, discount: 0, tax: 0, customer: { id: null, name: "Guest", phone: null } };
    const operation = "33333333-3333-4333-8333-333333333333";
    const send = async (id = operation, version = 0, body = payload, signature = "valid") => {
      const result = await db.query(`select public.sync_pos_portable_draft(
        '11111111-1111-4111-8111-111111111111',$1,'receipt',$2::uuid,$3,$4::jsonb) as result`,
        [signature, id, version, JSON.stringify(body)]);
      return result.rows[0].result;
    };
    const first = await send(); assert.equal(first.snapshot.version, 1);
    assert.equal(first.snapshot.customer.name, "Guest");
    const duplicate = await send(); assert.equal(duplicate.snapshot.version, 1);
    await assert.rejects(() => send(operation, 0, { ...payload, total: 999 }), /identity reused/);
    await assert.rejects(() => send(operation, 0, payload, "invalid"), /authorization/);
    assert.equal((await send("44444444-4444-4444-8444-444444444444", 0)).conflict, true);
    await db.exec("update public.pos_live_drafts set version=version+1, status='closed'");
    assert.equal((await send()).conflict, true, "late replay must not reopen a closed receipt");
    const state = await db.query("select status,total,version from public.pos_live_drafts");
    assert.equal(state.rows[0].status, "closed"); assert.equal(state.rows[0].version, 2);
  } finally { await db.close(); }
});
