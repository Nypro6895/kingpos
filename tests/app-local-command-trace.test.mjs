import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { actualCommandTrace as tracing, boundedTraceRead, commandTraceRouteDependencies, loadTraceModule as load, traceProtocol as protocol, TraceFixtureAuthAvailabilityError } from './fixtures/app-local-command-trace.mjs';

const requestId = '00000000-0000-4000-8000-000000000001';
const bodyId = '00000000-0000-4000-8000-000000000002';
const scope = 'v3:' + 'a'.repeat(64);
const hiddenRead = 'action.' + createHash('sha256').update('app/post-moderation/actions.ts#loadHiddenPostIdentitiesAction').digest('hex').slice(0, 24);

function routeFixture(options = {}) {
  const logs = [], calls = [];
  let connectionCalls = 0;
  class UploadError extends Error {}
  const untouched = async () => ({ handled: false });
  const business = { user: options.guest ? null : { id: 'private-viewer-never-log' } };
  const route = load('app/api/app-local/command/route.ts', {
    ...commandTraceRouteDependencies({ log: row => { logs.push(row); if (options.loggerFailure) throw Error('logger unavailable'); } }),
    'next/server': { connection: async () => { connectionCalls++; if (options.connectionError) throw options.connectionError; } },
    'next/headers': { headers: async () => new Headers(options.proxyUnavailable ? { 'x-reylumi-auth-unavailable': '1' } : {}) },
    '@/lib/request-business-context': { getRequestBusinessContext: async () => { calls.push('auth'); if (options.authError) throw options.authError; return business; } },
    '@/lib/experience-context': { getExperienceContext: () => ({ scope }) },
    '@/lib/staff-portal-identity': { getStaffPortalIdentity: async () => ({ context: { user: null }, staff: null }) },
    '@/lib/current-context': { getCurrentStaffBusinessContext: async () => ({ user: null }) },
    '@/lib/app-local-commands-server.generated': { runAppLocalCommand: async () => { calls.push('original'); if (options.handlerError) throw options.handlerError; return { unchanged: true }; } },
    '@/lib/app-local-command-codec': { decodeAppLocalValue: value => value },
    '@/lib/app-local-http-server': { runAppLocalHttpCommand: untouched },
    '@/lib/app-local-role-http-server': { runAppLocalRoleHttpCommand: untouched },
    '@/lib/app-local-personal-resources-server': { runAppLocalPersonalCommand: untouched },
    '@/lib/app-local-explore-server': { runAppLocalExploreHttpCommand: untouched },
    '@/lib/app-local-public-server': { runAppLocalPublicHttpCommand: untouched },
    '@/lib/app-local-upload-server': { runAppLocalUploadCommand: untouched, AppLocalUploadError: UploadError },
    '@/lib/app-local-shell-server': { runAppLocalShellCommand: async () => { if (!options.shell) return { handled: false }; calls.push('shell'); if (options.handlerError) throw options.handlerError; return { handled: true, data: { path: '/staff/today' } }; } },
    '@/lib/app-local-portable-http-server': {}, '@/lib/app-local-portable-context-server': {},
    '@/lib/app-local-scope-id': { isAppLocalScopeId: value => /^v3:[a-f0-9]{64}$/.test(value), isAppLocalPortableScopeId: () => false },
    '@/lib/app-local-portable-actions.generated.json': {},
    '@/lib/app-local-display-server': { authorizeAppLocalDisplayCommand: async () => false },
    '@/lib/app-local-guest-read-policy': { APP_LOCAL_GUEST_HIDDEN_POSTS_READ: hiddenRead },
  });
  return {
    logs, calls, get connectionCalls() { return connectionCalls; },
    send(overrides = {}) {
      return route.POST(new Request('https://reylumi.com/api/app-local/command', {
        method: 'POST', headers: { origin: overrides.origin ?? 'https://reylumi.com', 'content-type': 'application/json', [protocol.APP_LOCAL_TRACE_REQUEST_ID]: overrides.traceId ?? requestId, ...overrides.headers },
        body: JSON.stringify({ name: overrides.name ?? hiddenRead, args: overrides.args ?? { values: [] }, scope: overrides.scope ?? scope, requestId: overrides.bodyId ?? bodyId }),
      }));
    },
  };
}

test('canonical trace registry matches original action policy and every compiled named command', () => {
  const manifest = JSON.parse(readFileSync('ios/Reylumi/LocalAppBundle/manifest.json', 'utf8'));
  const named = JSON.parse(readFileSync('lib/app-local-command-trace-names.generated.json', 'utf8'));
  const policy = JSON.parse(readFileSync('lib/app-local-command-policy.json', 'utf8'));
  const generated = readFileSync('lib/app-local-commands-server.generated.ts', 'utf8');
  const compiledIds = [...generated.matchAll(/"(action\.[a-f0-9]{24})":/g)].map(match => match[1]).sort();
  const policyIds = Object.entries(policy.modules).flatMap(([module, exports]) => exports.map(name => 'action.' + createHash('sha256').update(module + '#' + name).digest('hex').slice(0, 24))).sort();
  assert.deepEqual(compiledIds, policyIds);
  assert.deepEqual(named.names, [...new Set(manifest.commands.map(row => row.name).filter(name => !name.startsWith('action.')))].sort());
  for (const commandId of [hiddenRead, 'shell.switch-workspace', 'http.explore.feed-events']) {
    const rows = [], trace = tracing.createAppLocalCommandTrace(new Headers(), { log: row => rows.push(row) });
    trace.setCommand(commandId); trace.finish(new Response()); assert.equal(rows[0].commandId, commandId);
  }
});

test('route correlates early400/403 and confirmed401/409 without changing messages or issuing writes', async () => {
  for (const [fixtureOptions, input, status, code, message] of [
    [{}, { bodyId: 'bad' }, 400, 'invalid_request', 'Invalid form.'],
    [{}, { origin: 'https://hostile.invalid' }, 403, 'access_denied', 'Please open the form again.'],
    [{ guest: true }, { name: 'action.aaaaaaaaaaaaaaaaaaaaaaaa' }, 401, 'access_denied', 'Please sign in again.'],
    [{ guest: true }, { scope: 'v3:' + 'b'.repeat(64) }, 409, 'workspace_changed', 'Your account has changed.'],
  ]) {
    const f = routeFixture(fixtureOptions), result = await f.send(input);
    assert.equal(result.status, status); assert.equal(result.headers.get(protocol.APP_LOCAL_TRACE_REQUEST_ID), requestId);
    assert.equal(result.headers.get(protocol.APP_LOCAL_TRACE_FAILURE_CODE), code);
    assert.deepEqual(await result.json(), { ok: false, error: message });
    assert.equal(f.calls.includes('original'), false);
    assert.equal(f.logs.at(-1).status, status);
  }
});

test('proxy-unavailable503 is distinct from typed auth/timeout/upstream and unknown exceptions', async () => {
  for (const [fixtureOptions, input, code, phase, message] of [
    [{ proxyUnavailable: true }, { headers: { [protocol.APP_LOCAL_TRACE_PROXY_FAILURE]: 'proxy_refresh_unavailable', [protocol.APP_LOCAL_TRACE_PROXY_REFRESH]: '10000.0' } }, 'proxy_refresh_unavailable', 'proxy_refresh', 'Please reconnect and try again.'],
    [{ authError: new TraceFixtureAuthAvailabilityError('private auth detail') }, {}, 'auth_unavailable', 'auth', 'The result could not be confirmed. Please check the current record before trying again.'],
    [{ handlerError: new boundedTraceRead.ReadConnectionError('timeout') }, {}, 'handler_timeout', 'handler', 'The result could not be confirmed. Please check the current record before trying again.'],
    [{ handlerError: new boundedTraceRead.ReadConnectionError('network') }, {}, 'handler_upstream', 'handler', 'The result could not be confirmed. Please check the current record before trying again.'],
    [{ handlerError: Error('timeout after10500 and secret payload') }, {}, 'handler_exception', 'handler', 'The result could not be confirmed. Please check the current record before trying again.'],
  ]) {
    const f = routeFixture(fixtureOptions), response = await f.send(input);
    assert.equal(response.status, 503); assert.equal(response.headers.get(protocol.APP_LOCAL_TRACE_FAILURE_CODE), code);
    assert.equal(f.logs.at(-1).failurePhase, phase); assert.deepEqual(await response.json(), { ok: false, error: message });
    assert.equal(f.calls.filter(value => value === 'original').length, fixtureOptions.handlerError ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(f.logs), /private auth detail|secret payload|private-viewer/);
  }
});

test('completed owner selection and guest read survive logger failures once, with legacy/header mismatch intact', async () => {
  for (const options of [{ shell: true, loggerFailure: true }, { guest: true, loggerFailure: true }]) {
    const f = routeFixture(options), response = await f.send({ name: options.shell ? 'shell.switch-workspace' : hiddenRead, args: options.shell ? { workspaceId: 'private-workspace-never-log' } : { values: [] } });
    assert.equal(response.status, 200); assert.equal(response.headers.get(protocol.APP_LOCAL_TRACE_REQUEST_ID), requestId);
    assert.equal(response.headers.get(protocol.APP_LOCAL_TRACE_FAILURE_CODE), null);
    assert.deepEqual(await response.json(), { ok: true, data: options.shell ? { path: '/staff/today' } : { value: { unchanged: true } } });
    assert.equal(f.calls.filter(value => value === (options.shell ? 'shell' : 'original')).length, 1);
    assert.doesNotMatch(JSON.stringify(f.logs), /private-workspace|private-viewer|args|scope|cookies|stack|message/);
    assert.equal(f.logs.at(-1).commandId, options.shell ? 'shell.switch-workspace' : hiddenRead);
  }
  const f = routeFixture(), result = await f.send({ traceId: 'invalid-metadata', bodyId: bodyId });
  assert.equal(result.status, 200); assert.ok(protocol.appLocalTraceRequestId(result.headers.get(protocol.APP_LOCAL_TRACE_REQUEST_ID)));
  assert.notEqual(result.headers.get(protocol.APP_LOCAL_TRACE_REQUEST_ID), bodyId, 'never manufacture header/body pairing');
});

test('unknown command names and hostile diagnostic headers never become free-form logs', async () => {
  const f = routeFixture({ guest: true }), response = await f.send({ name: 'secret.customer.name', headers: { 'X-Reylumi-Command-Name': 'secret.customer.name', [protocol.APP_LOCAL_TRACE_PROXY_REFRESH]: 'secret-payload', [protocol.APP_LOCAL_TRACE_FAILURE_CODE]: 'secret-failure' } });
  assert.equal(response.status, 401); assert.equal(f.logs.at(-1).commandId, 'unknown');
  assert.doesNotMatch(JSON.stringify(f.logs), /secret|customer|payload/);
});

test('parallel phase failures retain their captured phase and original error identity', async () => {
  const logs = [], trace = tracing.createAppLocalCommandTrace(new Headers({ [protocol.APP_LOCAL_TRACE_REQUEST_ID]: requestId }), { log: row => logs.push(row) });
  const error = new boundedTraceRead.ReadConnectionError('timeout');
  let release; const held = new Promise(resolve => { release = resolve; });
  await trace.run(async () => {
    const failing = trace.measure('auth', async () => { await held; throw error; });
    await trace.measure('handler', async () => 'completed'); release();
    await assert.rejects(failing, received => received === error);
    trace.error(error); trace.finish(new Response(null, { status: 503 }));
  });
  assert.equal(logs.at(-1).failurePhase, 'auth'); assert.equal(logs.at(-1).failureCode, 'handler_timeout');
});

test('diagnostic clock/header/log failures never replace a committed response or thrown error', async () => {
  const trace = tracing.createAppLocalCommandTrace(new Headers(), { clock() { throw Error('clock'); }, utc() { throw Error('date'); }, log() { throw Error('log'); } });
  let writes = 0; const response = new Response('unchanged');
  response.headers.set = () => { throw Error('headers'); };
  const actual = await trace.run(() => trace.measure('handler', async () => { writes++; return response; }));
  assert.equal(trace.finish(actual), response); assert.equal(writes, 1); assert.equal(await response.text(), 'unchanged');
  const original = Error('original');
  await assert.rejects(trace.run(() => trace.measure('handler', async () => { throw original; })), received => received === original);
});

test('escaping connection error keeps its identity and logs no unobserved HTTP status', async () => {
  const original = Error('private connection detail'), f = routeFixture({ connectionError: original });
  await assert.rejects(f.send(), error => error === original);
  assert.equal(f.connectionCalls, 1); assert.deepEqual(f.calls, []);
  const result = f.logs.at(-1);
  assert.equal(result.state, 'result'); assert.equal(result.requestId, requestId);
  assert.equal(Object.hasOwn(result, 'status'), false);
  assert.equal(result.failureCode, 'handler_exception');
  assert.doesNotMatch(JSON.stringify(f.logs), /private connection detail|stack/);
});

test('backend HTTP status observation leaves Response/body and successful business result untouched', async () => {
  const logs = [], trace = tracing.createAppLocalCommandTrace(new Headers(), { clock: () => 0, log: row => logs.push(row) });
  const backend = new Response('private backend body', { status: 503 });
  backend.clone = () => { assert.fail('Status observation must not clone a body'); };
  let attempts = 0;
  const observed = await trace.run(() => tracing.measureAppLocalCommandBackend('rpc', async () => { attempts++; return backend; }));
  assert.equal(observed, backend); assert.equal(backend.bodyUsed, false); assert.equal(attempts, 1);
  const business = trace.finish(new Response('unchanged', { status: 200 }));
  assert.equal(business.status, 200); assert.equal(business.headers.get(protocol.APP_LOCAL_TRACE_FAILURE_CODE), null);
  assert.deepEqual(logs.at(-1).backendStatuses, { rpc: { 503: 1 } });
  assert.deepEqual(logs[0].backendStatuses, {}, 'Dispatch record must remain an immutable observation snapshot');
  assert.equal(logs.at(-1).failureCode, undefined);
  assert.doesNotMatch(business.headers.get('Server-Timing'), /status|503/);
  assert.doesNotMatch(JSON.stringify(logs), /private backend body/);
});

test('status telemetry accepts only real HTTP responses and ignores a failing diagnostic status getter', async () => {
  const rows = [], trace = tracing.createAppLocalCommandTrace(new Headers(), { log: row => rows.push(row) });
  const data = { status: 503, private: 'never log this data' };
  const response = new Response('unread');
  Object.defineProperty(response, 'status', { get() { throw Error('diagnostic status failed'); } });
  assert.equal(await trace.run(() => tracing.measureAppLocalCommandBackend('rpc', async () => data)), data);
  assert.equal(await trace.run(() => tracing.measureAppLocalCommandBackend('rest', async () => response)), response);
  assert.equal(response.bodyUsed, false);
  trace.finish(new Response());
  assert.deepEqual(rows.at(-1).backendStatuses, {});
  assert.deepEqual(rows.at(-1).backendCalls, { rpc: 1, rest: 1 });
  assert.doesNotMatch(JSON.stringify(rows), /never log this data|diagnostic status failed/);
});

test('status-only backend observation stays scoped and never increments calls or duration', async () => {
  const rows = [], otherRows = [];
  const trace = tracing.createAppLocalCommandTrace(new Headers(), { log: row => rows.push(row) });
  const other = tracing.createAppLocalCommandTrace(new Headers(), { log: row => otherRows.push(row) });
  tracing.observeAppLocalCommandBackendStatus('rest', 502);
  await Promise.all([
    trace.run(async () => {
      await Promise.resolve();
      tracing.observeAppLocalCommandBackendStatus('rest', 503);
      for (const status of [99, 600, 503.5, NaN, Infinity, 'private-code']) tracing.observeAppLocalCommandBackendStatus('rest', status);
      tracing.observeAppLocalCommandBackendStatus('private-kind', 503);
      trace.observeBackendStatus('rpc', 429);
    }),
    other.run(async () => { await Promise.resolve(); tracing.observeAppLocalCommandBackendStatus('auth', 401); }),
  ]);
  tracing.observeAppLocalCommandBackendStatus('rpc', 504);
  trace.finish(new Response()); other.finish(new Response());
  assert.deepEqual(rows.at(-1).backendStatuses, { rest: { 503: 1 }, rpc: { 429: 1 } });
  assert.deepEqual(otherRows.at(-1).backendStatuses, { auth: { 401: 1 } });
  for (const result of [rows.at(-1), otherRows.at(-1)]) {
    assert.deepEqual(result.backendCalls, {});
    assert.equal(Object.keys(result.durationsMs).some(stage => stage.startsWith('backend_')), false);
    assert.equal(result.failureCode, undefined);
  }
  assert.doesNotMatch(JSON.stringify(rows), /private-code|private-kind/);
});

test('backend HTTP status counts and kind cardinality are bounded without arbitrary strings', () => {
  const rows = [], trace = tracing.createAppLocalCommandTrace(new Headers(), { log: row => rows.push(row) });
  for (let status = 100; status < 120; status++) trace.observeBackend('rpc', 1, status);
  for (const status of [99, 600, 503.5, NaN, Infinity, 'private-code']) trace.observeBackend('rpc', 1, status);
  trace.observeBackend('private-kind', 1, 503);
  for (let count = 0; count < 1_000_005; count++) trace.observeBackend('rpc', 1, 100);
  trace.finish(new Response());
  const result = rows[0];
  assert.equal(Object.keys(result.backendStatuses.rpc).length, 16);
  assert.deepEqual(Object.keys(result.backendStatuses.rpc), Array.from({ length: 16 }, (_, index) => String(index + 100)));
  assert.equal(result.backendStatuses.rpc[100], 1_000_000);
  assert.equal(result.backendCalls.rpc, 1_000_000); assert.equal(result.durationsMs.backend_rpc, 300_000);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

function proxyFixture(unavailable = false) {
  const forwarded = [], refreshCalls = [];
  const NextResponse = { next({ request }) { const response = new Response(); response.cookies = { set() {} }; forwarded.push(new Headers(request.headers)); return response; } };
  const api = load('proxy.ts', {
    'next/server': { NextResponse }, '@/lib/ios-client': { isReylumiIOSClient: () => false, isIOSExcludedPath: () => false },
    '@/lib/abuse-signals': { ABUSE_DEVICE_COOKIE: 'safety-device', ABUSE_HEADER: 'safety-context', ABUSE_SIGNATURE_HEADER: 'safety-signature', abuseSigningKey: () => null },
    '@/lib/supabase/refresh-session': { refreshRequestSession: async request => { refreshCalls.push(request); return { updates: [], unavailable }; } },
    '@/lib/supabase/session-policy': { ADMIN_SESSION_COOKIE: 'admin' }, '@/lib/app-local-command-trace-protocol': protocol,
  });
  return { forwarded, refreshCalls, run(headers = {}) { const request = new Request('https://reylumi.com/api/app-local/command', { method: 'POST', headers }); request.nextUrl = new URL(request.url); request.cookies = { get: () => undefined, toString: () => '' }; return api.proxy(request); } };
}

test('proxy strips hostile internal timing/failure metadata and supplies one actual refresh without auth changes', async () => {
  for (const unavailable of [false, true]) {
    const f = proxyFixture(unavailable), response = await f.run({ [protocol.APP_LOCAL_TRACE_REQUEST_ID]: requestId.toUpperCase(), [protocol.APP_LOCAL_TRACE_PROXY_REFRESH]: '999999', [protocol.APP_LOCAL_TRACE_PROXY_FAILURE]: 'handler_timeout', [protocol.APP_LOCAL_TRACE_FAILURE_CODE]: 'handler_exception', 'Server-Timing': 'secret;dur=1', 'X-Reylumi-Trace-Forged': 'secret', 'x-reylumi-auth-unavailable': '1' });
    assert.equal(f.refreshCalls.length, 1); assert.equal(response.headers.get(protocol.APP_LOCAL_TRACE_REQUEST_ID), requestId);
    const headers = f.forwarded[0];
    assert.equal(headers.get(protocol.APP_LOCAL_TRACE_REQUEST_ID), requestId);
    assert.match(headers.get(protocol.APP_LOCAL_TRACE_PROXY_REFRESH), /^\d+\.\d$/); assert.notEqual(headers.get(protocol.APP_LOCAL_TRACE_PROXY_REFRESH), '999999');
    assert.equal(headers.get(protocol.APP_LOCAL_TRACE_PROXY_FAILURE), unavailable ? 'proxy_refresh_unavailable' : null);
    assert.equal(headers.get('x-reylumi-auth-unavailable'), unavailable ? '1' : null);
    assert.equal(headers.get(protocol.APP_LOCAL_TRACE_FAILURE_CODE), null); assert.equal(headers.get('Server-Timing'), null); assert.equal(headers.get('X-Reylumi-Trace-Forged'), null);
  }
});

test('missing or malformed UUID metadata is regenerated by proxy and never rejects a command', async () => {
  for (const headers of [{}, { [protocol.APP_LOCAL_TRACE_REQUEST_ID]: 'hostile-invalid' }]) {
    const f = proxyFixture(), response = await f.run(headers);
    assert.equal(response.status, 200); assert.ok(protocol.appLocalTraceRequestId(response.headers.get(protocol.APP_LOCAL_TRACE_REQUEST_ID)));
    assert.equal(f.refreshCalls.length, 1);
  }
});
