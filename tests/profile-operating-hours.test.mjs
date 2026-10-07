import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const ts = createRequire(import.meta.url)('typescript');
function fixture({ user = {}, salon = 'salon', allowed = true, failure = false } = {}) {
  const calls = [], paths = [];
  const dependencies = {
    'next/cache': { revalidatePath: path => paths.push(path) },
    '@/lib/current-context': { getCurrentBusinessContext: async () => ({ user, currentSalon: { id: salon } }) },
    '@/lib/permissions': { hasPermission: async () => allowed },
    '@/lib/salon-settings': { SALON_SETTING_PERMISSIONS: { manage: 'manage' } },
    '@/lib/salon-operating-status': {
      getCurrentSalonOperatingHoursSettings: async () => ({ timeZone: 'America/Chicago', weeklyHours: [] }),
      updateCurrentSalonOperatingHours: async input => { if (failure) throw new Error('Invalid hours'); calls.push(input); },
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('app/salon-profile/operating-hours-actions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Error, require: name => { assert.ok(name in dependencies); return dependencies[name]; },
  });
  return { ...exports, calls, paths };
}
test('quick hours refuses unauthenticated, mismatched salon, and unauthorized writes', async () => {
  for (const config of [{ user: null }, { salon: 'other' }, { allowed: false }]) {
    const f = fixture(config);
    assert.equal((await f.saveProfileOperatingHours('salon', {})).ok, false);
    assert.equal(f.calls.length, 0);
    assert.equal(f.paths.length, 0);
  }
});
test('quick hours preserves multiple and overnight intervals using existing domain save', async () => {
  const f = fixture();
  const input = { timeZone: 'America/Chicago', weeklyHours: [
    { dayOfWeek: 1, opensAtLocal: '09:00', closesAtLocal: '12:00' },
    { dayOfWeek: 1, opensAtLocal: '18:00', closesAtLocal: '02:00' },
  ] };
  assert.equal((await f.saveProfileOperatingHours('salon', input)).ok, true);
  assert.equal(f.calls[0], input);
  assert.ok(f.paths.includes('/salon-profile'));
  assert.ok(!f.paths.includes('/'));
});
test('domain validation failure is shown and does not invalidate pages', async () => {
  const f = fixture({ failure: true });
  const result = await f.saveProfileOperatingHours('salon', {});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Invalid hours');
  assert.equal(f.paths.length, 0);
});
test('view-only user receives read-only hours and another salon cannot load them', async () => {
  const f = fixture({ allowed: false });
  assert.equal((await f.loadProfileOperatingHours('salon')).canManage, false);
  assert.ok((await f.loadProfileOperatingHours('salon')).settings);
  assert.equal((await f.loadProfileOperatingHours('other')).settings, null);
});
