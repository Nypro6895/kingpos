import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBaselineEvidence, validateDependencyEvidence } from '../scripts/final-release-evidence.mjs';

const commit = 'a'.repeat(40), digest = 'b'.repeat(64);
const capturedAt = '2026-11-17T06:21:08.763Z';
function baselineFixture() {
  const baseline = { deploymentId: 'dpl_Current', sourceCommit: commit, sourceManifestSha256: digest, authenticatedAliasVerified: true };
  const receipt = { schemaVersion: 1, kind: 'reylumi-production-baseline', alias: 'reylumi.com', capturedAt, ...baseline };
  return { baseline, receipt };
}
function dependencyFixture(channel = 'web', status = channel === 'web' ? 'published' : 'testflight-available') {
  const row = { eventId: 'ready-a', changeId: 'feature-a', channel };
  const change = { kind: 'change', id: row.eventId, changeId: row.changeId, status: 'ready', channels: ['web', 'ios'], recordedAt: capturedAt };
  const target = channel === 'web'
    ? { status, verified: true, deploymentId: 'dpl_Current', baselineDeploymentId: 'dpl_Previous', sourceSha256: digest, overlaySha256: digest, evidence: 'artifacts/web-receipt.json' }
    : { status, verified: true, version: '1.0.0', build: '100', commit, evidence: 'artifacts/native-receipt.json' };
  const receipt = { kind: 'release', id: 'release-a', recordedAt: capturedAt, changes: [row.eventId], targets: { [channel]: target } };
  return { row, change, receipt, journal: [change, structuredClone(receipt)] };
}

test('typed baseline receipt binds the exact verified alias, commit and source manifest', () => {
  const { baseline, receipt } = baselineFixture();
  assert.equal(validateBaselineEvidence(baseline, receipt), true);
  for (const field of ['deploymentId', 'sourceCommit', 'sourceManifestSha256']) {
    assert.equal(validateBaselineEvidence({ ...baseline, [field]: 'different' }, receipt), false, field);
  }
});

test('the actual blocked baseline-readback shape cannot be promoted by a manual plan boolean', () => {
  const { baseline } = baselineFixture();
  // Safe projection of the real Nov17 baseline-readback; no credentials or
  // ignored local artifact dependency is needed for this regression.
  const blocked = {
    schemaVersion: 1, checkedAt: capturedAt,
    vercel: { authenticatedAlias: { status: 'blocked', deploymentId: null, sourceVerified: false, reason: 'Authentication required.' } },
    publicLive: { pages: [{ publicDeploymentHints: ['dpl_Current'] }] },
  };
  assert.equal(validateBaselineEvidence(baseline, blocked), false);
  assert.equal(validateBaselineEvidence(baseline, { ...blocked, authenticatedAliasVerified: true }), false);
});

test('baseline schema, kind, alias, verification and digest formats fail closed', () => {
  const { baseline, receipt } = baselineFixture();
  for (const [field, value] of [['schemaVersion', 2], ['kind', 'release'], ['alias', 'preview.reylumi.com'], ['authenticatedAliasVerified', false], ['deploymentId', 'invented'], ['sourceCommit', 'short'], ['sourceManifestSha256', 'short']]) {
    assert.equal(validateBaselineEvidence({ ...baseline, [field]: value }, { ...receipt, [field]: value }), false, field);
  }
  assert.equal(validateBaselineEvidence({ ...baseline, authenticatedAliasVerified: false }, receipt), false);
});

test('capture time needs an explicit valid calendar timestamp; freshness is a separate gate', () => {
  const { baseline, receipt } = baselineFixture();
  for (const value of [undefined, '', 'today', '2026-11-17', '2026-02-30T12:00:00Z', '2026-13-01T00:00:00Z', '2026-11-17T24:00:00Z', '2026-11-17T06:00:00']) {
    assert.equal(validateBaselineEvidence(baseline, { ...receipt, capturedAt: value }), false, String(value));
  }
  for (const value of ['2024-02-29T12:00:00Z', '2026-11-17T00:21:08.763-06:00']) {
    assert.equal(validateBaselineEvidence(baseline, { ...receipt, capturedAt: value }), true);
  }
});

test('dependency evidence accepts only actual journal publication for the exact channel', () => {
  for (const [channel, status] of [['web', 'published'], ['ios', 'testflight-available'], ['ios', 'app-store-published']]) {
    const { row, receipt, journal } = dependencyFixture(channel, status);
    assert.equal(validateDependencyEvidence(row, receipt, journal), true);
    assert.equal(validateDependencyEvidence({ ...row, channel: channel === 'web' ? 'ios' : 'web' }, receipt, journal), false);
  }
});

test('a fabricated release-shaped file or edited real receipt is not journal evidence', () => {
  const f = dependencyFixture();
  assert.equal(validateDependencyEvidence(f.row, f.receipt, [f.change]), false);
  assert.equal(validateDependencyEvidence(f.row, { ...f.receipt, id: 'unknown-release' }, f.journal), false);
  const edited = structuredClone(f.receipt);
  edited.targets.web.sourceSha256 = 'c'.repeat(64);
  assert.equal(validateDependencyEvidence(f.row, edited, f.journal), false);
  assert.equal(validateDependencyEvidence(f.row, { ...f.receipt, filePath: 'local/transport-only.json' }, f.journal), true);
});

test('dependency identity must resolve to one known ready change with the right changeId and channel', () => {
  for (const mutate of [f => { f.row.eventId = 'unknown'; }, f => { f.row.changeId = 'wrong'; }, f => { f.change.status = 'working'; }, f => { f.change.channels = ['ios']; }, f => { f.journal.push(structuredClone(f.change)); }]) {
    const f = dependencyFixture(); mutate(f);
    assert.equal(validateDependencyEvidence(f.row, f.receipt, f.journal), false);
  }
  const f = dependencyFixture();
  f.journal.push({ ...f.change, id: 'newer-working', status: 'working' });
  assert.equal(validateDependencyEvidence(f.row, f.receipt, f.journal), true, 'A newer unfinished revision must not hide the exact published ready revision.');
});

test('unknown changes, incomplete targets and cross-channel statuses cannot prove publication', () => {
  for (const mutate of [f => { f.receipt.changes = []; }, f => { f.receipt.targets.web.verified = false; }, f => { f.receipt.targets.web.status = 'pending'; }, f => { delete f.receipt.targets.web.evidence; }, f => { delete f.receipt.targets.web.baselineDeploymentId; }, f => { f.receipt.targets.web.overlaySha256 = 'bad'; }]) {
    const f = dependencyFixture(); mutate(f); f.journal[1] = structuredClone(f.receipt);
    assert.equal(validateDependencyEvidence(f.row, f.receipt, f.journal), false);
  }
  for (const mutate of [f => { f.receipt.targets.ios.status = 'published'; }, f => { f.receipt.targets.ios.commit = 'bad'; }, f => { delete f.receipt.targets.ios.build; }]) {
    const f = dependencyFixture('ios'); mutate(f); f.journal[1] = structuredClone(f.receipt);
    assert.equal(validateDependencyEvidence(f.row, f.receipt, f.journal), false);
  }
});

test('malformed values return false without reading files or throwing', () => {
  const { baseline, receipt } = baselineFixture();
  for (const value of [null, undefined, true, 'receipt', []]) {
    assert.equal(validateBaselineEvidence(baseline, value), false);
    assert.equal(validateBaselineEvidence(value, receipt), false);
    assert.equal(validateDependencyEvidence(value, value, value), false);
  }
});
