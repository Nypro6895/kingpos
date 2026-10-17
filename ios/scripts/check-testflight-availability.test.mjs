import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apiURL, createAppleReader, checkAvailability, main } from './check-testflight-availability.mjs';
const now = Date.parse('2026-10-16T20:00:00Z');
function fixture({ association = true, automatic = true, previous = true, expired = false, processing = 'VALID', beta = 'IN_BETA_TESTING', wrongMarketing = false, buildNumber = '21.1', baselineNumber = '19.1' } = {}) {
  const calls = [], build = { type: 'builds', id: 'new-build', attributes: { version: buildNumber, uploadedDate: '2026-10-16T19:00:00Z', expirationDate: '2027-01-10T00:00:00Z', expired, processingState: processing }, relationships: { preReleaseVersion: { data: { id: 'marketing' } } } }, old = { ...build, id: 'old-build', attributes: { ...build.attributes, version: baselineNumber, uploadedDate: '2026-10-16T04:00:00Z' } };
  const read = async endpoint => {
    const url = apiURL(endpoint); calls.push(url.pathname);
    if (url.pathname === '/v1/builds') return { data: [url.searchParams.get('filter[version]') === baselineNumber ? old : build], included: [{ type: 'preReleaseVersions', id: 'marketing', attributes: { version: wrongMarketing ? '1.0.0' : '1.0.1' } }] };
    if (url.pathname.endsWith('/buildBetaDetail')) return { data: { attributes: { internalBuildState: beta } } };
    if (url.pathname === '/v1/betaGroups') return { data: [{ id: 'existing-group', attributes: { name: 'Reylumi Internal', isInternalGroup: true, hasAccessToAllBuilds: automatic, createdDate: '2026-01-01T00:00:00Z' } }] };
    if (url.pathname.endsWith('/builds')) return { data: [...(previous ? [old] : []), ...(association ? [build] : [])] };
    throw Error('Unexpected endpoint');
  };
  return { calls, read };
}
const run = f => checkAvailability({ build: '21.1', baselineBuild: '19.1', marketingVersion: '1.0.1', appId: '6821394475', now, read: f.read });
test('integer builds retain exact identity and existing-group proof across legacy and integer baselines', async () => {
  for (const [build, baselineBuild] of [['33', '32.1'], ['34', '33'], ['34.1.2', '34']]) {
    const f = fixture({ buildNumber: build, baselineNumber: baselineBuild });
    const result = await checkAvailability({ build, baselineBuild, marketingVersion: '1.0.1', appId: '6821394475', now, read: f.read });
    assert.equal(result.build, build); assert.equal(result.baselineBuild, baselineBuild);
    assert.equal(result.availableToExistingInternalGroup, true); assert.equal(result.groups[0].hadBaseline, true);
  }
});
test('processing checker accepts integer builds before credential validation and rejects malformed identifiers', () => {
  const env = { ...process.env }; delete env.APP_STORE_CONNECT_APP_ID;
  const script = fileURLToPath(new URL('./check-build-status.mjs', import.meta.url));
  for (const build of ['33', '32.1', '34.1.2']) {
    const result = spawnSync(process.execPath, [script, build], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1); assert.match(result.stderr, /app ID is not configured/);
  }
  for (const build of ['', '33beta', '33.1.2.3', '33&filter[app]=1']) {
    const result = spawnSync(process.execPath, [script, build], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1); assert.match(result.stderr, /exact TestFlight build number is required/);
  }
});
test('positive existing-group association and fresh valid build prove availability', async () => {
  const f = fixture(), result = await run(f);
  assert.equal(result.availableToExistingInternalGroup, true); assert.equal(result.groups[0].hadBaseline, true);
  assert.ok(f.calls.every(x => !x.includes('betaTesters')));
});
test('automatic distribution without positive new association remains unconfirmed', async () => {
  const result = await run(fixture({ association: false }));
  assert.equal(result.groups[0].hasAccessToAllBuilds, true); assert.equal(result.availableToExistingInternalGroup, false);
});
test('unrelated group without previous access is not borrowed', async () => {
  const result = await run(fixture({ previous: false, automatic: false }));
  assert.equal(result.groups[0].hasNewBuild, true); assert.equal(result.availableToExistingInternalGroup, false);
});
test('expired, processing and not-in-testing builds cannot pass', async () => {
  for (const flags of [{ expired: true }, { processing: 'PROCESSING' }, { beta: 'READY_FOR_BETA_TESTING' }]) assert.equal((await run(fixture(flags))).availableToExistingInternalGroup, false);
});
test('marketing version mismatch fails exact build resolution', async () => {
  await assert.rejects(run(fixture({ wrongMarketing: true })), /not uniquely visible/);
});
test('a new marketing version retains proof of access to the prior uploaded version', async () => {
  const f=fixture();
  const read=async endpoint=>{const response=await f.read(endpoint);const url=apiURL(endpoint);if(url.pathname==='/v1/builds'&&url.searchParams.get('filter[version]')==='21.1')response.included[0].attributes.version='1.1.0';return response;};
  const input={build:'21.1',baselineBuild:'19.1',marketingVersion:'1.1.0',appId:'6821394475',now,read};
  await assert.rejects(checkAvailability(input),/not uniquely visible/);
  const result=await checkAvailability({...input,baselineMarketingVersion:'1.0.1'});
  assert.equal(result.availableToExistingInternalGroup,true);
  assert.equal(result.baselineMarketingVersion,'1.0.1');
  assert.equal(result.groups[0].hadBaseline,true);
});
test('explicit existing group ID cannot silently fall back to another group', async () => {
  const f = fixture(), result = await checkAvailability({ build: '21.1', appId: '6821394475', groupId: 'different-group', now, read: f.read });
  assert.equal(result.groups.length, 0); assert.equal(result.availableToExistingInternalGroup, false);
});
test('reader is GET only, fixed Apple origin and refuses mutation/resource endpoints', async () => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }), calls = [];
  const read = createAppleReader({ APP_STORE_CONNECT_KEY_ID: 'fixture', APP_STORE_CONNECT_ISSUER_ID: 'fixture', APP_STORE_CONNECT_PRIVATE_KEY: privateKey }, async (url, options) => { calls.push({ url, options }); return new Response('{"data":[]}', { status: 200 }); });
  await read('betaGroups?filter[app]=6821394475');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.body, undefined);
  for (const endpoint of ['https://evil.invalid/v1/builds', 'betaTesters', 'apps/6821394475', 'betaGroups/id/relationships/builds']) await assert.rejects(read(endpoint), /Unsupported/);
  assert.equal(calls.length, 1);
});
test('foreign pagination cannot carry an Apple authorization header elsewhere', async () => {
  const f = fixture(), read = async endpoint => {
    const result = await f.read(endpoint);
    if (apiURL(endpoint).pathname === '/v1/betaGroups') result.links = { next: 'https://evil.invalid/v1/betaGroups' };
    return result;
  };
  await assert.rejects(checkAvailability({ build: '21.1', appId: '6821394475', now, read }), /Unsupported/);
});
test('failed or pending reads still write a sanitized nonconfirmed artifact', async () => {
  const tempRoot = path.resolve(os.tmpdir()), directory = await fs.mkdtemp(path.join(tempRoot, 'reylumi-readonly-status-'));
  const originalExitCode = process.exitCode;
  try {
    const output = path.join(directory, 'status.json');
    const env = { EXPECTED_BUILD: '33', BASELINE_BUILD: '32.1', APP_STORE_CONNECT_APP_ID: '6821394475', AVAILABILITY_OUTPUT: output };
    const failed = await main(env, { now, read: async () => { throw Error('PRIVATE PROVIDER RESPONSE: fixture-secret'); } });
    assert.equal(failed.availableToExistingInternalGroup, false);
    assert.equal(process.exitCode, 1);
    assert.equal(JSON.stringify(failed).includes('fixture-secret'), false);
    assert.equal(failed.build, '33'); assert.equal(failed.baselineBuild, '32.1');
    assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), failed);
    const pending = await main(env, { now, read: fixture({ buildNumber: '33', baselineNumber: '32.1', processing: 'PROCESSING' }).read });
    assert.equal(pending.status, 'not-yet-confirmed');
    assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).processingState, 'PROCESSING');
  } finally {
    process.exitCode = originalExitCode;
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), tempRoot);
    assert.equal(path.basename(resolved).startsWith('reylumi-readonly-status-'), true);
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
