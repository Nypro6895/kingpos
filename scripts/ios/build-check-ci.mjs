import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This helper can dispatch only the test/unsigned archive workflow. It has no
// TestFlight, production deployment, cancellation, signing or tester actions.
export const repository = 'Nypro6895/kingpos';
export const workflow = 'reylumi-ios-check.yml';
const workflowPath = '.github/workflows/' + workflow;
const check = (condition, message) => { if (!condition) throw Error(message); };

export function githubCredential() {
  const result = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    timeout: 20_000,
  });
  // Never forward credential helper stdout/stderr, even on an error.
  check(result.status === 0 && !result.error, 'Git Credential Manager could not provide GitHub access');
  const password = result.stdout.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  check(password, 'Git Credential Manager returned no GitHub credential');
  return password;
}

export function githubClient(token, fetcher = fetch) {
  return async function request(endpoint, { method = 'GET', body } = {}) {
    const response = await fetcher('https://api.github.com/repos/' + repository + endpoint, {
      method,
      headers: {
        Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Reylumi-native-build-check',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    // API error bodies and request objects are deliberately never printed.
    check(response.ok, 'GitHub build-check request failed: HTTP ' + response.status);
    return response.status === 204 ? null : response.json();
  };
}

export function candidateOptions({ ref, sha, family = 'iphone' }) {
  check(typeof ref === 'string' && ref.length > 0 && ref.length <= 200 && !/[\s\u0000-\u001f]/.test(ref), 'An explicit candidate branch or tag is required');
  check(/^[a-f0-9]{40}$/i.test(sha ?? ''), 'An exact 40-character source SHA is required');
  check(family === 'iphone' || family === 'ipad', 'Simulator family must be iphone or ipad');
  return { ref, sha: sha.toLowerCase(), family };
}

export async function dispatchBuildCheck(request, options, { now = () => Date.now(), pause = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  const candidate = candidateOptions(options);
  const commit = await request('/commits/' + encodeURIComponent(candidate.ref));
  check(commit.sha === candidate.sha, 'Remote candidate ref does not match the frozen source SHA; no build dispatched');
  const registered = await request('/actions/workflows/' + workflow);
  check(registered.state === 'active' && registered.path === workflowPath, 'Expected build-check workflow is unavailable');
  const dispatchedAt = now();
  await request('/actions/workflows/' + workflow + '/dispatches', {
    method: 'POST', body: { ref: candidate.ref, inputs: { simulator_family: candidate.family } },
  });
  const query = new URLSearchParams({ event: 'workflow_dispatch', head_sha: candidate.sha, branch: candidate.ref, per_page: '100' });
  let run = null;
  for (let attempt = 0; attempt < 15 && !run; attempt++) {
    const listed = await request('/actions/workflows/' + workflow + '/runs?' + query);
    const matches = listed.workflow_runs.filter(item => item.head_sha === candidate.sha &&
      item.head_branch === candidate.ref && item.event === 'workflow_dispatch' &&
      Date.parse(item.created_at) >= dispatchedAt - 10_000 &&
      item.display_title === `iOS check (${candidate.family}) - ${candidate.sha}`);
    check(matches.length <= 1, 'Multiple matching test runs; inspect Actions before selecting a run');
    run = matches[0] ?? null;
    if (!run && attempt < 14) await pause(2000);
  }
  return {
    kind: 'native-build-check-dispatch', repository, workflow,
    ...candidate, dispatchedAt: new Date(dispatchedAt).toISOString(),
    ...(run ? { runId: run.id, url: run.html_url, status: run.status } : { status: 'dispatched-awaiting-run-index' }),
    upload: false,
  };
}

export async function buildCheckStatus(request, { runId, sha }) {
  check(/^\d+$/.test(String(runId ?? '')), 'A numeric build-check run ID is required');
  check(/^[a-f0-9]{40}$/i.test(sha ?? ''), 'An exact 40-character source SHA is required');
  const run = await request('/actions/runs/' + runId);
  check(run.path === workflowPath && run.head_sha === sha.toLowerCase(), 'Workflow run does not match this build-check candidate');
  const [jobs, artifacts] = await Promise.all([
    request('/actions/runs/' + runId + '/jobs?per_page=100'),
    request('/actions/runs/' + runId + '/artifacts?per_page=100'),
  ]);
  return {
    kind: 'native-build-check-status', repository, workflow, sha: run.head_sha,
    runId: run.id, url: run.html_url, status: run.status, conclusion: run.conclusion,
    updatedAt: run.updated_at, upload: false,
    jobs: jobs.jobs.map(job => ({ id: job.id, name: job.name, status: job.status, conclusion: job.conclusion,
      steps: job.steps.map(step => ({ name: step.name, status: step.status, conclusion: step.conclusion })) })),
    artifacts: artifacts.artifacts.map(item => ({ id: item.id, name: item.name, bytes: item.size_in_bytes, expired: item.expired })),
  };
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...flags] = args, options = {};
  check(command === 'dispatch' || command === 'status', 'Usage: build-check-ci.mjs dispatch --ref BRANCH --sha SHA --family ipad [--receipt FILE] | status --run ID --sha SHA [--receipt FILE]');
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index], value = flags[index + 1];
    check(['--ref', '--sha', '--family', '--run', '--receipt'].includes(flag) && value && !value.startsWith('--') && !Object.hasOwn(options, flag), 'Invalid or duplicate build-check option');
    options[flag] = value;
  }
  // Validate input before obtaining credentials or sending any request.
  if (command === 'dispatch') candidateOptions({ ref: options['--ref'], sha: options['--sha'], family: options['--family'] });
  else check(/^\d+$/.test(options['--run'] ?? '') && /^[a-f0-9]{40}$/i.test(options['--sha'] ?? ''), 'Status requires --run ID and --sha exact source SHA');
  const request = githubClient(githubCredential());
  const result = command === 'dispatch'
    ? await dispatchBuildCheck(request, { ref: options['--ref'], sha: options['--sha'], family: options['--family'] })
    : await buildCheckStatus(request, { runId: options['--run'], sha: options['--sha'] });
  const output = JSON.stringify(result, null, 2) + '\n';
  if (options['--receipt']) {
    mkdirSync(path.dirname(options['--receipt']), { recursive: true });
    writeFileSync(options['--receipt'], output);
  }
  process.stdout.write(output);
  if (command === 'status' && result.status === 'completed' && result.conclusion !== 'success') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message);process.exitCode = 1; });
}
