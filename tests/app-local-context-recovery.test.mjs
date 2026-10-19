import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const exports = {}, timers = new Map(), delays = [];
  let nextTimer = 0, clock = 0;
  const code = ts.transpileModule(readFileSync('lib/app-local-context-recovery.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('exports', 'setTimeout', 'clearTimeout', 'performance', code)(exports, (callback, delay) => {
    const id = ++nextTimer;
    delays.push(delay); timers.set(id, { callback, delay }); return id;
  }, id => timers.delete(id), { now: () => clock });
  return { ...exports, timers, delays, elapse(ms) { clock += ms; }, advance(ms) { const [id, { callback, delay }] = timers.entries().next().value; timers.delete(id); clock += ms ?? delay; callback(); } };
}

const httpError = status => Object.assign(new Error('Synthetic context failure'), { status });
const connectionError = kind => Object.assign(httpError(503), { name: 'ReadConnectionError', kind });
const nativeError = status => Object.assign(new Error('Synthetic native failure'), { status });

test('classification uses only known status, error name and kind; it never exposes raw error text', () => {
  const { classifyAppLocalContextFailure: classify } = fixture();
  assert.equal(classify(httpError(401)), 'sign-in');
  assert.equal(classify(httpError(403)), 'access');
  assert.equal(classify(httpError(409)), 'workspace');
  for (const [status, category] of [[401,'sign-in'],[403,'access'],[409,'workspace']]) assert.equal(classify(Object.assign(httpError(status), { name: 'AbortError' })), category, 'explicit HTTP denial wins over a misleading error name');
  for (const status of [408,504]) assert.equal(classify(httpError(status)), 'timeout');
  for (const status of [500,503]) assert.equal(classify(httpError(status)), 'unavailable');
  assert.equal(classify(httpError(502)), 'invalid');
  assert.equal(classify(connectionError('timeout')), 'timeout');
  assert.equal(classify(connectionError('network')), 'network');
  assert.equal(classify(connectionError('body-limit')), 'invalid');
  assert.equal(classify(new DOMException('Synthetic timeout', 'TimeoutError')), 'timeout');
  assert.equal(classify(nativeError(-1001)), 'timeout');
  assert.equal(classify(nativeError(-999)), 'verification');
  for (const status of [-1003,-1004,-1005,-1006,-1009]) assert.equal(classify(nativeError(status)), 'network');
  assert.equal(classify({ code: -1005 }), 'network');
  for (const error of [undefined,null,'503',503,new Error('network timeout: secret fixture value'),new TypeError('Failed to fetch'),{status:'503'},connectionError('other')]) assert.equal(classify(error), 'invalid');
});

test('known transient context failures get exactly one cancellable 300ms retry and return the original result', async () => {
  const failures = [408,500,503,504,-1001,-1003,-1004,-1005,-1006,-1009].map(httpError);
  failures.push(connectionError('network'), connectionError('timeout'), new DOMException('Synthetic deadline', 'TimeoutError'));
  for (const failure of failures) {
    const f = fixture(), result = { scope: 'synthetic-scope', grant: null };
    let calls = 0;
    const pending = f.runAppLocalContextRead(async () => { if (++calls === 1) throw failure; return result; }, new AbortController().signal);
    await tick();
    assert.equal(calls, 1);
    assert.deepEqual(f.delays, [300]);
    f.advance();
    assert.equal(await pending, result);
    assert.equal(calls, 2);
    assert.equal(f.timers.size, 0);
  }
});

test('denial, cancellation, body limits, malformed data and unknown errors are never retried', async () => {
  const failures = [400,401,403,404,409,413,429,501,502].map(httpError);
  failures.push(new DOMException('Synthetic cancellation','AbortError'), connectionError('body-limit'), connectionError('unknown'), new Error('Synthetic admission failure'), new SyntaxError('Synthetic JSON failure'), new TypeError('Failed to fetch'), nativeError(-999), {status:'503'});
  // An error name cannot override a confirmed access denial or other nonretryable HTTP response.
  failures.push(Object.assign(httpError(403), { name: 'TimeoutError' }), Object.assign(httpError(429), { name: 'ReadConnectionError', kind: 'network' }));
  for (const failure of failures) {
    const f = fixture(); let calls = 0;
    await assert.rejects(f.runAppLocalContextRead(async () => { calls++; throw failure; }, new AbortController().signal), error => error === failure);
    assert.equal(calls, 1);
    assert.deepEqual(f.delays, []);
    assert.equal(f.timers.size, 0);
  }
});

test('a second transient failure is returned unchanged without a third read or another delay', async () => {
  const f = fixture(), first = httpError(503), second = connectionError('timeout');
  let calls = 0;
  const pending = f.runAppLocalContextRead(async () => { throw ++calls === 1 ? first : second; }, new AbortController().signal);
  await tick();
  const rejected = assert.rejects(pending, error => error === second);
  f.advance(); await rejected;
  assert.equal(calls, 2);
  assert.deepEqual(f.delays, [300]);
  assert.equal(f.timers.size, 0);
});

test('ambiguous native 502 stays manual-only for both invalid schema and genuine gateway failures', async () => {
  for (const message of ['App access could not be checked.', 'Synthetic HTTP gateway failure']) {
    const f = fixture(), error = Object.assign(new Error(message), { status: 502 });
    let calls = 0;
    assert.equal(f.classifyAppLocalContextFailure(error), 'invalid');
    await assert.rejects(f.runAppLocalContextRead(async () => { calls++; throw error; }, new AbortController().signal), value => value === error);
    assert.equal(calls, 1);
    assert.deepEqual(f.delays, []);
  }
});

test('an already cancelled context starts no read and returns its cancellation reason', async () => {
  const f = fixture(), controller = new AbortController(), reason = new DOMException('Synthetic route changed', 'AbortError');
  controller.abort(reason); let calls = 0;
  await assert.rejects(f.runAppLocalContextRead(async () => { calls++; }, controller.signal), error => error === reason);
  assert.equal(calls, 0);
  assert.deepEqual(f.delays, []);
});

test('cancellation during the retry delay clears the timer and prevents the second read', async () => {
  const f = fixture(), controller = new AbortController(); let calls = 0;
  const pending = f.runAppLocalContextRead(async () => { calls++; throw httpError(503); }, controller.signal);
  await tick(); assert.equal(f.timers.size, 1);
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  controller.abort(); await rejected;
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0);
});

test('cancellation releases a held context read immediately and ignores its later success', async () => {
  const f = fixture(), controller = new AbortController(); let calls = 0, finish;
  const pending = f.runAppLocalContextRead(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, controller.signal);
  await tick();
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  controller.abort(); await rejected;
  finish({ scope: 'obsolete-scope' }); await tick();
  assert.equal(calls, 1);
  assert.deepEqual(f.delays, []);
});

test('cancellation during the second read rejects late data without another retry', async () => {
  const f = fixture(), controller = new AbortController(); let calls = 0, finish;
  const pending = f.runAppLocalContextRead(() => { if (++calls === 1) return Promise.reject(httpError(503)); return new Promise(resolve => { finish = resolve; }); }, controller.signal);
  await tick(); f.advance(); await tick();
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  controller.abort(); await rejected;
  finish({ scope: 'obsolete-scope' }); await tick();
  assert.equal(calls, 2);
  assert.equal(f.timers.size, 0);
});

test('synchronous read failures are bounded too; successful reads do not delay or retry caller acceptance', async () => {
  const f = fixture(); let calls = 0;
  const pending = f.runAppLocalContextRead(() => { if (++calls === 1) throw httpError(500); return Promise.resolve('verified'); }, new AbortController().signal);
  await tick(); f.advance(); assert.equal(await pending, 'verified');
  assert.equal(calls, 2);
  const acceptanceFailure = new Error('Synthetic changed scope'); let successfulReads = 0;
  await assert.rejects((async () => {
    await f.runAppLocalContextRead(async () => { successfulReads++; return 'verified'; }, new AbortController().signal);
    throw acceptanceFailure;
  })(), error => error === acceptanceFailure);
  assert.equal(successfulReads, 1);
  assert.deepEqual(f.delays, [300]);
});

test('a 12s native timeout can retry once but a first 15s or 25s bridge wait cannot repeat', async () => {
  for (const firstDuration of [12000,15000,25000]) {
    const f = fixture(), error = nativeError(-1001); let calls = 0;
    const pending = f.runAppLocalContextRead(async () => { if (++calls === 1) { f.elapse(firstDuration); throw error; } return 'verified'; }, new AbortController().signal);
    if (firstDuration < 15000) {
      await tick(); assert.equal(f.timers.size, 1); f.advance();
      assert.equal(await pending, 'verified'); assert.equal(calls, 2);
    } else {
      await assert.rejects(pending, value => value === error);
      assert.equal(calls, 1); assert.deepEqual(f.delays, []);
    }
    assert.equal(f.timers.size, 0);
  }
});

test('eligibility is rechecked after the delay so a late wake cannot start another read', async () => {
  for (const [firstDuration, actualDelay] of [[14900,300],[1000,16000]]) {
    const f = fixture(), error = httpError(503); let calls = 0;
    const pending = f.runAppLocalContextRead(async () => { calls++; f.elapse(firstDuration); throw error; }, new AbortController().signal);
    await tick();
    const rejected = assert.rejects(pending, value => value === error);
    f.advance(actualDelay); await rejected;
    assert.equal(calls, 1);
    assert.deepEqual(f.delays, [300]);
    assert.equal(f.timers.size, 0);
  }
});
