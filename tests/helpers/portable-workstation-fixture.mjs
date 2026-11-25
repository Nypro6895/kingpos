import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

export const fixtureId = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const credentialHash = value => createHash('sha256').update(value).digest('hex');

/**
 * Real workstation SQL and pgcrypto in an ephemeral database. The fixture only
 * supplies the existing owning tables; it never reads application environment
 * files or opens provider/network connections.
 */
export async function workstationFixture({ beforeMigration } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions; create extension pgcrypto with schema extensions;
    create schema auth;
    create function auth.role() returns text language sql stable as $$select current_user::text$$;
    create table locations(id uuid primary key, name text);
    create table pos_portable_access_keys(id uuid primary key, salon_id uuid not null references locations(id), is_active boolean not null default true);
    create table pos_live_drafts(id uuid primary key default gen_random_uuid(), salon_id uuid not null references locations(id), token text unique not null, status text not null default 'draft', reset_at timestamptz);
    create table pos_workspace_drafts(key_id uuid not null references pos_portable_access_keys(id), device_id uuid not null, draft_id uuid not null references pos_live_drafts(id), primary key(key_id, device_id));
    create table legacy_draft_calls(token text);
    insert into locations values('${fixtureId(1)}','Workstation fixture salon'),('${fixtureId(2)}','Other fixture salon');
    insert into pos_portable_access_keys values('${fixtureId(10)}','${fixtureId(1)}',true),('${fixtureId(20)}','${fixtureId(2)}',true);
    insert into pos_live_drafts(id,salon_id,token) values('${fixtureId(30)}','${fixtureId(1)}','fixture-private-draft'),('${fixtureId(31)}','${fixtureId(1)}','fixture-unmanaged-draft'),('${fixtureId(40)}','${fixtureId(2)}','fixture-other-private-draft');
    insert into pos_workspace_drafts values('${fixtureId(10)}','${fixtureId(100)}','${fixtureId(30)}'),('${fixtureId(20)}','${fixtureId(200)}','${fixtureId(40)}');
  `);
  for (const name of ['sync_pos_portable_draft', 'update_pos_portable_live_draft', 'update_pos_portable_live_draft_customer', 'select_pos_portable_customer_visit_for_live_draft', 'finalize_pos_portable_live_draft']) await db.exec(`create function public.${name}(p_token text) returns jsonb language plpgsql security definer set search_path=public as $$begin insert into legacy_draft_calls values(p_token);return jsonb_build_object('ok',true);end$$;`);
  for (const [name, argument] of [['submit_pos_portable_receipt', 'p_receipt'], ['replay_pos_portable_operation', 'p_payload']]) await db.exec(`create function public.${name}(${argument} jsonb) returns jsonb language plpgsql security definer set search_path=public as $$begin insert into legacy_draft_calls values(${argument}->>'liveDraftToken');return jsonb_build_object('ok',true);end$$;`);
  if (beforeMigration) await beforeMigration(db);
  const migrations = fs.readdirSync('supabase/migrations').filter(name => /portable.*workstation|workstation.*portable|portable.*paired/.test(name)).sort();
  if (!migrations.length) { await db.close(); throw Error('The workstation migration has not been written yet.'); }
  for (const migration of migrations) await db.exec(fs.readFileSync(path.join('supabase/migrations', migration), 'utf8').replaceAll('\r\n', '\n'));
  const staff = (overrides = {}) => ({ role: 'staff', keyId: fixtureId(10), salonId: fixtureId(1), deviceId: fixtureId(100), credentialHash: credentialHash('fixture-writer-a'), ...overrides });
  const customer = (workstationId, secret = 'fixture-customer-a') => ({ role: 'customer', workstationId, credentialHash: credentialHash(secret) });
  const pair = (value = randomUUID()) => ({ role: 'pair', attemptHash: credentialHash('device:' + value), networkHash: credentialHash('network:' + value) });
  async function command(action, actor, input = {}, role = 'service_role') {
    if (!['service_role', 'anon', 'authenticated'].includes(role)) throw Error('Invalid fixture SQL role.');
    return db.transaction(async transaction => {
      await transaction.exec(`set local role ${role};select set_config('request.jwt.claim.role','${role}',true);`);
      const response = await transaction.query('select public.portable_workstation_command($1::text,$2::jsonb,$3::jsonb) as result', [action, JSON.stringify(actor), JSON.stringify(input)]);
      return response.rows[0].result;
    });
  }
  return { db, staff, customer, pair, command, migrationFiles: migrations, close: () => db.close() };
}
