import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pendingChanges, readJournal, recordEvent } from '../scripts/release-journal.mjs';

const prefix = 'reylumi-journal-line-endings-';
function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
async function fixture(t) {
  const base = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(base, prefix));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), base, 'cleanup stays in the verified temporary parent');
    assert.ok(path.basename(resolved).startsWith(prefix), 'cleanup only removes this named fixture');
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const primary = path.join(directory, 'repository');
  const linked = path.join(directory, 'linked-worktree');
  const hooks = path.join(directory, 'empty-hooks');
  await fs.mkdir(primary);
  await fs.mkdir(hooks);
  git(primary, 'init', '-b', 'main');
  git(primary, 'config', 'user.name', 'Journal line endings fixture');
  git(primary, 'config', 'user.email', 'journal-fixture@example.invalid');
  git(primary, 'config', 'commit.gpgsign', 'false');
  git(primary, 'config', 'core.hooksPath', hooks);
  git(primary, 'config', 'core.autocrlf', 'false');
  git(primary, 'commit', '--allow-empty', '-m', 'Initialize isolated journal fixture');
  git(primary, 'worktree', 'add', '--detach', linked, 'HEAD');
  const record = recordEvent({
    kind: 'change', changeId: 'line-endings-fixture', status: 'working',
    summary: 'Same immutable event across Git worktrees', channels: ['web', 'ios'],
    files: ['app/example.ts'],
    source: { commit: 'a'.repeat(40), metadata: { alpha: true, nested: { first: 1, second: null } } },
    validation: [{ name: 'first check', result: 'passed' }, { name: 'second check', result: 'pending' }],
  }, { cwd: primary });
  const original = await fs.readFile(record.filePath);
  const event = JSON.parse(original);
  const duplicatePath = path.join(linked, 'releases', 'changes', path.basename(record.filePath));
  await fs.mkdir(path.dirname(duplicatePath), { recursive: true });
  return { primary, linked, record, event, original, duplicatePath };
}
function reversedObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reversedObjectKeys);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversedObjectKeys(child)]));
  return value;
}

test('linked worktrees deduplicate JSON with LF/CRLF, whitespace and nested key order without changing bytes', async t => {
  const f = await fixture(t);
  const formatted = Buffer.from('\r\n  ' + JSON.stringify(reversedObjectKeys(f.event), null, 4).replaceAll('\n', '\r\n') + '\r\n');
  assert.notDeepEqual(formatted, f.original);
  await fs.writeFile(f.duplicatePath, formatted);
  for (const cwd of [f.primary, f.linked]) {
    const journal = readJournal({ cwd });
    assert.equal(journal.length, 1);
    assert.deepEqual(journal[0], f.event);
    const pending = pendingChanges({ cwd });
    assert.equal(pending.length, 1);
    assert.equal(pending[0].eventId, f.record.id);
    assert.deepEqual(pending[0].pendingChannels, ['web', 'ios']);
  }
  assert.deepEqual(await fs.readFile(f.record.filePath), f.original);
  assert.deepEqual(await fs.readFile(f.duplicatePath), formatted);
});

test('semantic deduplication still rejects changed values, array order and missing nested fields', async t => {
  const f = await fixture(t);
  const mutations = [
    ['summary', event => { event.summary += ' changed'; }],
    ['array order', event => { event.channels.reverse(); }],
    ['nested value', event => { event.source.metadata.nested.first = 2; }],
    ['value type', event => { event.source.metadata.nested.first = '1'; }],
    ['missing field', event => { delete event.source.metadata.nested.second; }],
  ];
  for (const [name, mutate] of mutations) {
    const changed = structuredClone(f.event);
    mutate(changed);
    const bytes = Buffer.from(JSON.stringify(reversedObjectKeys(changed), null, 4).replaceAll('\n', '\r\n') + '\r\n');
    await fs.writeFile(f.duplicatePath, bytes);
    for (const cwd of [f.primary, f.linked]) {
      assert.throws(() => readJournal({ cwd }), /Conflicting copies of journal event/, name);
      assert.throws(() => pendingChanges({ cwd }), /Conflicting copies of journal event/, name);
    }
    assert.deepEqual(await fs.readFile(f.record.filePath), f.original, `${name} does not rewrite the original event`);
    assert.deepEqual(await fs.readFile(f.duplicatePath), bytes, `${name} does not repair or rewrite a conflicting event`);
  }
});

test('record command diagnostic filePath is ignored without rewriting either immutable copy', async t => {
  const f = await fixture(t);
  const output = Buffer.from(JSON.stringify({ ...f.event, filePath: 'C:/historical-machine/transport-output.json' }, null, 2));
  await fs.writeFile(f.duplicatePath, output);
  for (const cwd of [f.primary, f.linked]) {
    assert.deepEqual(readJournal({ cwd }), [f.event]);
    assert.equal(pendingChanges({ cwd })[0].eventId, f.record.id);
  }
  assert.deepEqual(await fs.readFile(f.record.filePath), f.original);
  assert.deepEqual(await fs.readFile(f.duplicatePath), output);
  await fs.writeFile(f.duplicatePath, JSON.stringify({ ...f.event, filePath: 'local-only', summary: 'Actually changed event' }));
  assert.throws(() => readJournal({ cwd: f.primary }), /Conflicting copies of journal event/);
});
