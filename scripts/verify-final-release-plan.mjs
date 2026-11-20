import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pendingChanges, readJournal } from './release-journal.mjs';
import { validateBaselineEvidence, validateDependencyEvidence } from './final-release-evidence.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digestPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const key = (eventId, channel) => `${eventId}:${channel}`;
const explained = value => typeof value === 'string' && value.trim().length >= 12;
const filePathSafe = value => typeof value === 'string' && value.length > 0
  && !isAbsolute(value) && !value.includes('\\') && !value.includes(':')
  && value.split('/').every(part => part && part !== '.' && part !== '..' && part !== '.git'
    && part !== 'node_modules' && !part.startsWith('.next') && (!part.startsWith('.env') || part === '.env.example'));

export function createDraft(inventory, inventorySha256) {
  return {
    schemaVersion: 1, inventorySha256, inventoryCapturedAt: inventory.capturedAt,
    baseline: null, candidate: null, dependencyEvidence: [], resolutions: [], integrationMetadata: [],
    revisions: inventory.pending.flatMap(event => event.pendingChannels.map(channel => ({
      eventId: event.eventId, changeId: event.changeId, channel,
      disposition: 'unreviewed', reason: '',
    }))),
    worktrees: inventory.worktrees.filter(tree => tree.trackedCount || tree.untrackedCount || tree.errors?.length)
      .map(tree => ({ path: tree.path, statusFingerprint: tree.statusFingerprint, disposition: 'unreviewed', reason: '' })),
  };
}

/** Read-only reconciliation. Passing this check never authorizes or performs a push. */
export function verifyPlan(plan, inventory, { inventorySha256, readSnapshotHash, readCandidateHash, readEvidence, candidateChanges, journalEvents = [] } = {}) {
  const blockers = [];
  const block = (code, detail) => blockers.push({ code, detail });
  if (plan.schemaVersion !== 1 || inventory.schemaVersion !== 1) block('schema', 'Unsupported plan or inventory schema.');
  if (!digestPattern.test(inventorySha256 ?? '') || plan.inventorySha256 !== inventorySha256) block('inventory-drift', 'Plan is not bound to this exact inventory.');
  const baseline = plan.baseline;
  if (!baseline || !/^dpl_[A-Za-z0-9]+$/.test(baseline.deploymentId ?? '')
    || !commitPattern.test(baseline.sourceCommit ?? '') || !digestPattern.test(baseline.sourceManifestSha256 ?? '')
    || !validateBaselineEvidence(baseline, readEvidence?.(baseline.evidence))) {
    block('baseline', 'Authenticated current alias, exact source and hashed evidence are required. Public asset IDs are insufficient.');
  }
  if (!commitPattern.test(plan.candidate?.commit ?? '') || !isAbsolute(plan.candidate?.root ?? '')) block('candidate', 'A clean, committed integration candidate is required.');
  const expected = new Map(inventory.pending.flatMap(event => event.pendingChannels.map(channel => [key(event.eventId, channel), event])));
  const decisions = new Map();
  for (const row of plan.revisions ?? []) {
    const rowKey = key(row.eventId, row.channel);
    if (!expected.has(rowKey) || decisions.has(rowKey)) { block('revision-identity', rowKey); continue; }
    decisions.set(rowKey, row);
    const event = expected.get(rowKey);
    if (row.changeId !== event.changeId) block('revision-identity', rowKey);
    if (!['include', 'defer', 'outside-project'].includes(row.disposition) || !explained(row.reason)) block('unreviewed-revision', rowKey);
    if (row.disposition === 'include' && (event.status !== 'ready' || !event.files?.length || !event.fileHashes || !event.source?.snapshot
      || !event.validation?.length || event.validation.some(check => check.result !== 'passed'))) block('unfinished-inclusion', rowKey);
  }
  for (const rowKey of expected.keys()) if (!decisions.has(rowKey)) block('missing-revision', rowKey);
  const treeDecisions = new Map();
  for (const row of plan.worktrees ?? []) {
    if (treeDecisions.has(row.path) || !inventory.worktrees.some(tree => tree.path === row.path)) block('worktree-identity', row.path);
    treeDecisions.set(row.path, row);
  }
  for (const tree of inventory.worktrees) {
    if (!tree.trackedCount && !tree.untrackedCount && !tree.errors?.length) continue;
    const row = treeDecisions.get(tree.path);
    if (!row || !['frozen-handoff', 'defer', 'outside-project'].includes(row.disposition) || !explained(row.reason)
      || row.statusFingerprint !== tree.statusFingerprint) block('unreviewed-worktree', tree.path);
    if (tree.errors?.length) block('inventory-error', tree.path);
    if (row?.disposition === 'frozen-handoff') {
      const receipt = readEvidence?.(row.evidence);
      if (receipt?.schemaVersion !== 1 || receipt.kind !== 'reylumi-frozen-handoff' || receipt.worktree !== tree.path
        || receipt.statusFingerprint !== tree.statusFingerprint || !receipt.eventIds?.length
        || receipt.eventIds.some(id => !inventory.pending.some(event => event.eventId === id && event.status === 'ready'
          && event.pendingChannels.some(channel => decisions.get(key(id, channel))?.disposition === 'include')))) block('handoff-evidence', tree.path);
    }
  }
  const included = inventory.pending.filter(event => event.pendingChannels.some(channel => decisions.get(key(event.eventId, channel))?.disposition === 'include'));
  if (!included.length) block('empty-candidate', 'No completed revision has been selected.');
  const files = new Map();
  for (const event of included) {
    for (const channel of event.pendingChannels.filter(channel => decisions.get(key(event.eventId, channel))?.disposition === 'include')) {
      for (const dependency of event.dependencies ?? []) {
        const selected = included.some(other => other.changeId === dependency && decisions.get(key(other.eventId, channel))?.disposition === 'include');
        const evidence = (plan.dependencyEvidence ?? []).find(row => row.changeId === dependency && row.channel === channel);
        if (!selected && !validateDependencyEvidence(evidence, readEvidence?.(evidence?.evidence), journalEvents)) block('missing-dependency', `${event.eventId}:${channel}:${dependency}`);
      }
    }
    const declared = new Set(event.files ?? []);
    if (Object.keys(event.fileHashes ?? {}).some(path => !declared.has(path))) block('snapshot-manifest', event.eventId);
    for (const path of declared) {
      if (!filePathSafe(path)) { block('unsafe-path', `${event.eventId}:${path}`); continue; }
      const expectedHash = event.fileHashes?.[path];
      const deleted = (event.deletedFiles ?? []).includes(path);
      if (deleted ? expectedHash !== null : !digestPattern.test(expectedHash ?? '')) { block('snapshot-manifest', `${event.eventId}:${path}`); continue; }
      try { if (readSnapshotHash?.(event, path) !== expectedHash) block('snapshot-drift', `${event.eventId}:${path}`); }
      catch { block('snapshot-unreadable', `${event.eventId}:${path}`); }
      const contributors = files.get(path) ?? [];
      contributors.push({ eventId: event.eventId, hash: expectedHash });
      files.set(path, contributors);
    }
  }
  for (const [path, contributors] of files) {
    let actual;
    try { actual = readCandidateHash?.(path); } catch { block('candidate-unreadable', path); continue; }
    if (contributors.every(row => row.hash === actual)) continue;
    const resolution = (plan.resolutions ?? []).find(row => row.path === path);
    const receipt = readEvidence?.(resolution?.evidence);
    if (!resolution || resolution.candidateHash !== actual || !(actual === null || digestPattern.test(actual ?? ''))
      || !explained(resolution.reason) || receipt?.schemaVersion !== 1 || receipt.kind !== 'reylumi-integration-resolution'
      || receipt.path !== path || receipt.candidateHash !== actual || receipt.candidateCommit !== plan.candidate?.commit
      || !receipt.validation?.length || receipt.validation.some(check => check.result !== 'passed')
      || contributors.some(row => !resolution.eventIds?.includes(row.eventId) || !receipt.eventIds?.includes(row.eventId))) block('unresolved-file', path);
  }
  if (!Array.isArray(candidateChanges)) block('candidate-diff', 'An exact baseline-to-candidate Git diff is required.');
  for (const path of candidateChanges ?? []) {
    if (files.has(path)) continue;
    const metadata = (plan.integrationMetadata ?? []).find(row => row.path === path);
    const receipt = readEvidence?.(metadata?.evidence);
    let actual;
    try { actual = readCandidateHash?.(path); } catch { /* Unreadable metadata cannot exempt a changed path. */ }
    if (!/^releases\/(changes|history)\/[^/]+\.json$/.test(path) || !metadata || !explained(metadata.reason)
      || !digestPattern.test(actual ?? '') || metadata.sha256 !== actual || !receipt?.id
      || !journalEvents.some(event => event.id === receipt.id && JSON.stringify(event) === JSON.stringify(receipt))) block('unselected-candidate-file', path);
  }
  return {
    schemaVersion: 1, inventorySha256, readyForCoordinatorReview: blockers.length === 0,
    mayPush: false, mayPublish: false,
    counts: { pendingRevisions: inventory.pending.length, channelDecisions: expected.size, includedRevisions: included.length, sourceFiles: files.size, blockers: blockers.length },
    blockers,
    limits: ['Read-only reconciliation; not release authorization.', 'Worktree fingerprints cover Git paths/status/HEAD, not arbitrary private or untracked file contents; selected frozen source and candidate bytes are checked separately.', 'Acquire the shared release lock and refresh authenticated baseline before assembly/publication.', 'Run build, scoped acceptance, secret review and the immediate production-alias guard separately.'],
  };
}

export function containedHash(root, path) {
  if (!filePathSafe(path)) throw Error('Unsafe source path');
  let current = realpathSync(root);
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    let status;
    try { status = lstatSync(current); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    // Check links before absence: existsSync treats a dangling link as missing.
    if (status.isSymbolicLink()) throw Error('Source symlinks require a separately frozen regular-file handoff');
    if (index < parts.length - 1 ? !status.isDirectory() : !status.isFile()) throw Error('Unexpected source path type');
  }
  return sha256(readFileSync(current));
}
const git = (root, ...args) => execFileSync('git', ['--no-optional-locks', '-c', 'core.quotepath=false', '-C', root, ...args], {
  encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
const signature = pending => JSON.stringify(pending.map(event => [event.eventId, event.status, [...event.pendingChannels].sort()]).sort((a, b) => a[0].localeCompare(b[0])));

async function main() {
  const [mode, inventoryFile, planFile, reportFile] = process.argv.slice(2);
  if (!['--init', '--check'].includes(mode) || !inventoryFile || !planFile) throw Error('Usage: node scripts/verify-final-release-plan.mjs --init|--check <scope-inventory.json> <plan.json> [report.json]');
  const bytes = readFileSync(inventoryFile), inventory = JSON.parse(bytes), inventorySha256 = sha256(bytes);
  if (mode === '--init') {
    writeFileSync(planFile, JSON.stringify(createDraft(inventory, inventorySha256), null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: 'draft-needs-review', planFile, inventorySha256 }));
    return;
  }
  const plan = JSON.parse(readFileSync(planFile)), evidenceRoot = resolve(process.cwd());
  const readEvidence = evidence => {
    try {
      if (!evidence || !filePathSafe(evidence.path) || !digestPattern.test(evidence.sha256 ?? '')
        || containedHash(evidenceRoot, evidence.path) !== evidence.sha256) return null;
      return JSON.parse(readFileSync(join(evidenceRoot, evidence.path), 'utf8'));
    } catch { return null; }
  };
  let candidateChanges;
  if (plan.candidate?.root && commitPattern.test(plan.candidate.commit ?? '') && commitPattern.test(plan.baseline?.sourceCommit ?? '')) {
    try { candidateChanges = git(plan.candidate.root, 'diff', '--name-only', '--no-renames', '-z', plan.baseline.sourceCommit, plan.candidate.commit, '--').split('\0').filter(Boolean); } catch { /* Remain blocked if the exact diff cannot be read. */ }
  }
  const report = verifyPlan(plan, inventory, {
    inventorySha256, readEvidence, candidateChanges, journalEvents: readJournal(),
    readSnapshotHash: (event, path) => containedHash(event.source.snapshot, path),
    readCandidateHash: path => containedHash(plan.candidate.root, path),
  });
  if (signature(pendingChanges()) !== signature(inventory.pending)) report.blockers.push({ code: 'journal-drift', detail: 'Pending changes changed after inventory; capture and review again.' });
  try {
    const liveRoots = git(process.cwd(), 'worktree', 'list', '--porcelain', '-z').split('\0').filter(row => row.startsWith('worktree ')).map(row => resolve(row.slice(9))).sort();
    const capturedRoots = inventory.worktrees.map(tree => resolve(tree.path)).sort();
    if (JSON.stringify(liveRoots) !== JSON.stringify(capturedRoots)) report.blockers.push({ code: 'worktree-membership-drift', detail: 'Registered worktrees changed after inventory.' });
  } catch { report.blockers.push({ code: 'worktree-membership-unreadable', detail: 'Current worktree membership could not be checked.' }); }
  for (const tree of inventory.worktrees) {
    try {
      const actual = sha256(git(tree.path, 'status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'));
      if (actual !== tree.statusFingerprint) report.blockers.push({ code: 'worktree-drift', detail: tree.path });
    } catch { report.blockers.push({ code: 'worktree-unreadable', detail: tree.path }); }
  }
  if (plan.candidate?.root) {
    try {
      if (git(plan.candidate.root, 'rev-parse', 'HEAD').trim() !== plan.candidate.commit || git(plan.candidate.root, 'status', '--porcelain').trim()) report.blockers.push({ code: 'candidate-drift', detail: 'Candidate must be clean at its recorded commit.' });
    } catch { report.blockers.push({ code: 'candidate-unreadable', detail: 'Candidate Git source could not be verified.' }); }
  }
  report.counts.blockers = report.blockers.length;
  report.readyForCoordinatorReview = report.blockers.length === 0;
  if (reportFile) writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ readyForCoordinatorReview: report.readyForCoordinatorReview, mayPush: false, ...report.counts, blockerCodes: [...new Set(report.blockers.map(row => row.code))], reportFile }));
  if (!report.readyForCoordinatorReview) process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Final release reconciliation failed; no push or publication performed.'); process.exitCode = 1; });
