import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startIsolatedSupabase } from './helpers/isolated-supabase-fixture.mjs';

// Boundary regression: invoke the real fixture with Docker's process boundary
// replaced. Capture only arguments and migration hashes, never credentials.
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function dockerModel(scenario = {}) {
  const calls = [], removed = [], migrationExecution = [], containers = new Map([
    ['existing-running', { id: 'a'.repeat(64), running: true }],
    ['existing-stopped', { id: 'b'.repeat(64), running: false }],
  ]);
  let failed = false;
  const result = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const error = stderr => ({ status: 1, stdout: '', stderr });
  const option = (args, key) => args[args.indexOf(key) + 1];
  function spawnSync(_executable, argv, options) {
    assert.equal(argv[0], '--context');
    const args = argv.slice(2);
    calls.push(args); // The fixture puts only env variable NAMES in arguments.
    if (args[0] === 'ps') {
      const all = args.includes('-a'), format = option(args, '--format');
      return result([...containers].filter(([, c]) => all || c.running).map(([name, c]) =>
        format.replaceAll('{{.Names}}', name).replaceAll('{{.ID}}', c.id)).join('\n'));
    }
    if (args[0] === 'run') {
      const name = option(args, '--name'), kind = name.split('-').at(-1);
      const shouldFail = kind === scenario.failKind;
      if (!shouldFail || !scenario.notCreated) {
        containers.set(name, { id: String(['db', 'auth', 'storage', 'rest'].indexOf(kind) + 1).repeat(64), kind, running: !shouldFail,
          label: option(args, '--label').split('=')[1], network: option(args, '--network'),
          ports: {}, mounts: args.flatMap((arg, i) => arg === '--tmpfs' ? [{ Type: 'tmpfs', Destination: args[i + 1].split(':')[0] }] : []),
          memory: args.includes('--memory') ? Number(option(args, '--memory')) : 0,
          memorySwap: args.includes('--memory-swap') ? Number(option(args, '--memory-swap')) : 0,
          nanoCpus: args.includes('--cpus') ? Number(option(args, '--cpus')) * 1e9 : 0,
        });
        if (scenario.boundsMismatchKind === kind) containers.get(name).memory *= 2;
      }
      if (shouldFail) {
        failed = true;
        if (scenario.priorState === 'stopped') containers.get('existing-running').running = false;
        if (scenario.priorState === 'missing') containers.delete('existing-running');
        if (scenario.priorState === 'replaced') containers.get('existing-running').id = 'c'.repeat(64);
        assert.equal(options.timeout, 30000);
        return scenario.timeout ? { status: null, stdout: '', stderr: '', error: new Error('simulated run timeout') } : error('simulated run failure');
      }
      return result(`fixture-${kind}`);
    }
    if (args[0] === 'inspect') {
      const name = args[1], c = containers.get(name), format = option(args, '--format');
      if (failed && scenario.inspectFailureKind && c?.kind === scenario.inspectFailureKind) return error('Cannot connect to Docker daemon');
      if (!c) return error(`Error: No such object: ${name}`);
      if (format.includes('.Config.Labels')) return result(JSON.stringify({
        label: failed && c.kind === scenario.foreignKind ? 'foreign-task-label' : c.label,
        network: c.network, ports: c.ports, mounts: c.mounts,
        memory: c.memory, memorySwap: c.memorySwap, nanoCpus: c.nanoCpus,
      }));
      if (format.includes('.State.')) return result(JSON.stringify({ status: c.running ? 'running' : 'created', oomKilled: false, exitCode: 0 }));
      if (format.includes('.HostConfig.Memory')) return result(JSON.stringify({ memory: c.memory, memorySwap: c.memorySwap, nanoCpus: c.nanoCpus }));
      throw Error('Unexpected inspect template in Docker boundary test');
    }
    if (args[0] === 'rm') {
      assert.deepEqual(args.slice(0, 2), ['rm', '-f']);
      assert.equal(args.length, 3, 'cleanup must target one exact container');
      removed.push(args[2]);containers.delete(args[2]);return result(args[2]);
    }
    if (args[0] === 'logs') return result('synthetic fixture log');
    if (args[0] === 'exec') {
      if (args.includes('pg_isready')) return result('accepting connections');
      if (args.includes('psql')) {
        // Ordinary setup inputs contain generated passwords. Inspect only the
        // migration wrapper and retain hashes/flags, not any SQL or passwords.
        if (options.input.startsWith('begin;\n')) {
          const terminated = options.input.endsWith('\n;\ncommit;');
          migrationExecution.push({ scriptSha256: sha256(options.input), hasCRLF: options.input.includes('\r\n'),
            explicitlyTerminated: terminated, sourceSha256: terminated ? sha256(options.input.slice('begin;\n'.length, -'\n;\ncommit;'.length)) : null });
        }
        return result(options.input === 'select 1' ? '1' : options.input.includes("to_regclass('storage.objects')") ? 't' : '');
      }
      if (args.includes('curl')) return result('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}');
    }
    throw Error(`Unexpected Docker operation ${args[0]}`);
  }
  return { calls, removed, containers, migrationExecution, spawnSync };
}

async function withMockDocker(t, scenario, verify, options) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-fixture-unit-'));
  const previousOutput = process.env.BOOKING_TEST_OUTPUT_DIR;
  process.env.BOOKING_TEST_OUTPUT_DIR = outputDir;
  const docker = dockerModel(scenario), mock = t.mock.method(cp, 'spawnSync', docker.spawnSync);
  let fixture, startupError, cwdMock, sourceDirectory;
  try {
    if (scenario.migrationSources) {
      const sourceRoot = path.join(outputDir, 'source');
      sourceDirectory = path.join(sourceRoot, 'supabase', 'migrations');
      fs.mkdirSync(sourceDirectory, { recursive: true });
      for (const [file, bytes] of Object.entries(scenario.migrationSources)) fs.writeFileSync(path.join(sourceDirectory, file), bytes);
      cwdMock = t.mock.method(process, 'cwd', () => sourceRoot);
    }
    try { fixture = await startIsolatedSupabase('cleanup-regression', options); }
    catch (error) { startupError = error; }
    if (fixture) fixture.close();
    const evidenceFile = path.join(outputDir, 'cleanup-regression-fixture.json');
    const evidence = fs.existsSync(evidenceFile) ? JSON.parse(fs.readFileSync(evidenceFile, 'utf8')) : null;
    await verify({ ...docker, startupError, evidence, sourceDirectory });
  } finally {
    cwdMock?.mock.restore();
    mock.mock.restore();
    if (previousOutput === undefined) delete process.env.BOOKING_TEST_OUTPUT_DIR;
    else process.env.BOOKING_TEST_OUTPUT_DIR = previousOutput;
    // The only recursively removed directory is this test's own mkdtemp child.
    assert.equal(path.dirname(path.resolve(outputDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(outputDir).startsWith('isolated-fixture-unit-'));
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

function ownedCalls(calls, operation) { return calls.filter(args => args[0] === operation); }
function assertPriorsPreserved({ containers, removed }) {
  assert.ok(containers.has('existing-running'));assert.ok(containers.has('existing-stopped'));
  assert.ok(!removed.some(name => name.startsWith('existing-')));
}

test('failed run after container creation is inspected and removed, including timeout', async t => {
  for (const timeout of [false, true]) await t.test(timeout ? 'timeout' : 'nonzero exit', async t => {
    await withMockDocker(t, { failKind: 'db', timeout }, state => {
      assert.match(state.startupError.message, /simulated run (failure|timeout)/);
      const attempted = ownedCalls(state.calls, 'run')[0], name = attempted[attempted.indexOf('--name') + 1];
      assert.deepEqual(state.removed, [name]);assertPriorsPreserved(state);
      const inspectIndex = state.calls.findIndex(args => args[0] === 'inspect' && args[1] === name);
      const removeIndex = state.calls.findIndex(args => args[0] === 'rm');
      assert.ok(inspectIndex >= 0 && inspectIndex < removeIndex);
      const template = state.calls[inspectIndex].at(-1);
      assert.ok(template.includes('Config.Labels') && template.includes('NetworkMode') && template.includes('.Mounts'));
      assert.equal(state.evidence.cleanup.credentialsDiscarded, true);
      assert.ok(!attempted.includes('--memory'), 'existing default remains unbounded');
    });
  });
});

test('run failure before creation skips only a confirmed not-found container', async t => {
  await withMockDocker(t, { failKind: 'db', notCreated: true }, state => {
    assert.match(state.startupError.message, /simulated run failure/);
    assert.equal(ownedCalls(state.calls, 'inspect').length, 1);assert.deepEqual(state.removed, []);
    assert.deepEqual(state.evidence.cleanup.errors, []);assert.equal(state.evidence.cleanup.credentialsDiscarded, true);
    assertPriorsPreserved(state);
  });
});

for (const refusal of ['daemon error', 'foreign label']) test(`${refusal} refuses deletion while other owned resources still clean up`, async t => {
  const scenario = { failKind: 'auth', ...(refusal === 'daemon error' ? { inspectFailureKind: 'auth' } : { foreignKind: 'auth' }) };
  await withMockDocker(t, scenario, state => {
    assert.match(state.startupError.message, /cleanup/i);assert.match(state.startupError.message, /simulated run failure/);
    assert.equal(state.removed.length, 1);assert.ok(state.removed[0].endsWith('-db'));
    assert.ok([...state.containers.keys()].some(name => name.endsWith('-auth')));
    assert.ok(state.evidence.cleanup.errors.length > 0);assert.equal(state.evidence.cleanup.credentialsDiscarded, false);
    assertPriorsPreserved(state);
    assert.ok(state.calls.every(args => !['prune', 'stop', 'kill', 'restart'].includes(args[0])));
  });
});

for (const priorState of ['stopped', 'missing', 'replaced']) test(`a prior running container becoming ${priorState} fails cleanup verification`, async t => {
  await withMockDocker(t, { failKind: 'db', priorState }, state => {
    assert.match(state.startupError.message, /previously running|pre-existing container/i);
    assert.equal(state.evidence.cleanup.priorContainersStillRunning, false);
    assert.ok(state.evidence.cleanup.errors.length > 0);
    assert.ok(!state.removed.some(name => name.startsWith('existing-')));
  });
});

test('a resource-bound mismatch still removes the verified owned container', async t => {
  await withMockDocker(t, { boundsMismatchKind: 'db' }, state => {
    assert.ok(state.startupError instanceof Error);
    assert.equal(state.removed.length, 1);assert.ok(state.removed[0].endsWith('-db'));
    assert.deepEqual(state.evidence.cleanup.testContainersRemaining, []);
    assert.ok(state.evidence.cleanup.errors.length > 0);assertPriorsPreserved(state);
  }, { boundedResources: true });
});

test('optional bounds apply to all four fixture containers and never to prior containers', async t => {
  await withMockDocker(t, {}, state => {
    assert.equal(state.startupError, undefined);assertPriorsPreserved(state);
    const runs = ownedCalls(state.calls, 'run');assert.equal(runs.length, 4);
    const expected = { db: 512, auth: 128, storage: 192, rest: 128 };
    for (const args of runs) {
      const kind = args[args.indexOf('--name') + 1].split('-').at(-1), cap = String(expected[kind] * 1024 * 1024);
      assert.equal(args[args.indexOf('--memory') + 1], cap);
      assert.equal(args[args.indexOf('--memory-swap') + 1], cap);
      assert.equal(args[args.indexOf('--cpus') + 1], '1');
      assert.equal(args[args.indexOf('--pull=never')], '--pull=never');
      assert.ok(!args.includes('-p') && !args.includes('--publish'));
      for (let i = 0; i < args.length; i++) if (args[i] === '-e') assert.match(args[i + 1], /^[A-Z][A-Z0-9_]*$/);
    }
    assert.equal(state.removed.length, 4);assert.equal(state.evidence.cleanup.credentialsDiscarded, true);
    assert.equal(state.evidence.cleanup.priorContainersStillRunning, true);
    assert.ok(state.calls.every(args => !['update', 'prune', 'stop', 'kill', 'restart'].includes(args[0])));
  }, { boundedResources: true });
});

test('migration loader preserves raw defaults and records opt-in normalized execution with safe EOF framing', async t => {
  const migrationSources = {
    '202601010001_crlf.sql': Buffer.from("create function public.fixture_lines() returns text language sql as $fixture$\r\nselect 'line endings';\r\n$fixture$;\r\n"),
    // PostgreSQL/psql accepts a final statement at EOF, without a final ';'.
    '202601010002_eof.sql': Buffer.from('create function public.fixture_eof() returns integer language sql as $fixture$\nselect 1;\n$fixture$'),
  };
  for (const normalize of [false, true]) await t.test(normalize ? 'opt-in CRLF normalization' : 'unchanged default execution and receipt shape', async t => {
    await withMockDocker(t, { migrationSources }, state => {
      assert.equal(state.startupError, undefined);
      assert.equal(state.evidence.migrationLineEndings, normalize ? 'crlf-to-lf' : 'as-read');
      assert.equal(state.migrationExecution.length, 2);assert.equal(state.evidence.migrationHashes.length, 2);
      for (const [index, [file, raw]] of Object.entries(migrationSources).entries()) {
        const executed = normalize ? Buffer.from(raw.toString().replace(/\r\n/g, '\n')) : raw;
        const wrapper = Buffer.concat([Buffer.from('begin;\n'), executed, Buffer.from('\n;\ncommit;')]);
        const actual = state.migrationExecution[index], receipt = state.evidence.migrationHashes[index];
        assert.equal(actual.scriptSha256, sha256(wrapper));assert.equal(actual.sourceSha256, sha256(executed));
        assert.equal(actual.explicitlyTerminated, true, 'COMMIT must follow an explicit separator even when the source has no terminal semicolon');
        assert.equal(actual.hasCRLF, !normalize && index === 0);
        assert.equal(sha256(fs.readFileSync(path.join(state.sourceDirectory, file))), sha256(raw), 'source bytes must remain unchanged');
        assert.deepEqual(receipt, normalize ? { file, sha256: sha256(raw), executedSha256: sha256(executed),
          executedScriptSha256: sha256(wrapper), normalization: 'crlf-to-lf' } : { file, sha256: sha256(raw) });
      }
      if (normalize) assert.notEqual(state.evidence.migrationHashes[0].sha256, state.evidence.migrationHashes[0].executedSha256);
      assertPriorsPreserved(state);
    }, normalize ? { normalizeMigrationLineEndings: true } : undefined);
  });
});
