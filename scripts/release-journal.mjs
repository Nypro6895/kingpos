import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const changeStatuses = new Set(['working', 'needs-integration', 'ready', 'blocked', 'abandoned']);
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }).trim(); }
function context(cwd = process.cwd()) {
  const root = realpathSync(git(cwd, 'rev-parse', '--show-toplevel'));
  const common = realpathSync(resolve(root, git(root, 'rev-parse', '--git-common-dir')));
  const roots = git(root, 'worktree', 'list', '--porcelain', '-z').split('\0').filter(s => s.startsWith('worktree ')).map(s => s.slice(9)).filter(existsSync).map(p => realpathSync(p));
  return { root, common, roots: [...new Set([root, ...roots])] };
}
function relativeFile(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.startsWith('/') || file.includes(':') || file.split('/').some(s => !s || s === '.' || s === '..')
    || file.split('/').some(s => s.startsWith('.env') && s !== '.env.example') || /^(\.git|node_modules|\.next(?:-[^/]+)?)(\/|$)/.test(file)) throw Error('Unsafe or secret source file path');
  return file;
}
function strings(value, name) { if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v)) throw Error(`${name} must be a string array`); return [...new Set(value)]; }
function validDate(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw Error('Invalid occurredAt'); return new Date(value).toISOString(); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function readJournal({ cwd = process.cwd() } = {}) {
  const ctx = context(cwd), records = new Map();
  for (const root of ctx.roots) for (const directory of ['changes', 'history']) {
    const folder = join(root, 'releases', directory);
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder).filter(f => f.endsWith('.json')).sort()) {
      const bytes = readFileSync(join(folder, file));
      const event = JSON.parse(bytes);
      // recordEvent returns filePath as a local diagnostic, not event content.
      // Ignore transport-only output in memory without rewriting source bytes.
      delete event.filePath;
      if (!event.id || !event.recordedAt || !['change', 'release'].includes(event.kind)) throw Error(`Malformed journal record: ${file}`);
      // Git may change whitespace or line endings in another worktree. Compare
      // complete JSON values without rewriting either immutable source file.
      const digest = hash(canonicalJson(event));
      const previous = records.get(event.id);
      if (previous && previous.digest !== digest) throw Error(`Conflicting copies of journal event ${event.id}`);
      if (!previous) records.set(event.id, { digest, event });
    }
  }
  return [...records.values()].map(row => row.event).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
}

export function recordEvent(input, { cwd = process.cwd() } = {}) {
  const ctx = context(cwd);
  if (!input || !['change', 'release'].includes(input.kind) || typeof input.summary !== 'string' || !input.summary.trim()) throw Error('Record requires kind and summary');
  const event = { ...input, id: randomUUID(), recordedAt: new Date().toISOString(), worktree: ctx.root };
  delete event.filePath;
  if (input.occurredAt) event.occurredAt = validDate(input.occurredAt);
  if (input.kind === 'change') {
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(input.changeId ?? '') || !changeStatuses.has(input.status)) throw Error('Invalid changeId or change status');
    event.channels = strings(input.channels, 'channels');
    if (!event.channels.length || event.channels.some(c => !['web', 'ios'].includes(c))) throw Error('Channels must be web and/or ios');
    event.files = strings(input.files, 'files').map(relativeFile);
    event.deletedFiles = strings(input.deletedFiles ?? [], 'deletedFiles').map(relativeFile);
    if (event.deletedFiles.some(f => !event.files.includes(f))) throw Error('Deleted files must be included in files');
    event.supersedesEvents = strings(input.supersedesEvents ?? [], 'supersedesEvents');
    if (event.supersedesEvents.length) {
      if (input.status !== 'ready') throw Error('Only a validated ready revision may supersede earlier events');
      const known = new Map(readJournal({ cwd }).filter(e => e.kind === 'change').map(e => [e.id, e]));
      for (const id of event.supersedesEvents) {
        const previous = known.get(id);
        if (!previous || previous.changeId !== input.changeId || previous.status !== 'ready') throw Error('Superseded events must be known ready revisions of the same change');
      }
    }
    if (input.status === 'ready') {
      if (!input.source?.snapshot || !existsSync(resolve(ctx.root, input.source.snapshot))) throw Error('Ready requires a frozen source snapshot');
      const source = realpathSync(resolve(ctx.root, input.source.snapshot));
      if (!statSync(source).isDirectory() || ctx.roots.includes(source)) throw Error('Ready source cannot be a mutable worktree root');
      if (!input.validation?.length || input.validation.some(v => v.result !== 'passed')) throw Error('Ready requires passed validation');
      event.source = { ...input.source, snapshot: source };
      event.fileHashes = Object.fromEntries(event.files.map(file => {
        const target = join(source, file);
        if (event.deletedFiles.includes(file)) { if (existsSync(target)) throw Error('Declared deletion still exists in snapshot'); return [file, null]; }
        if (!existsSync(target) || !statSync(target).isFile()) throw Error(`Ready source file missing: ${file}`);
        const actual = realpathSync(target), prefix = source + (process.platform === 'win32' ? '\\' : '/');
        if (!actual.startsWith(prefix)) throw Error('Snapshot source file escaped through a symlink');
        return [file, hash(readFileSync(actual))];
      }));
    }
  } else {
    event.changes = strings(input.changes, 'changes');
    const known = new Map(readJournal({ cwd }).filter(e => e.kind === 'change').map(e => [e.id, e]));
    for (const id of event.changes) if (!known.has(id)) throw Error(`Release references unknown change event ${id}`);
    if (!input.targets || !Object.keys(input.targets).length || Object.keys(input.targets).some(c => !['web', 'ios'].includes(c))) throw Error('Release requires explicit targets');
    for (const [channel, target] of Object.entries(input.targets)) {
      const completed = channel === 'web' ? target.status === 'published' : ['testflight-available', 'app-store-published'].includes(target.status);
      if (completed) {
        if (target.verified !== true || !target.evidence) throw Error('Publication requires verified evidence');
        if (channel === 'web') {
          if (!/^dpl_[A-Za-z0-9]+$/.test(target.deploymentId ?? '') || !/^dpl_[A-Za-z0-9]+$/.test(target.baselineDeploymentId ?? '')) throw Error('Publication requires deployment ID and captured baseline deployment ID');
          if (!/^[a-f0-9]{64}$/i.test(target.sourceSha256 ?? '') || !/^[a-f0-9]{64}$/i.test(target.overlaySha256 ?? '')) throw Error('Publication requires source and overlay SHA256 hashes');
        }
        if (channel === 'ios' && (!target.version || !target.build || !/^[a-f0-9]{40}$/i.test(target.commit ?? ''))) throw Error('Native publication requires actual version, build and commit');
        for (const id of event.changes) if (known.get(id).status !== 'ready') throw Error('Publication may only resolve exact ready change events');
      }
    }
  }
  const directory = join(ctx.root, 'releases', input.kind === 'change' ? 'changes' : 'history');
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, `${event.recordedAt.replaceAll(':', '-').replaceAll('.', '-')}-${event.id}.json`);
  writeFileSync(filePath, JSON.stringify(event, null, 2) + '\n', { flag: 'wx' });
  return { ...event, filePath };
}

export function pendingChanges({ cwd = process.cwd() } = {}) {
  const events = readJournal({ cwd }), latest = new Map();
  for (const event of events) if (event.kind === 'change') latest.set(event.changeId, event);
  const publications = events.filter(e => e.kind === 'release');
  const changes = events.filter(e => e.kind === 'change' && latest.get(e.changeId)?.status !== 'abandoned'
    && (e.status === 'ready' || latest.get(e.changeId)?.id === e.id));
  return changes.map(event => {
    const pendingChannels = event.channels.filter(channel => !changes.some(replacement => replacement.status === 'ready'
      && replacement.supersedesEvents?.includes(event.id) && replacement.channels.includes(channel))
      && !publications.some(release => release.changes.includes(event.id)
        && release.targets[channel]?.verified === true && (channel === 'web' ? release.targets[channel].status === 'published' : ['testflight-available', 'app-store-published'].includes(release.targets[channel].status))));
    return { changeId: event.changeId, eventId: event.id, status: event.status, summary: event.summary, pendingChannels,
      source: event.source ?? null, files: event.files, deletedFiles: event.deletedFiles ?? [], fileHashes: event.fileHashes ?? null,
      validation: event.validation ?? [], dependencies: event.dependencies ?? [], supersedesEvents: event.supersedesEvents ?? [],
      latestEventId: latest.get(event.changeId).id, latestStatus: latest.get(event.changeId).status,
      occurredAt: event.occurredAt ?? event.recordedAt };
  }).filter(e => e.pendingChannels.length);
}

export function acquireReleaseLock(owner, { cwd = process.cwd() } = {}) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 200) throw Error('Release lock requires owner/release ID');
  const ctx = context(cwd), path = join(ctx.common, 'reylumi-release.lock.json');
  const lock = { token: randomUUID(), owner, recordedAt: new Date().toISOString(), worktree: ctx.root };
  try { writeFileSync(path, JSON.stringify(lock, null, 2) + '\n', { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw Error('A release coordinator already holds the shared Git lock; wait and refresh the baseline'); throw error; }
  return { ...lock, path };
}

export function releaseReleaseLock(token, { cwd = process.cwd() } = {}) {
  const path = join(context(cwd).common, 'reylumi-release.lock.json');
  const lock = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof token !== 'string' || lock.token !== token) throw Error('Release lock token does not match its owner');
  unlinkSync(path);
  return { released: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, argument] = process.argv.slice(2);
    const result = command === 'record' ? recordEvent(JSON.parse(readFileSync(argument, 'utf8')))
      : command === 'pending' ? pendingChanges() : command === 'list' ? readJournal()
      : command === 'lock' ? acquireReleaseLock(argument) : command === 'unlock' ? releaseReleaseLock(argument)
      : (() => { throw Error('Usage: release-journal.mjs record <manifest.json> | pending | list | lock <owner> | unlock <token>'); })();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
