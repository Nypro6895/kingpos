import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

function load(file, dependencies = {}, source = readFileSync(file, 'utf8')) {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => { assert.ok(name in dependencies, `Unexpected ${name}`); return dependencies[name]; }, exports);
  return exports;
}
const policy = load('lib/experience-offline-policy.ts', { './staff-offline-binding': load('lib/staff-offline-binding.ts') });
const admission = load('lib/app-local-page-admission.ts', { './experience-offline-policy': policy, './app-local-staff-online-access': load('lib/app-local-staff-online-access.ts') });
const scope = 'v3:' + 'a'.repeat(64), generation = 'scope-fixture-generation-20261019';
const online = { schemaVersion: 1, context: { scope, viewerId: 'fixture-viewer', salonId: 'fixture-salon', authenticated: true }, grant: null, grantStatus: 503, access: { ownerWorkspace: true }, onlineValidatedAt: Date.now(), offline: false };
const source = process.env.TEST_SCOPE_BASELINE === '1' ? execFileSync('git', ['show', '1c2628c4df2069de0722874ce8972231945e7146:app/local-app/scope.tsx'], { encoding: 'utf8' }) : readFileSync('app/local-app/scope.tsx', 'utf8');
function fixture() {
  const effects = [], calls = [];
  const previous = Object.fromEntries(['window', 'navigator', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __reylumiAppLocalContext: { generation } } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { pathname: '/staff/today', search: '' } });
  let reply = async () => online;
  const react = { createContext: () => ({ Provider: 'fixture-provider' }), useCallback: fn => fn, useContext: () => null, useLayoutEffect: fn => effects.push(fn()), useMemo: fn => fn(), useRef: value => ({ current: value }), useState: value => [value, () => {}] };
  const provider = load('app/local-app/scope.tsx', {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@/lib/app-local-host': { getAppLocalHost: () => ({ context: async (...args) => { calls.push(args); return reply(); } }) },
    '@/lib/app-local-page-admission': admission, '@/components/offline-network-form-guard': {},
  }, source);
  const value = provider.ExperienceScopeProvider({ context: online.context, guardForms: false }).props.value;
  return { value, calls, reply(read) { reply = read; }, unmount() { effects.forEach(cleanup => cleanup?.()); }, close() { for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } } };
}

test('forced scope validation requests fresh online authority and accepts a correct Owner 503 lease outage', async () => {
  const f = fixture(); try { assert.equal(await f.value.validate(true), true); assert.equal(f.calls[0][1]?.fresh, true); assert.equal(f.value.getValidationRevision(), 1); } finally { f.close(); }
});
test('scope validation rejects explicit denied grants, wrong page capability, cached context and changed viewer', async () => {
  const f = fixture(); try {
    for (const patch of [{ grantStatus: 401 }, { grantStatus: 403 }, { grantStatus: 409 }, { offlineState: 'unconfirmed' }, { access: { ownerWorkspace: false, staffWorkspace: true } }, { offline: true }, { context: { ...online.context, viewerId: 'other-viewer' } }]) {
      f.reply(async () => ({ ...online, ...patch })); assert.equal(await f.value.validate(true), false, JSON.stringify(patch));
    }
    assert.equal(f.value.getValidationRevision(), 0);
  } finally { f.close(); }
});
test('scope validation cannot deliver after unmount, navigation away or device generation change', async () => {
  for (const change of ['unmount', 'path', 'generation']) {
    const f = fixture(); try {
      let release; f.reply(() => new Promise(resolve => { release = resolve; }));
      const pending = f.value.validate(true);
      if (change === 'unmount') f.unmount(); else if (change === 'path') location.pathname = '/explore'; else window.__reylumiAppLocalContext.generation = 'other-generation';
      release(online); assert.equal(await pending, false); assert.equal(f.value.getValidationRevision(), 0);
    } finally { f.close(); }
  }
});

test('page capabilities preserve shared Staff Post and keep management and staff portal families separate', () => {
  const staff = { ...online, access: { ownerWorkspace: false, staffWorkspace: true } };
  const options = { generation, online: true };
  for (const path of ['/staff/today', '/pos/book', '/pos/ticket', '/pos/report', '/staff', '/customers', '/payroll', '/services', '/salon-settings', '/salon-profile/client-transformations', '/bookings', '/reports']) {
    assert.equal(admission.canAdmitAppLocalPage(staff, path, options), false, path);
    assert.equal(admission.canAdmitAppLocalPage(online, path, options), true, path);
  }
  for (const path of ['/staff/my-work', '/staff/workday', '/staff/appointments']) {
    assert.equal(admission.canAdmitAppLocalPage(staff, path, options), true, path);
    assert.equal(admission.canAdmitAppLocalPage(online, path, options), false, path);
  }
  for (const path of ['/salon-profile', '/salon-profile/']) {
    assert.equal(admission.canAdmitAppLocalPage(staff, path, options), true, path);
    assert.equal(admission.canAdmitAppLocalPage(online, path, options), true, path);
  }
});
