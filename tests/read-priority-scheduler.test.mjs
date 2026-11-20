import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source = await fs.readFile(new URL('../lib/read-priority-scheduler.ts', import.meta.url), 'utf8');
const { createReadPriorityScheduler } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const spec = (key, run, extra = {}) => ({ scope: 'owner-A', key, priority: 100, background: true, run, ...extra });

test('spare connection never starts another page while the visible page is loading', async () => {
  const q = createReadPriorityScheduler(2), gate = deferred(), seen = [];
  q.setActiveRoute('/today');
  const visible = q.run(spec('visible', () => { seen.push('visible'); return gate.promise; }, {route:'/today',background:false,priority:0}));
  const ahead = q.run(spec('ahead', async () => { seen.push('ahead'); return 2; }, {route:'/reports'}));
  await tick(); await tick(); assert.deepEqual(seen,['visible']);
  gate.resolve(1); assert.equal(await visible,1); assert.equal(await ahead,2);
  assert.deepEqual(seen,['visible','ahead']);
});

test('only one speculative read runs; foreground outranks remaining queue', async () => {
  const q = createReadPriorityScheduler(), first = deferred(), seen = [];
  const a = q.run(spec('a', () => { seen.push('a'); return first.promise; }));
  const b = q.run(spec('b', async () => { seen.push('b'); return 2; }));
  await tick(); assert.deepEqual(seen, ['a']);
  const visible = q.run(spec('visible', async () => { seen.push('visible'); return 3; }, { background: false, priority: 0 }));
  assert.equal(await visible, 3); first.resolve(1);
  await Promise.all([a,b]); assert.equal(seen[1], 'visible');
});
test('foreground preempts background and late ignored-abort result cannot settle it', async () => {
  const q = createReadPriorityScheduler(1), stale = deferred(); let attempts = 0;
  const bg = q.run(spec('background', signal => { attempts++; if (attempts === 1) { assert.equal(signal.aborted, false); return stale.promise; } return Promise.resolve('fresh'); }));
  await tick();
  const active = q.run(spec('active', async () => 'active', { priority: 0, background: false }));
  assert.equal(await active, 'active'); assert.equal(await bg, 'fresh');
  stale.resolve('stale'); await tick(); assert.equal(attempts, 2);
});
test('same scoped key shares work and cancelling one consumer keeps another alive', async () => {
  const q = createReadPriorityScheduler(), gate = deferred(), controller = new AbortController(); let calls = 0;
  const run = () => { calls++; return gate.promise; };
  const a = q.run(spec('same', run, { signal: controller.signal }));
  const b = q.run(spec('same', run, { background: false, priority: 0 }));
  await tick(); controller.abort(); await assert.rejects(a, { name: 'AbortError' });
  gate.resolve(9); assert.equal(await b, 9); assert.equal(calls, 1);
});
test('scope change cancels old queued and running work without accepting its late reply', async () => {
  const q = createReadPriorityScheduler(), late = deferred(); q.setActiveScope('owner-A');
  const a = q.run(spec('running', () => late.promise));
  const b = q.run(spec('queued', async () => 'wrong'));
  const rejected = Promise.all([assert.rejects(a, { name: 'AbortError' }), assert.rejects(b, { name: 'AbortError' })]);
  await tick(); q.setActiveScope('staff-B'); await rejected; late.resolve('old');
  await assert.rejects(q.run(spec('old-scope', async () => 1)), { name: 'AbortError' });
  assert.equal(await q.run(spec('new', async () => 2, { scope: 'staff-B' })), 2);
});
test('pause yields speculative reads and resumes without rerunning completed reads', async () => {
  const q = createReadPriorityScheduler(); q.setPaused(true); let calls = 0;
  const bg = q.run(spec('bg', async () => ++calls)); await tick(); assert.equal(calls, 0);
  const fg = q.run(spec('fg', async () => 'ready', { priority: 0, background: false })); assert.equal(await fg, 'ready');
  q.setPaused(false); assert.equal(await bg, 1); q.setPaused(false); await tick(); assert.equal(calls, 1);
});
test('navigation promotes queued destination and demotes previous route', async () => {
  const q = createReadPriorityScheduler(1); q.setPaused(true); q.setActiveRoute('/today'); const seen = [];
  const old = q.run(spec('old', async () => { seen.push('old'); return 1; }, { route: '/today' }));
  const destination = q.run(spec('next', async () => { seen.push('next'); return 2; }, { route: '/book' }));
  q.setActiveRoute('/book'); q.setPaused(false); await Promise.all([old, destination]); assert.deepEqual(seen, ['next','old']);
});
test('failed item releases queue and does not block subsequent reads', async () => {
  const q = createReadPriorityScheduler(1);
  const failed = q.run(spec('bad', async () => { throw new Error('network'); }));
  const good = q.run(spec('good', async () => 7));
  await assert.rejects(failed, /network/); assert.equal(await good, 7);
});
test('active-route speculation remains below visible section priority', async () => {
  const q = createReadPriorityScheduler(1); q.setActiveRoute('/explore'); let attempts = 0;
  const bg = q.run(spec('ahead', () => ++attempts === 1 ? new Promise(() => {}) : Promise.resolve('ahead'), { route: '/explore', priority: 80 }));
  await tick();
  assert.equal(await q.run(spec('section', async () => 'visible', { route: '/explore', background: false, priority: 20 })), 'visible');
  assert.equal(await bg, 'ahead');
});
test('a speculative join cannot move a foreground read to another route', async () => {
  const q = createReadPriorityScheduler(); q.setActiveRoute('/current'); q.setPaused(true); const gate = deferred();
  const fg = q.run(spec('shared', () => gate.promise, { route: '/current', priority: 0, background: false }));
  const bg = q.run(spec('shared', () => gate.promise, { route: '/other', priority: 80 }));
  await tick(); assert.equal(q.snapshot()[0].background, false); gate.resolve(1); await Promise.all([fg,bg]);
});
