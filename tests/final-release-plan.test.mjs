import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, sha256, verifyPlan } from '../scripts/verify-final-release-plan.mjs';

const hash = sha256('selected source');
const inventoryHash = sha256('inventory');
function fixture() {
  const inventory = { schemaVersion: 1, capturedAt: '2026-11-17T06:00:00Z', pending: [
    { eventId: 'older-ready', changeId: 'feature-a', status: 'ready', pendingChannels: ['web', 'ios'],
      latestEventId: 'new-working', latestStatus: 'working', files: ['lib/a.ts'], deletedFiles: [],
      source: { snapshot: '/frozen/a' }, fileHashes: { 'lib/a.ts': hash }, validation: [{ name: 'acceptance', result: 'passed' }], dependencies: [] },
    { eventId: 'new-working', changeId: 'feature-a', status: 'working', pendingChannels: ['web'], files: ['lib/a.ts'], validation: [], dependencies: [] },
  ], worktrees: [{ path: '/work/active', HEAD: 'a'.repeat(40), trackedCount: 1, untrackedCount: 0, statusFingerprint: hash, errors: [] }] };
  const plan = createDraft(inventory, inventoryHash);
  plan.baseline = { deploymentId: 'dpl_Current', sourceCommit: 'b'.repeat(40), sourceManifestSha256: hash, authenticatedAliasVerified: true, evidence: { path: 'artifacts/baseline.json', sha256: hash } };
  plan.candidate = { root: process.platform === 'win32' ? 'C:\\candidate' : '/candidate', commit: 'c'.repeat(40) };
  plan.revisions = plan.revisions.map(row => ({ ...row, disposition: row.eventId === 'older-ready' ? 'include' : 'defer', reason: row.eventId === 'older-ready' ? 'Completed scoped acceptance.' : 'Active revision has no frozen handoff.' }));
  plan.worktrees[0] = { ...plan.worktrees[0], disposition: 'defer', reason: 'Active changes remain with their owning task.' };
  const dependencyEvent = { kind: 'change', id: 'dependency-ready', changeId: 'shipped-core', status: 'ready', channels: ['web', 'ios'] };
  const publishedReceipt = { kind: 'release', id: 'published-receipt', recordedAt: inventory.capturedAt, changes: [dependencyEvent.id], targets: {
    web: { status: 'published', verified: true, evidence: 'artifacts/live.json', deploymentId: 'dpl_Shipped', baselineDeploymentId: 'dpl_Previous', sourceSha256: hash, overlaySha256: hash },
    ios: { status: 'testflight-available', verified: true, evidence: 'artifacts/apple.json', version: '1.0.0', build: '100', commit: 'd'.repeat(40) },
  } };
  const metadataReceipt = { kind: 'change', id: 'completion-record', changeId: 'integrated-feature', status: 'needs-integration', channels: ['web'], files: [] };
  const options = { inventorySha256: inventoryHash, candidateChanges: ['lib/a.ts'], readSnapshotHash: () => hash, readCandidateHash: () => hash,
    journalEvents: [dependencyEvent, publishedReceipt, metadataReceipt],
    readEvidence: evidence => {
      if (evidence?.sha256 !== hash) return null;
      if (evidence.path === 'artifacts/baseline.json') return { ...plan.baseline, schemaVersion: 1, kind: 'reylumi-production-baseline', alias: 'reylumi.com', capturedAt: inventory.capturedAt };
      if (evidence.path === 'artifacts/receipt.json') return publishedReceipt;
      if (evidence.path === 'artifacts/metadata.json') return metadataReceipt;
      if (evidence.path === 'artifacts/merge.json') return { ...plan.resolutions[0], schemaVersion: 1, kind: 'reylumi-integration-resolution', candidateCommit: plan.candidate.commit, validation: [{ name: 'merged acceptance', result: 'passed' }] };
      return null;
    },
  };
  return { inventory, plan, options, check: () => verifyPlan(plan, inventory, options) };
}
const codes = result => result.blockers.map(row => row.code);

test('preserves an older ready revision alongside a newer working revision, per channel', () => {
  const f = fixture(), result = f.check();
  assert.equal(result.readyForCoordinatorReview, true);
  assert.equal(result.counts.channelDecisions, 3);
  assert.equal(result.counts.includedRevisions, 1);
  assert.equal(result.mayPush, false);
  assert.equal(result.mayPublish, false);
});
test('draft starts with every event/channel and dirty worktree unreviewed', () => {
  const f = fixture();
  f.plan = createDraft(f.inventory, inventoryHash);
  const result = verifyPlan(f.plan, f.inventory, f.options);
  assert.equal(result.readyForCoordinatorReview, false);
  assert.equal(result.blockers.filter(row => row.code === 'unreviewed-revision').length, 3);
  assert.ok(codes(result).includes('unreviewed-worktree'));
});
test('missing iOS decision cannot disappear behind a web decision', () => {
  const f = fixture();
  f.plan.revisions = f.plan.revisions.filter(row => row.channel !== 'ios');
  assert.ok(codes(f.check()).includes('missing-revision'));
});
test('duplicate or invented decisions and incorrect change identity are blocked', () => {
  const f = fixture();
  f.plan.revisions.push({ ...f.plan.revisions[0] }, { ...f.plan.revisions[0], eventId: 'invented' });
  f.plan.revisions[0].changeId = 'another-feature';
  assert.equal(codes(f.check()).filter(code => code === 'revision-identity').length, 3);
});
test('new working or blocked revisions cannot be selected even with a reason', () => {
  for (const status of ['working', 'blocked', 'needs-integration']) {
    const f = fixture();
    f.inventory.pending[1].status = status;
    f.plan.revisions.find(row => row.eventId === 'new-working').disposition = 'include';
    assert.ok(codes(f.check()).includes('unfinished-inclusion'));
  }
});
test('changed inventory, unauthenticated baseline and missing evidence block review', () => {
  const f = fixture();
  f.plan.inventorySha256 = sha256('older inventory');
  f.plan.baseline.authenticatedAliasVerified = false;
  assert.ok(codes(f.check()).includes('inventory-drift'));
  assert.ok(codes(f.check()).includes('baseline'));
  f.plan.baseline.authenticatedAliasVerified = true;
  f.plan.baseline.evidence = null;
  assert.ok(codes(f.check()).includes('baseline'));
});
test('dirty worktree omissions, fingerprint changes and read errors are blockers', () => {
  for (const mutate of [f => { f.plan.worktrees = []; }, f => { f.plan.worktrees[0].statusFingerprint = 'old'; }, f => { f.inventory.worktrees[0].errors = ['Git read failed']; }]) {
    const f = fixture(); mutate(f);
    assert.equal(f.check().readyForCoordinatorReview, false);
  }
});
test('snapshot tampering and unreadable snapshot fail closed', () => {
  const f = fixture();
  f.options.readSnapshotHash = () => sha256('modified source');
  assert.ok(codes(f.check()).includes('snapshot-drift'));
  f.options.readSnapshotHash = () => { throw Error('unavailable'); };
  assert.ok(codes(f.check()).includes('snapshot-unreadable'));
});
test('overlapping edits require a hash-bound resolution naming every contributor', () => {
  const f = fixture(), changed = sha256('merged source');
  const second = { ...f.inventory.pending[0], eventId: 'second-ready', changeId: 'feature-b', pendingChannels: ['web'], fileHashes: { 'lib/a.ts': sha256('second source') } };
  f.inventory.pending.push(second);
  f.plan.revisions.push({ eventId: second.eventId, changeId: second.changeId, channel: 'web', disposition: 'include', reason: 'Completed independent feature acceptance.' });
  f.options.readSnapshotHash = event => event.fileHashes['lib/a.ts'];
  f.options.readCandidateHash = () => changed;
  assert.ok(codes(f.check()).includes('unresolved-file'));
  f.plan.resolutions = [{ path: 'lib/a.ts', candidateHash: changed, eventIds: ['older-ready'], reason: 'Merged both features preserving behavior.', evidence: { path: 'artifacts/merge.json', sha256: hash } }];
  assert.ok(codes(f.check()).includes('unresolved-file'));
  f.plan.resolutions[0].eventIds.push('second-ready');
  assert.equal(f.check().readyForCoordinatorReview, true);
});
test('dependencies need the same channel or verified published evidence', () => {
  const f = fixture();
  f.inventory.pending[0].dependencies = ['shipped-core'];
  assert.equal(f.check().blockers.filter(row => row.code === 'missing-dependency').length, 2);
  f.plan.dependencyEvidence = [{ changeId: 'shipped-core', eventId: 'dependency-ready', channel: 'web', evidence: { path: 'artifacts/receipt.json', sha256: hash } }];
  assert.equal(f.check().blockers.filter(row => row.code === 'missing-dependency').length, 1);
  f.plan.dependencyEvidence.push({ ...f.plan.dependencyEvidence[0], channel: 'ios' });
  assert.equal(f.check().readyForCoordinatorReview, true);
});
test('deletions are checked against both snapshot and candidate', () => {
  const f = fixture();
  f.inventory.pending[0].deletedFiles = ['lib/a.ts'];
  f.inventory.pending[0].fileHashes['lib/a.ts'] = null;
  f.options.readSnapshotHash = () => null;
  assert.ok(codes(f.check()).includes('unresolved-file'));
  f.options.readCandidateHash = () => null;
  assert.equal(f.check().readyForCoordinatorReview, true);
});
test('secret paths, traversal paths and malformed snapshot hashes cannot be read', () => {
  for (const path of ['../secret', '.env.local', 'lib/../secret', 'C:/private', 'lib\\a.ts']) {
    const f = fixture();
    f.inventory.pending[0].files = [path];
    f.inventory.pending[0].fileHashes = { [path]: hash };
    f.options.readSnapshotHash = () => { assert.fail('Unsafe path must not be read'); };
    assert.ok(codes(f.check()).includes('unsafe-path'));
  }
  const f = fixture();
  f.inventory.pending[0].fileHashes['lib/a.ts'] = 'not-a-hash';
  assert.ok(codes(f.check()).includes('snapshot-manifest'));
});
test('an all-deferred plan is a blocked release, not a successful empty push', () => {
  const f = fixture();
  for (const row of f.plan.revisions) row.disposition = 'defer';
  assert.ok(codes(f.check()).includes('empty-candidate'));
});
test('a clean candidate containing deferred or unknown source still fails', () => {
  const f = fixture();
  f.options.candidateChanges.push('lib/deferred-payroll.ts');
  assert.ok(codes(f.check()).includes('unselected-candidate-file'));
  f.plan.integrationMetadata = [{ path: 'lib/deferred-payroll.ts', sha256: hash, reason: 'Attempted broad exemption for product code.', evidence: { path: 'artifacts/receipt.json', sha256: hash } }];
  assert.ok(codes(f.check()).includes('unselected-candidate-file'));
});
test('only hashed immutable release metadata has an explicit diff exemption', () => {
  const f = fixture();
  f.options.candidateChanges.push('releases/changes/frozen-event.json');
  assert.ok(codes(f.check()).includes('unselected-candidate-file'));
  f.plan.integrationMetadata = [{ path: 'releases/changes/frozen-event.json', sha256: hash, reason: 'Completion receipt for this integrated revision.', evidence: { path: 'artifacts/metadata.json', sha256: hash } }];
  assert.equal(f.check().readyForCoordinatorReview, true);
  f.plan.integrationMetadata[0].sha256 = sha256('older receipt');
  assert.ok(codes(f.check()).includes('unselected-candidate-file'));
});
test('missing exact candidate diff is never interpreted as no extra source', () => {
  const f = fixture();
  delete f.options.candidateChanges;
  assert.ok(codes(f.check()).includes('candidate-diff'));
});
