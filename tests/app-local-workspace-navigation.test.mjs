import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(options = {}) {
  const events = [], calls = [], assigned = [];
  let scope = 'synthetic-staff-scope';
  const window = { __reylumiAppLocalContext: { generation: 'synthetic-generation-one' }, dispatchEvent: event => events.push({ type: event.type, detail: event.detail }), location: { assign: href => assigned.push(href) } };
  const host = { isNative: options.native !== false, command: async (...args) => { calls.push(args); return options.command ? options.command({ window, setScope: value => { scope = value; } }) : { path: '/staff/today' }; } };
  const api = {};
  const source = ts.transpileModule(readFileSync('lib/app-local-shell-workspace-navigation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports: api, window, location: { pathname: '/staff/my-work', search: '' }, navigator: { onLine: options.online !== false }, URLSearchParams, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }, require: name => name === './app-local-host' ? { getAppLocalHost: () => host, appLocalPath: value => { if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) throw Error('Invalid path'); return value; } } : name === './app-local-command-client' ? { getAppLocalCommandScope: () => scope } : (() => { throw Error(name); })() });
  return { api, window, events, calls, assigned, setScope: value => { scope = value; }, flush: async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); } };
}

test('confirmed selection navigates only to the server-returned destination once', async () => {
  const f = fixture(); f.api.navigateToWorkspace('synthetic-owner-workspace'); await f.flush();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'shell.switch-workspace');
  assert.equal(f.calls[0][1].workspaceId, 'synthetic-owner-workspace');
  assert.equal(f.calls[0][2].scope, 'synthetic-staff-scope');
  assert.deepEqual(f.events.map(row => row.type), ['reylumi:app-local-workspace-start', 'reylumi:app-local-workspace-handoff', 'reylumi:app-local-workspace-finish']);
  assert.equal(f.events[0].detail.scope, 'synthetic-staff-scope'); assert.equal(f.events[0].detail.generation, 'synthetic-generation-one');
  assert.equal(f.events[0].detail.workspaceId, 'synthetic-owner-workspace'); assert.equal(f.events[1].detail.path, '/staff/today');
});

test('lost acknowledgment resolves current root workspace instead of replaying or rechecking old Staff route', async () => {
  const f = fixture({ command: () => { throw Error('Synthetic lost acknowledgment after commit'); } });
  f.api.navigateToWorkspace('synthetic-owner-workspace'); await f.flush();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.events.map(row => row.type), ['reylumi:app-local-workspace-start', 'reylumi:app-local-workspace-resolve', 'reylumi:app-local-workspace-finish']);
  assert.equal(f.events[1].detail.generation, 'synthetic-generation-one');
  assert.equal(f.events[1].detail.workspaceId, 'synthetic-owner-workspace');
  assert.equal(f.events[1].detail.path, undefined);
});

test('failure before command commit uses the same read-only resolution and cannot claim target selected', async () => {
  const f = fixture({ command: () => { throw Object.assign(Error('Synthetic preflight unavailable'), { status: 503 }); } });
  f.api.navigateToWorkspace('synthetic-owner-workspace'); await f.flush();
  assert.equal(f.calls.length, 1); assert.equal(f.events[1].type, 'reylumi:app-local-workspace-resolve');
  assert.equal(f.events.some(row => row.type === 'reylumi:app-local-workspace-handoff'), false);
});

test('old generation and changed active scope cannot publish a stale switch result', async () => {
  for (const failure of [true, false]) {
    const f = fixture({ command: ({ window }) => { window.__reylumiAppLocalContext.generation = 'synthetic-generation-two'; if (failure) throw Error('Old operation'); return { path: '/staff/today' }; } });
    f.api.navigateToWorkspace('synthetic-owner-workspace'); await f.flush();
    assert.equal(f.events.some(row => ['reylumi:app-local-workspace-handoff','reylumi:app-local-workspace-resolve'].includes(row.type)), false, 'Neither success nor uncertain recovery may outlive its generation');
  }
  const f = fixture({ command: ({ setScope }) => { setScope('different-viewer-scope'); return { path: '/staff/today' }; } });
  f.api.navigateToWorkspace('synthetic-owner-workspace'); await f.flush(); assert.equal(f.events.some(row => ['reylumi:app-local-workspace-handoff','reylumi:app-local-workspace-resolve'].includes(row.type)), false);
});

test('concurrent selections join the one pending gesture without a second command', async () => {
  let finish;
  const f = fixture({ command: () => new Promise(resolve => { finish = resolve; }) });
  f.api.navigateToWorkspace('synthetic-owner-workspace'); f.api.navigateToWorkspace('another-workspace');
  assert.equal(f.calls.length, 1); finish({ path: '/staff/today' }); await f.flush();
  assert.deepEqual(f.events.map(row => row.type), ['reylumi:app-local-workspace-start', 'reylumi:app-local-workspace-handoff', 'reylumi:app-local-workspace-finish']);
});

test('twenty round trips keep one command per role selection and no uncertain-write replay', async () => {
  let selected = 'staff';
  const f = fixture({ command: () => { selected = selected === 'staff' ? 'owner' : 'staff'; return { path: selected === 'owner' ? '/staff/today' : '/staff/my-work' }; } });
  for (let round = 0; round < 20; round++) for (const role of ['owner', 'staff']) { f.api.navigateToWorkspace('synthetic-' + role); await f.flush(); assert.equal(selected, role); }
  assert.equal(f.calls.length, 40); assert.equal(f.events.filter(row => row.type === 'reylumi:app-local-workspace-handoff').length, 40);
  assert.equal(f.events.filter(row => row.type === 'reylumi:app-local-workspace-start').length, 40); assert.equal(f.events.filter(row => row.type === 'reylumi:app-local-workspace-finish').length, 40);
});

test('web retains checked document navigation; offline native selection cannot send a command', async () => {
  const web = fixture({ native: false }); web.api.navigateToWorkspace('owner', '/staff/today');
  assert.equal(web.calls.length, 0); assert.equal(web.assigned[0], '/workspace/open?workspace_id=owner&destination=%2Fstaff%2Ftoday');
  const offline = fixture({ online: false }); assert.throws(() => offline.api.navigateToWorkspace('owner')); assert.equal(offline.calls.length, 0);
});

test('uncertain generic workspace-changing command requests neutral recovery without a second write', async () => {
  const api = {}, recoveries = []; let commands = 0;
  const window = { __reylumiAppLocalContext: { generation: 'synthetic-generation-one' }, dispatchEvent: () => {} };
  const source = ts.transpileModule(readFileSync('lib/app-local-command-client.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports: api, window, location: { pathname: '/staff/my-work', search: '' }, require: name => {
    if (name === './app-local-host') return { getAppLocalHost: () => ({ command: async () => { commands++; throw Error('Synthetic uncertain write'); } }) };
    if (name === './app-local-command-codec') return { encodeAppLocalValue: async value => value };
    if (name === './app-local-upload-client') return { handlesAppLocalFileCommand: async () => ({ handled: false }) };
    if (name === './app-local-shell-workspace-navigation') return { requestWorkspaceResolution: generation => recoveries.push(generation) };
    throw Error(name);
  } });
  api.setAppLocalCommandScope('synthetic-staff-scope');
  await assert.rejects(api.invokeAppLocalCommand('action.synthetic', [], true, undefined, true));
  assert.equal(commands, 1); assert.deepEqual(recoveries, ['synthetic-generation-one']);
});
