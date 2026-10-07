import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const ts = createRequire(import.meta.url)('typescript');
test('submit button blocks duplicate submissions while preserving the action and submitter value', () => {
  const exports = {};
  const action = async () => {};
  const render = (pending, disabled = false) => {
    vm.runInNewContext(ts.transpileModule(readFileSync('components/submit-button.tsx', 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, require: name => name === 'react-dom' ? { useFormStatus: () => ({ pending }) } : { jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props}), Fragment: 'fragment' },
    });
    return exports.SubmitButton({children: 'Save', name: 'special_hours_id', value: 'hours-id', formAction: action, disabled}).props;
  };
  const pending = render(true);
  assert.equal(pending.disabled, true);
  assert.equal(pending['aria-busy'], true);
  assert.equal(pending.formAction, action);
  assert.equal(pending.name, 'special_hours_id');
  assert.equal(pending.value, 'hours-id');
  assert.equal(render(false).children, 'Save');
  assert.equal(render(false, true).disabled, true);
});

function fixture({ changedHours = false, failure = false } = {}) {
  const writes = [], paths = [];
  const dependencies = {
    crypto: {},
    'next/cache': { revalidatePath: path => paths.push(path) },
    'next/navigation': { redirect: href => { throw Object.assign(new Error('redirect'), { href }); } },
    '@/lib/salon-settings': { updateCurrentSalonSetting: async () => { if (failure) throw new Error('Save failed'); writes.push('details'); } },
    '@/lib/salon-operating-status': {
      getCurrentSalonOperatingHoursSettings: async () => ({ timeZone: 'America/Chicago', weeklyHours: [{dayOfWeek: 1, opensAtLocal: '09:00:00', closesAtLocal: changedHours ? '18:00:00' : '17:00:00', sortOrder: 0}] }),
      updateCurrentSalonOperatingHours: async () => writes.push('hours'),
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('app/salon-settings/actions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Error, console, require: name => dependencies[name] ?? {},
  });
  const form = new FormData();
  for (const [key, value] of Object.entries({ business_name: 'Salon', operating_timezone_iana: 'America/Chicago', operating_day_1_enabled: 'on', operating_day_1_opens: '09:00', operating_day_1_closes: '17:00' })) form.set(key, value);
  return { writes, paths, save: () => exports.updateSalonSettings(form) };
}

test('saving unchanged hours skips rewriting weekly schedule and reports success', async () => {
  const f = fixture();
  await assert.rejects(f.save(), error => error.href.includes('operating_notice=Salon%20settings%20saved.'));
  assert.deepEqual(f.writes, ['details']);
});

test('changed hours are persisted before the saved notice', async () => {
  const f = fixture({ changedHours: true });
  await assert.rejects(f.save(), error => error.href.includes('operating_notice='));
  assert.deepEqual(f.writes, ['details', 'hours']);
});

test('failed save reports an error without success or cache invalidation', async () => {
  const f = fixture({ failure: true });
  await assert.rejects(f.save(), error => error.href.includes('error=Save%20failed') && !error.href.includes('notice='));
  assert.deepEqual(f.paths, []);
});
