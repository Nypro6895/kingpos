import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
function fixture({ matches = [], matchError = null, owner = true } = {}) {
  const accounts = [{ id: 'a', name: 'Account A', status: 'active' }, { id: 'b', name: 'Account B', status: 'active' }];
  const salons = [{ id: 'one', account_id: 'a', name: 'One', status: 'active' }, { id: 'two', account_id: 'b', name: 'Two', status: 'active' }];
  const context = { user: { id: 'user' }, accountId: 'a', salonId: 'one', salonMode: 'manage', availableAccounts: accounts, availableManageSalons: salons, salonMemberships: [], accountMemberships: accounts.map(account => ({ account_id: account.id, account, owner, status: "active" })), workspaceOptions: salons.map(salon => ({ id: `manage:${salon.id}`, accountId: salon.account_id, salonMode: 'manage' })) };
  const writes = [], paths = [], switches = [], rpcs = [];
  const previous = { business_name: 'Existing name', email: 'salon@example.com', website: 'https://example.com', public_discovery_enabled: true, allow_staff_applications: true, operating_timezone_iana: 'America/New_York', country: 'US' };
  const dependencies = {
    '@/lib/current-context': { getCurrentBusinessContext: async () => context, getManageWorkspaceId: id => `manage:${id}`, isOwnerMembership: m => m?.owner, setNormalizedWorkspaceContext: async w => switches.push(w) },
    '@/lib/permissions': { hasPermission: async () => owner },
    '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: async () => ({ from: () => ({ select: () => ({ in: async () => ({ data: [{ salon_id: 'one', business_name: 'Edited name' }], error: null }) }) }), rpc: async (name, input) => { rpcs.push({ name, input }); return name === 'find_business_claim_matches' ? { data: matches, error: matchError } : { data: { salon_id: 'new' }, error: null }; } }) },
    '@/lib/salon-settings': { getCurrentSalonSetting: async () => ({ setting: previous }), updateCurrentSalonSetting: async (input, target) => { if(!target.currentMembership.owner) throw new Error('Denied'); writes.push({ input, target }); } },
    'next/cache': { revalidatePath: path => paths.push(path) },
    'node:crypto': { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
  };
  const code = ts.transpileModule(readFileSync('app/settings/salon-list-actions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => { assert.ok(dependencies[name], `Unexpected dependency ${name}`); return dependencies[name]; }, FormData, Error });
  return { api: exports, writes, switches, rpcs, paths };
}
function form() { const data = new FormData(); data.set('name', 'Updated salon'); return data; }
const key = '00000000-0000-4000-8000-000000000001';

test('list isolates the selected account and uses saved salon identity', async () => {
  const f = fixture(); const list = await f.api.loadSettingsSalonList('a');
  assert.equal(list.salons.length, 1); assert.equal(list.salons[0].id, 'one'); assert.equal(list.salons[0].name, 'Edited name');
  await assert.rejects(f.api.loadSettingsSalonList('outside'), /access/);
});
test('editing another salon preserves discovery, applications, timezone and contact settings', async () => {
  const f = fixture(); const result = await f.api.saveSettingsSalon('b', 'two', form());
  assert.equal(result.ok, true); assert.equal(f.writes[0].target.salonId, 'two'); assert.equal(f.writes[0].target.accountId, 'b');
  const input = f.writes[0].input;
  assert.equal(input.business_name, 'Updated salon'); assert.equal(input.public_discovery_enabled, true); assert.equal(input.allow_staff_applications, true); assert.equal(input.operating_timezone_iana, 'America/New_York'); assert.equal(input.email, 'salon@example.com');
  assert.equal(f.switches.length, 0);
});
test('cross-account salon edits and selection are rejected before mutation', async () => {
  const f = fixture(); assert.equal((await f.api.saveSettingsSalon('a', 'two', form())).ok, false); assert.equal((await f.api.selectSettingsSalon('a', 'two')).ok, false);
  assert.equal(f.writes.length, 0); assert.equal(f.switches.length, 0);
});
test('selection stays in Settings and only updates an accessible workspace', async () => {
  const f = fixture(); assert.equal((await f.api.selectSettingsSalon('b', 'two')).ok, true); assert.equal(f.switches[0].id, 'manage:two'); assert.ok(f.paths.includes('/'));
});
test('duplicate matches stop creation until explicitly acknowledged', async () => {
  const f = fixture({ matches: [{ salon_id: 'existing', name: 'Existing' }] }); const draft = form();
  const result = await f.api.createSettingsSalon('a', key, draft);
  assert.equal(result.ok, false); assert.equal(result.matches.length, 1); assert.equal(f.rpcs.length, 1);
  draft.set('duplicate_acknowledged', 'yes'); assert.equal((await f.api.createSettingsSalon('a', key, draft)).ok, true);
  assert.equal(f.rpcs.at(-1).input.p_create_request_key, key);
});
test('failed duplicate check or missing owner access cannot create a salon', async () => {
  const f = fixture({ matchError: { message: 'offline' } }); assert.equal((await f.api.createSettingsSalon('a', key, form())).ok, false); assert.equal(f.rpcs.length, 1);
  const denied = fixture({ owner: false }); assert.equal((await denied.api.createSettingsSalon('a', key, form())).ok, false); assert.equal(denied.rpcs.length, 0);
});
