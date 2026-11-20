import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { candidateOptions, dispatchBuildCheck, buildCheckStatus, githubClient } from '../scripts/ios/build-check-ci.mjs';

const sha = 'a'.repeat(40), ref = 'feature/ipad-test';
test('native QA dispatch rejects changed refs before mutation and cannot select another workflow', async () => {
  const calls = [];
  await assert.rejects(dispatchBuildCheck(async (path, options) => { calls.push({ path, options });return { sha: 'b'.repeat(40) }; }, { ref, sha, family: 'ipad' }), /does not match/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options, undefined);
  assert.throws(() => candidateOptions({ ref, sha: 'main' }), /exact 40-character/);
  assert.throws(() => candidateOptions({ ref, sha, family: 'testflight' }), /iphone or ipad/);
  const timestamp = Date.now();calls.length = 0;
  const result = await dispatchBuildCheck(async (path, options) => {
    calls.push({ path, options });
    if (path.startsWith('/commits/')) return { sha };
    if (path.endsWith('/dispatches')) return null;
    if (path.includes('/runs?')) return { workflow_runs: [{ id: 123, html_url: 'https://github.com/Nypro6895/kingpos/actions/runs/123', head_sha: sha, head_branch: ref, event: 'workflow_dispatch', created_at: new Date(timestamp).toISOString(), display_title: `iOS check (ipad) - ${sha}`, status: 'queued' }] };
    return { state: 'active', path: '.github/workflows/reylumi-ios-check.yml' };
  }, { ref, sha, family: 'ipad' }, { now: () => timestamp });
  const posts = calls.filter(call => call.options?.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, '/actions/workflows/reylumi-ios-check.yml/dispatches');
  assert.deepEqual(posts[0].options.body, { ref, inputs: { simulator_family: 'ipad' } });
  assert.equal(result.runId, 123);assert.equal(result.sha, sha);assert.equal(result.upload, false);
});

test('status is bound to the selected source and reports test jobs and artifacts', async () => {
  const request = async path => {
    if (path.includes('/jobs?')) return { jobs: [{ id: 3, name: 'Native', status: 'completed', conclusion: 'success', steps: [{ name: 'Tests', status: 'completed', conclusion: 'success' }] }] };
    if (path.includes('/artifacts?')) return { artifacts: [{ id: 4, name: 'native-results', size_in_bytes: 42, expired: false }] };
    return { id: 123, path: '.github/workflows/reylumi-ios-check.yml', head_sha: sha, status: 'completed', conclusion: 'success' };
  };
  await assert.rejects(buildCheckStatus(request, { runId: 123, sha: 'b'.repeat(40) }), /does not match/);
  const result = await buildCheckStatus(request, { runId: 123, sha });
  assert.equal(result.jobs[0].steps[0].conclusion, 'success');assert.equal(result.artifacts[0].id, 4);assert.equal(result.upload, false);
});

test('API failures never expose tokens or raw response bodies', async () => {
  const request = githubClient('SYNTHETIC_PRIVATE_TOKEN', async () => ({ ok: false, status: 403, json: async () => ({ message: 'SYNTHETIC_PRIVATE_TOKEN' }) }));
  await assert.rejects(request('/actions/workflows/reylumi-ios-check.yml'), error => error.message === 'GitHub build-check request failed: HTTP 403');
});

test('workflow keeps the iPhone default, offers iPad and retains unsigned full test gating', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/reylumi-ios-check.yml', 'utf8'));
  const input = workflow.on.workflow_dispatch.inputs.simulator_family;
  assert.equal(input.default, 'iphone');assert.deepEqual(input.options, ['iphone', 'ipad']);
  const job = workflow.jobs['simulator-and-archive'];
  assert.equal(job.env.REYLUMI_SIMULATOR_FAMILY, "${{ inputs.simulator_family || 'iphone' }}");
  assert.ok(job.steps.some(step => step.run === 'bash scripts/check-build.sh'));
  assert.ok(job.steps.some(step => step.with?.path?.includes('SimulatorTests*.xcresult')));
  assert.ok(!job.steps.some(step => /testflight|upload-app|altool|upload-symbols/i.test(step.run ?? '')));
});
