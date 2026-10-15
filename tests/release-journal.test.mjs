import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { acquireReleaseLock, pendingChanges, readJournal, recordEvent, releaseReleaseLock } from '../scripts/release-journal.mjs';

const PREFIX = 'reylumi-release-journal-test-';
const moduleUrl = pathToFileURL(path.resolve('scripts/release-journal.mjs')).href;
function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
async function fixture(t) {
  const base = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(base, PREFIX));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    const relative = path.relative(base, resolved);
    assert.equal(path.dirname(resolved), base, 'cleanup stays inside the verified temporary parent');
    assert.equal(relative, path.basename(resolved));
    assert.ok(path.basename(resolved).startsWith(PREFIX), 'cleanup only removes the named release-journal test fixture');
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const primary = path.join(directory, 'repository'), linked = path.join(directory, 'linked-worktree');
  const snapshot = path.join(directory, 'frozen-snapshot'), evidence = path.join(directory, 'validation-receipt.txt');
  await fs.mkdir(path.join(primary, 'app'), { recursive: true });
  await fs.mkdir(path.join(snapshot, 'app'), { recursive: true });
  await fs.mkdir(path.join(directory, 'empty-hooks'));
  await fs.writeFile(path.join(primary, 'app/example.ts'), 'export const release = "mutable checkout";\n');
  await fs.writeFile(path.join(snapshot, 'app/example.ts'), 'export const release = "frozen candidate";\n');
  await fs.writeFile(evidence, 'Fixture validation evidence only. No deployment occurred.\n');
  git(primary, 'init', '-b', 'main');
  git(primary, 'config', 'user.name', 'Release journal fixture');
  git(primary, 'config', 'user.email', 'release-journal-fixture@example.invalid');
  git(primary, 'config', 'commit.gpgsign', 'false');
  git(primary, 'config', 'core.hooksPath', path.join(directory, 'empty-hooks'));
  git(primary, 'add', 'app/example.ts');
  git(primary, 'commit', '-m', 'Initialize isolated journal fixture');
  git(primary, 'worktree', 'add', '--detach', linked, 'HEAD');
  return { directory, primary, linked, snapshot, evidence, commit: git(primary, 'rev-parse', 'HEAD') };
}
const change = (patch = {}) => ({ kind: 'change', changeId: 'fixture', status: 'working', summary: 'Fixture change', channels: ['web', 'ios'], files: ['app/example.ts'], ...patch });
const ready = (f, patch = {}) => change({ status: 'ready', source: { snapshot: f.snapshot }, validation: [{ name: 'fixture build', result: 'passed' }], ...patch });
const webPublished = (f, patch = {}) => ({ status: 'published', verified: true, deploymentId: 'dpl_fixture', baselineDeploymentId: 'dpl_fixtureBase', sourceSha256: 'a'.repeat(64), overlaySha256: 'b'.repeat(64), evidence: f.evidence, ...patch });
const release = (f, changes, targets) => ({ kind: 'release', summary: 'Fixture publication evidence', changes, targets: targets ?? {
  web: webPublished(f),
  ios: { status: 'testflight-available', verified: true, version: '1.0.1', build: '6.1', commit: f.commit, evidence: f.evidence },
} });
const hash = value => createHash('sha256').update(value).digest('hex');
async function captureInProcess(cwd, input) {
  const script = `const api=await import(process.argv[1]);const record=await api.recordEvent(JSON.parse(process.argv[3]),{cwd:process.argv[2]});process.stdout.write(JSON.stringify({id:record.id,filePath:record.filePath,recordedAt:record.recordedAt}));`;
  return await new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ['--input-type=module', '-e', script, moduleUrl, cwd, JSON.stringify(input)], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    process.stdout.on('data', value => { output += value; });
    process.stderr.on('data', value => { error += value; });
    process.on('error', reject);
    process.on('close', status => { if (status !== 0) reject(new Error(`Concurrent recorder failed: ${error}`)); else { try { resolve(JSON.parse(output)); } catch (cause) { reject(cause); } } });
  });
}

test('concurrent captures are dated, unique, immutable and visible once from both linked worktrees', async t => {
  const f = await fixture(t);
  const first = await recordEvent(change({ summary: 'Immutable first record' }), { cwd: f.primary });
  const bytes = await fs.readFile(first.filePath);
  const concurrent = await Promise.all(Array.from({ length: 4 }, (_, index) => captureInProcess(index % 2 ? f.linked : f.primary, change({ summary: `Concurrent capture ${index}` }))));
  const records = [first, ...concurrent];
  assert.equal(new Set(records.map(record => record.id)).size, 5);
  assert.equal(new Set(records.map(record => record.filePath)).size, 5, 'parallel captures never share an overwrite destination');
  for (const record of records) {
    assert.match(record.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.equal(new Date(record.recordedAt).toISOString(), record.recordedAt, 'timestamps use UTC ISO format');
    assert.ok(path.isAbsolute(record.filePath));
    assert.equal(JSON.parse(await fs.readFile(record.filePath, 'utf8')).id, record.id);
    await assert.rejects(fs.writeFile(record.filePath, 'overwrite forbidden', { flag: 'wx' }), { code: 'EEXIST' });
  }
  assert.deepEqual(await fs.readFile(first.filePath), bytes, 'later captures never rewrite an earlier event');
  const duplicate = path.join(f.linked, 'releases', 'changes', path.basename(first.filePath));
  await fs.mkdir(path.dirname(duplicate), { recursive: true });
  await fs.copyFile(first.filePath, duplicate);
  for (const cwd of [f.primary, f.linked]) {
    const journal = await readJournal({ cwd });
    assert.deepEqual(journal.map(record => record.id).sort(), records.map(record => record.id).sort(), 'linked worktrees see the same deduplicated journal');
  }
  await fs.writeFile(duplicate, JSON.stringify({ ...JSON.parse(bytes), summary: 'Conflicting duplicate in this isolated fixture' }));
  await assert.rejects(async () => readJournal({ cwd: f.primary }), /conflict/i, 'conflicting copies cannot silently replace immutable evidence');
});

test('ready records hash declared frozen source rather than mutable checkout files', async t => {
  const f = await fixture(t);
  const record = await recordEvent(ready(f), { cwd: f.linked });
  const fileHashes = record.fileHashes ?? record.source?.fileHashes;
  assert.ok(fileHashes, 'the ready record includes source hashes');
  const frozenHash = hash(await fs.readFile(path.join(f.snapshot, 'app/example.ts')));
  assert.equal(fileHashes['app/example.ts'], frozenHash);
  assert.notEqual(frozenHash, hash(await fs.readFile(path.join(f.primary, 'app/example.ts'))));
  const raw = await fs.readFile(record.filePath);
  await fs.writeFile(path.join(f.snapshot, 'app/example.ts'), 'Changed only inside this isolated negative-test fixture.\n');
  assert.deepEqual(await fs.readFile(record.filePath), raw, 'recorded evidence cannot drift when its original directory is later changed');
});

test('ready rejects both worktree roots and pending or failed validation without appending events', async t => {
  const f = await fixture(t);
  const inputs = [ready(f, { source: { snapshot: f.primary } }), ready(f, { source: { snapshot: f.linked } }),
    ready(f, { validation: [{ name: 'build', result: 'failed' }] }),
    ready(f, { validation: [{ name: 'build', result: 'passed' }, { name: 'browser', result: 'pending' }] })];
  for (const input of inputs) await assert.rejects(async () => recordEvent(input, { cwd: f.primary }));
  assert.deepEqual(await readJournal({ cwd: f.linked }), [], 'rejected readiness claims leave no journal evidence');
});

test('unsafe secret names and path escapes cannot be captured from a source snapshot', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.snapshot, '.env'), 'FIXTURE_ONLY=not-a-real-secret\n');
  await fs.writeFile(path.join(f.snapshot, '.env.production'), 'FIXTURE_ONLY=not-a-real-secret\n');
  await fs.writeFile(path.join(f.directory, 'outside.txt'), 'Outside the declared source snapshot.\n');
  for (const file of ['.env', '.env.production', '../outside.txt', '..\\outside.txt', 'app/../../outside.txt', path.join(f.directory, 'outside.txt')]) {
    await assert.rejects(async () => recordEvent(ready(f, { files: [file] }), { cwd: f.primary }), `unsafe file ${file}`);
  }
  assert.deepEqual(await readJournal({ cwd: f.primary }), []);
});

test('each channel resolves only a verified publication of the exact captured revision', async t => {
  const f = await fixture(t);
  const first = await recordEvent(ready(f), { cwd: f.primary });
  let pending = await pendingChanges({ cwd: f.linked });
  assert.deepEqual(pending.map(({ changeId, eventId, status, pendingChannels }) => ({ changeId, eventId, status, pendingChannels: [...pendingChannels].sort() })), [{ changeId: 'fixture', eventId: first.id, status: 'ready', pendingChannels: ['ios', 'web'] }]);
  await assert.rejects(async () => recordEvent(release(f, [first.id], {
    web: webPublished(f, { verified: false }),
    ios: { status: 'testflight-available', verified: false, version: '1.0.1', build: '6.1', commit: f.commit, evidence: f.evidence },
  }), { cwd: f.linked }), /verified|evidence/i);
  assert.deepEqual([...(await pendingChanges({ cwd: f.primary }))[0].pendingChannels].sort(), ['ios', 'web'], 'an unverified success label cannot mark either channel delivered');
  await recordEvent(release(f, [first.id], { web: webPublished(f) }), { cwd: f.primary });
  assert.deepEqual((await pendingChanges({ cwd: f.linked }))[0].pendingChannels, ['ios'], 'publishing web does not claim iOS delivery');
  await recordEvent(release(f, [first.id], { ios: { status: 'testflight-available', verified: true, version: '1.0.1', build: '6.1', commit: f.commit, evidence: f.evidence } }), { cwd: f.linked });
  assert.deepEqual(await pendingChanges({ cwd: f.primary }), []);
  const next = await recordEvent(change({ summary: 'A new source revision is still in progress' }), { cwd: f.linked });
  await recordEvent(release(f, [first.id]), { cwd: f.primary });
  pending = await pendingChanges({ cwd: f.primary });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].eventId, next.id, 'an older release cannot resolve a newer revision with the same changeId');
  assert.deepEqual([...pending[0].pendingChannels].sort(), ['ios', 'web']);
});

test('verified intermediate build statuses still leave both delivery channels pending', async t => {
  const f = await fixture(t);
  const event = await recordEvent(ready(f), { cwd: f.primary });
  await recordEvent(release(f, [event.id], {
    web: { status: 'built', verified: true, deploymentId: 'dpl_fixture', evidence: f.evidence },
    ios: { status: 'uploaded', verified: true, version: '1.0.1', build: '6.1', commit: f.commit, evidence: f.evidence },
  }), { cwd: f.linked });
  assert.deepEqual([...(await pendingChanges({ cwd: f.primary }))[0].pendingChannels].sort(), ['ios', 'web'], 'a build or upload is not a published web or available TestFlight release');
});

test('a newer working revision cannot hide an earlier ready revision with an unshipped native channel', async t => {
  const f = await fixture(t);
  const previous = await recordEvent(ready(f, { summary: 'Earlier frozen web and native candidate' }), { cwd: f.primary });
  await recordEvent(release(f, [previous.id], { web: webPublished(f) }), { cwd: f.primary });
  const working = await recordEvent(change({ summary: 'Follow-up still in development' }), { cwd: f.linked });
  const pending = new Map((await pendingChanges({ cwd: f.linked })).map(entry => [entry.eventId, entry]));
  assert.equal(pending.size, 2);
  assert.equal(pending.get(previous.id).status, 'ready');
  assert.deepEqual(pending.get(previous.id).pendingChannels, ['ios'], 'the earlier actual ready native candidate remains available to integrate and release');
  assert.equal(pending.get(working.id).status, 'working');
  assert.deepEqual([...pending.get(working.id).pendingChannels].sort(), ['ios', 'web']);
  await recordEvent(release(f, [previous.id], { ios: { status: 'testflight-available', verified: true, version: '1.0.1', build: '6.1', commit: f.commit, evidence: f.evidence } }), { cwd: f.linked });
  const after = await pendingChanges({ cwd: f.primary });
  assert.equal(after.length, 1);
  assert.equal(after[0].eventId, working.id, 'shipping the old native candidate does not accidentally publish the follow-up revision');
});

test('ready revisions only supersede explicitly named events on overlapping channels', async t => {
  const f = await fixture(t);
  const original = await recordEvent(ready(f, { summary: 'Original candidate for both channels' }), { cwd: f.primary });
  const webReplacement = await recordEvent(ready(f, { summary: 'Replacement for web only', channels: ['web'], supersedesEvents: [original.id] }), { cwd: f.linked });
  let pending = new Map((await pendingChanges({ cwd: f.primary })).map(entry => [entry.eventId, entry]));
  assert.equal(pending.size, 2);
  assert.deepEqual(pending.get(original.id).pendingChannels, ['ios'], 'web supersession does not discard the unshipped native half of the original candidate');
  assert.deepEqual(pending.get(webReplacement.id).pendingChannels, ['web']);
  const anotherNative = await recordEvent(ready(f, { summary: 'Another native candidate without a supersession claim', channels: ['ios'] }), { cwd: f.primary });
  pending = new Map((await pendingChanges({ cwd: f.linked })).map(entry => [entry.eventId, entry]));
  assert.equal(pending.size, 3, 'a later ready event does not silently erase an earlier unshipped ready event');
  assert.deepEqual(pending.get(original.id).pendingChannels, ['ios']);
  assert.deepEqual(pending.get(anotherNative.id).pendingChannels, ['ios']);
  const nativeReplacement = await recordEvent(ready(f, { summary: 'Explicit native replacement', channels: ['ios'], supersedesEvents: [original.id, anotherNative.id] }), { cwd: f.linked });
  pending = new Map((await pendingChanges({ cwd: f.primary })).map(entry => [entry.eventId, entry]));
  assert.equal(pending.size, 2);
  assert.deepEqual(pending.get(webReplacement.id).pendingChannels, ['web'], 'unrelated web publication stays pending');
  assert.deepEqual(pending.get(nativeReplacement.id).pendingChannels, ['ios']);
  assert.equal(pending.has(original.id), false, 'both halves of the original are now explicitly superseded by their corresponding channel candidates');
  assert.equal(pending.has(anotherNative.id), false);
});

test('published web receipts require a valid captured baseline and complete source and overlay hashes', async t => {
  const f = await fixture(t);
  const event = await recordEvent(ready(f), { cwd: f.primary });
  for (const patch of [
    { baselineDeploymentId: undefined }, { baselineDeploymentId: 'unverified-alias' },
    { sourceSha256: undefined }, { sourceSha256: 'a'.repeat(63) }, { sourceSha256: 'g'.repeat(64) },
    { overlaySha256: undefined }, { overlaySha256: 'b'.repeat(63) }, { overlaySha256: 'z'.repeat(64) },
  ]) await assert.rejects(async () => recordEvent(release(f, [event.id], { web: webPublished(f, patch) }), { cwd: f.linked }), `incomplete release provenance: ${Object.keys(patch)[0]}`);
  assert.deepEqual((await readJournal({ cwd: f.primary })).map(record => record.id), [event.id], 'invalid provenance never appends a false publication receipt');
  assert.deepEqual([...(await pendingChanges({ cwd: f.linked }))[0].pendingChannels].sort(), ['ios', 'web']);
  await recordEvent(release(f, [event.id], { web: webPublished(f) }), { cwd: f.linked });
  assert.deepEqual((await pendingChanges({ cwd: f.primary }))[0].pendingChannels, ['ios'], 'a complete valid web receipt only resolves web');
});

test('a single Git-common lock wins across worktrees and only its token can release it', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([Promise.resolve().then(() => acquireReleaseLock('primary owner', { cwd: f.primary })), Promise.resolve().then(() => acquireReleaseLock('linked owner', { cwd: f.linked }))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'only one concurrent release owner can acquire the common lock');
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const winner = results.find(result => result.status === 'fulfilled').value;
  assert.ok(winner.token);
  assert.ok(path.isAbsolute(winner.path));
  assert.ok(['primary owner', 'linked owner'].includes(winner.owner));
  await assert.rejects(async () => acquireReleaseLock('third owner', { cwd: f.linked }));
  const lockedBytes = await fs.readFile(winner.path);
  await assert.rejects(async () => releaseReleaseLock('wrong-token', { cwd: f.primary }));
  assert.deepEqual(await fs.readFile(winner.path), lockedBytes, 'a wrong token neither edits nor removes the active lock');
  await releaseReleaseLock(winner.token, { cwd: f.primary });
  await assert.rejects(fs.access(winner.path), { code: 'ENOENT' });
  const reacquired = await acquireReleaseLock('new verified owner', { cwd: f.linked });
  assert.equal(reacquired.path, winner.path, 'worktrees resolve the same Git-common lock path');
  assert.notEqual(reacquired.token, winner.token);
  await releaseReleaseLock(reacquired.token, { cwd: f.linked });
});
