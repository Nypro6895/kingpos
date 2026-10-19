import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync('lib/experience-authorized-read.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { createExperienceAuthorizedReads } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));

test('equivalent pending reads join while distinct authority keys remain independent; settled results are never cached', async () => {
  const reads = createExperienceAuthorizedReads(), held = [], calls = [];
  const run = signal => { calls.push(signal); return new Promise(resolve => held.push(resolve)); };
  const first = reads.read('scope/path/generation', run), second = reads.read('scope/path/generation', run);
  const different = reads.read('other-scope/path/generation', run);
  await tick(); assert.equal(calls.length, 2);
  held[0]('same'); held[1]('other');
  assert.deepEqual(await Promise.all([first, second, different]), ['same', 'same', 'other']);
  assert.equal(await reads.read('scope/path/generation', async () => 'fresh'), 'fresh');
});

test('one cancelled consumer settles immediately without aborting the other consumer transport', async () => {
  const reads = createExperienceAuthorizedReads(), one = new AbortController(), two = new AbortController();
  let finish, transport;
  const run = signal => { transport = signal; return new Promise(resolve => { finish = resolve; }); };
  const first = reads.read('same', run, one.signal), second = reads.read('same', run, two.signal);
  await tick(); one.abort();
  assert.equal(await first, null); assert.equal(transport.aborted, false);
  finish('authorized'); assert.equal(await second, 'authorized');
});

test('cancelling the final consumer aborts the old transport and a later caller starts a separate read', async () => {
  const reads = createExperienceAuthorizedReads(), one = new AbortController(), two = new AbortController();
  let finish, transport;
  const run = signal => { transport = signal; return new Promise(resolve => { finish = resolve; }); };
  const first = reads.read('same', run, one.signal), second = reads.read('same', run, two.signal);
  await tick(); one.abort(); two.abort();
  assert.deepEqual(await Promise.all([first, second]), [null, null]); assert.equal(transport.aborted, true);
  const next = reads.read('same', async () => 'new authority');
  finish('late old authority'); assert.equal(await next, 'new authority');
});

test('reset cancels every subscriber even when a reader ignores abort, and late completion cannot evict a new read', async () => {
  const reads = createExperienceAuthorizedReads(); let oldFinish, newFinish;
  const old = reads.read('same', async () => new Promise(resolve => { oldFinish = resolve; }));
  await tick(); reads.reset(); assert.equal(await old, null);
  const next = reads.read('same', async () => new Promise(resolve => { newFinish = resolve; }));
  await tick(); oldFinish('obsolete'); await tick();
  const joined = reads.read('same', async () => assert.fail('the new request must remain owned'));
  newFinish('current'); assert.deepEqual(await Promise.all([next, joined]), ['current', 'current']);
});

test('already cancelled callers start no work and failures settle without retaining authority or poisoning later reads', async () => {
  const reads = createExperienceAuthorizedReads(), controller = new AbortController(); controller.abort();
  assert.equal(await reads.read('same', async () => assert.fail('cancelled work'), controller.signal), null);
  assert.equal(await reads.read('same', async () => { throw Error('Synthetic transport failure'); }), null);
  assert.equal(await reads.read('same', async () => 'recovered'), 'recovered');
});
