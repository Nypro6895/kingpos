import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { containedHash, sha256 } from '../scripts/verify-final-release-plan.mjs';

function workspace(t) {
  const temporaryRoot = resolve(tmpdir());
  const root = mkdtempSync(join(temporaryRoot, 'reylumi-final-plan-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), temporaryRoot);
    assert.ok(basename(root).startsWith('reylumi-final-plan-test-'));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
test('source hashing distinguishes an actual file from an absent deletion', t => {
  const root = workspace(t);
  mkdirSync(join(root, 'lib'));
  writeFileSync(join(root, 'lib', 'safe.ts'), 'safe source');
  assert.equal(containedHash(root, 'lib/safe.ts'), sha256('safe source'));
  assert.equal(containedHash(root, 'lib/deleted.ts'), null);
  assert.equal(containedHash(root, 'absent/nested.ts'), null);
});
test('dangling leaf link cannot masquerade as a successful deletion', t => {
  const root = workspace(t);
  symlinkSync(join(root, 'missing-target'), join(root, 'deleted.ts'), 'junction');
  assert.throws(() => containedHash(root, 'deleted.ts'), /symlink/);
});
test('a missing descendant behind a link cannot masquerade as a deletion', t => {
  const root = workspace(t);
  mkdirSync(join(root, 'outside'));
  symlinkSync(join(root, 'outside'), join(root, 'linked'), 'junction');
  assert.throws(() => containedHash(root, 'linked/deleted.ts'), /symlink/);
});
