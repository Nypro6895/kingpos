import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const SALON_ID = "22222222-2222-4222-8222-222222222222";
const ACCESS_KEY_ID = "33333333-3333-4333-8333-333333333333";
const LIVE_DRAFT_ID = "44444444-4444-4444-8444-444444444444";
const LIVE_DRAFT_TOKEN = "codex_rpc_contract_live_draft";
const PASSCODE_DIGEST = "codex-rpc-contract-digest";
const SESSION_SIGNATURE = createHmac("sha256", PASSCODE_DIGEST)
  .update(ACCESS_KEY_ID)
  .digest("hex");

function loadDotEnvFile(path) {
  const values = {};

  try {
    const file = readFileSync(path, "utf8");

    for (const rawLine of file.split(/\r?\n/)) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#") || !line.includes("=")) {
        continue;
      }

      const [key, ...rest] = line.split("=");
      values[key] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    return values;
  }

  return values;
}

function getSupabaseConfig() {
  const envFile = loadDotEnvFile(".env.local");
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? envFile.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    envFile.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  assert.ok(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required.");
  assert.ok(supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required.");

  return { supabaseAnonKey, supabaseUrl };
}

function queryLinkedDatabase(sql) {
  const tempDir = mkdtempSync(join(tmpdir(), "kingpos-rpc-contract-"));
  const sqlPath = join(tempDir, "query.sql");
  const command =
    process.platform === "win32" &&
    process.env.APPDATA &&
    existsSync(`${process.env.APPDATA}\\npm\\supabase.cmd`)
      ? `${process.env.APPDATA}\\npm\\supabase.cmd`
      : "supabase";

  writeFileSync(sqlPath, sql, "utf8");

  const result =
    process.platform === "win32"
      ? spawnSync(`"${command}" db query --linked --file "${sqlPath}"`, {
          encoding: "utf8",
          env: {
            ...process.env,
            SUPABASE_TELEMETRY_DISABLED: "1",
          },
          maxBuffer: 20 * 1024 * 1024,
          shell: true,
        })
      : spawnSync(command, ["db", "query", "--linked", "--file", sqlPath], {
          encoding: "utf8",
          env: {
            ...process.env,
            SUPABASE_TELEMETRY_DISABLED: "1",
          },
          maxBuffer: 20 * 1024 * 1024,
        });

  rmSync(tempDir, { force: true, recursive: true });

  assert.equal(
    result.status,
    0,
    `supabase db query failed: ${
      result.error?.message ?? result.stderr ?? result.stdout
    }`,
  );

  const output = result.stdout.trim();
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");

  assert.ok(jsonStart >= 0 && jsonEnd > jsonStart, "Expected JSON query output.");

  return JSON.parse(output.slice(jsonStart, jsonEnd + 1)).rows ?? [];
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function cleanupFixture() {
  queryLinkedDatabase(`
    delete from public.pos_live_drafts where id = ${sqlString(LIVE_DRAFT_ID)}::uuid;
    delete from public.pos_portable_access_keys where id = ${sqlString(ACCESS_KEY_ID)}::uuid;
    delete from public.locations where id = ${sqlString(SALON_ID)}::uuid;
    delete from public.accounts where id = ${sqlString(ACCOUNT_ID)}::uuid;
  `);
}

function setupFixture() {
  cleanupFixture();

  queryLinkedDatabase(`
    insert into public.accounts (id, name, status)
    values (${sqlString(ACCOUNT_ID)}::uuid, 'Codex RPC Contract Account', 'active');

    insert into public.locations (id, account_id, name, status, country)
    values (
      ${sqlString(SALON_ID)}::uuid,
      ${sqlString(ACCOUNT_ID)}::uuid,
      'Codex RPC Contract Salon',
      'active',
      'US'
    );

    insert into public.pos_portable_access_keys (
      id,
      salon_id,
      access_id,
      passcode_salt,
      passcode_digest,
      label,
      is_active
    )
    values (
      ${sqlString(ACCESS_KEY_ID)}::uuid,
      ${sqlString(SALON_ID)}::uuid,
      'codex-rpc-contract-access',
      'codex-rpc-contract-salt',
      ${sqlString(PASSCODE_DIGEST)},
      'Codex RPC Contract',
      true
    );

    insert into public.pos_live_drafts (
      id,
      salon_id,
      token,
      receipt,
      staff_lines,
      subtotal,
      tip,
      total,
      total_before_tip,
      status
    )
    values (
      ${sqlString(LIVE_DRAFT_ID)}::uuid,
      ${sqlString(SALON_ID)}::uuid,
      ${sqlString(LIVE_DRAFT_TOKEN)},
      '{}'::jsonb,
      '[]'::jsonb,
      0,
      0,
      0,
      0,
      'draft'
    );
  `);
}

test("runtime database exposes the canonical portable live draft RPC contract", () => {
  const rows = queryLinkedDatabase(`
    select
      pg_get_function_identity_arguments(p.oid) as identity_arguments,
      pg_get_function_arguments(p.oid) as full_arguments,
      pg_get_function_result(p.oid) as return_type,
      p.prosecdef as security_definer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'update_pos_portable_live_draft'
    order by identity_arguments;
  `);

  assert.equal(rows.length, 1, "Expected exactly one canonical overload.");
  assert.equal(
    rows[0].identity_arguments,
    "p_key_id uuid, p_session_signature text, p_token text, p_selected_staff_id text, p_staff_lines jsonb, p_subtotal numeric, p_tip numeric, p_total numeric, p_discount numeric, p_tax numeric, p_total_before_tip numeric",
  );
  assert.match(rows[0].full_arguments, /p_discount numeric DEFAULT 0/);
  assert.match(rows[0].full_arguments, /p_tax numeric DEFAULT 0/);
  assert.match(rows[0].full_arguments, /p_total_before_tip numeric DEFAULT NULL::numeric/);
  assert.equal(rows[0].return_type, "jsonb");
  assert.equal(rows[0].security_definer, true);
});

test("migration chain records the realtime customer display RPC migration", () => {
  const rows = queryLinkedDatabase(`
    select version, name
    from supabase_migrations.schema_migrations
    where version = '202607240010';
  `);

  assert.deepEqual(rows, [
    {
      name: "pos_live_draft_realtime_customer_display",
      version: "202607240010",
    },
  ]);
});

test("PostgREST can call update_pos_portable_live_draft and rejects stale sessions", async () => {
  setupFixture();

  try {
    const { supabaseAnonKey, supabaseUrl } = getSupabaseConfig();
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });

    const payload = {
      p_discount: 5,
      p_key_id: ACCESS_KEY_ID,
      p_selected_staff_id: null,
      p_session_signature: SESSION_SIGNATURE,
      p_staff_lines: [
        {
          amount: 50,
          id: "contract-line-1",
          staff_id: null,
        },
      ],
      p_subtotal: 50,
      p_tax: 2.5,
      p_tip: 7.25,
      p_token: LIVE_DRAFT_TOKEN,
      p_total: 54.75,
      p_total_before_tip: 47.5,
    };

    const validResult = await supabase.rpc("update_pos_portable_live_draft", payload);

    assert.equal(validResult.error, null);
    assert.equal(validResult.data?.token, LIVE_DRAFT_TOKEN);
    assert.equal(Number(validResult.data?.subtotal), 50);
    assert.equal(Number(validResult.data?.discount), 5);
    assert.equal(Number(validResult.data?.tax), 2.5);
    assert.equal(Number(validResult.data?.tip), 7.25);
    assert.equal(Number(validResult.data?.total_before_tip), 47.5);
    assert.equal(Number(validResult.data?.total), 54.75);

    const invalidResult = await supabase.rpc("update_pos_portable_live_draft", {
      ...payload,
      p_session_signature: "invalid-session-signature",
      p_total: 999,
    });

    assert.equal(invalidResult.error, null);
    assert.equal(invalidResult.data, null);

    const rows = queryLinkedDatabase(`
      select
        subtotal::text,
        discount::text,
        tax::text,
        tip::text,
        total_before_tip::text,
        total::text,
        version,
        receipt_version,
        status
      from public.pos_live_drafts
      where id = ${sqlString(LIVE_DRAFT_ID)}::uuid;
    `);

    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].subtotal), 50);
    assert.equal(Number(rows[0].discount), 5);
    assert.equal(Number(rows[0].tax), 2.5);
    assert.equal(Number(rows[0].tip), 7.25);
    assert.equal(Number(rows[0].total_before_tip), 47.5);
    assert.equal(Number(rows[0].total), 54.75);
    assert.equal(rows[0].version, 1);
    assert.equal(rows[0].receipt_version, 1);
    assert.equal(rows[0].status, "draft");
  } finally {
    cleanupFixture();
  }
});
