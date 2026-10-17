import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = 'https://api.appstoreconnect.apple.com/v1/';
const allowedPath = /^\/v1\/(?:builds|betaGroups|builds\/[^/]+\/buildBetaDetail|betaGroups\/[^/]+\/builds)$/;
const operation = 'GET requests only; no groups/testers/invitations/notifications/metadata changes';
export function apiURL(endpoint) {
  const url = new URL(endpoint, base);
  if (url.origin !== new URL(base).origin || url.username || url.password || url.hash || !allowedPath.test(url.pathname)) throw Error('Unsupported Apple read endpoint.');
  return url;
}
export function createAppleReader(env = process.env, fetcher = fetch) {
  return async endpoint => {
    const url = apiURL(endpoint), now = Math.floor(Date.now() / 1000), encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    if (!env.APP_STORE_CONNECT_KEY_ID || !env.APP_STORE_CONNECT_ISSUER_ID || !env.APP_STORE_CONNECT_PRIVATE_KEY) throw Error('Apple read credentials are not configured.');
    const unsigned = encode({ alg: 'ES256', kid: env.APP_STORE_CONNECT_KEY_ID, typ: 'JWT' }) + '.' + encode({ iss: env.APP_STORE_CONNECT_ISSUER_ID, iat: now, exp: now + 300, aud: 'appstoreconnect-v1' });
    const jwt = unsigned + '.' + crypto.sign('sha256', Buffer.from(unsigned), { key: env.APP_STORE_CONNECT_PRIVATE_KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const response = await fetcher(url, { method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer ' + jwt, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error('Apple read request failed: ' + response.status);
    const text = await response.text();
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw Error('Apple read response exceeded the expected limit.');
    return JSON.parse(text);
  };
}
async function list(endpoint, read) {
  const data = [], included = [];
  let next = endpoint;
  for (let page = 0; next && page < 10; page++) {
    apiURL(next);
    const result = await read(next);
    if (!Array.isArray(result.data)) throw Error('Apple list response was incomplete.');
    data.push(...result.data); included.push(...(result.included ?? []));
    next = result.links?.next;
  }
  if (next) throw Error('Apple list pagination exceeded the bounded audit.');
  return { data, included };
}
async function exactBuild(version, marketingVersion, appId, read) {
  const query = new URLSearchParams({ 'filter[app]': appId, 'filter[version]': version, include: 'preReleaseVersion', 'fields[builds]': 'version,uploadedDate,expirationDate,expired,processingState,preReleaseVersion', 'fields[preReleaseVersions]': 'version,platform', limit: '200' });
  const result = await list('builds?' + query, read);
  const preRelease = new Map(result.included.filter(x => x.type === 'preReleaseVersions').map(x => [x.id, x.attributes]));
  const matches = result.data.filter(x => x.attributes?.version === version && preRelease.get(x.relationships?.preReleaseVersion?.data?.id)?.version === marketingVersion);
  if (matches.length !== 1) throw Error('Exact app/marketing version/build is not uniquely visible: ' + version);
  return matches[0];
}
export async function checkAvailability({ build, baselineBuild = '19.1', marketingVersion = '1.0.1', baselineMarketingVersion = marketingVersion, appId, groupId, read, now = Date.now() }) {
  if (!/^\d+\.\d+$/.test(build ?? '') || !/^\d+\.\d+$/.test(baselineBuild) || !/^\d+\.\d+\.\d+$/.test(marketingVersion) || !/^\d+$/.test(appId ?? '')) throw Error('Exact app, marketing version and build numbers are required.');
  if (groupId && !/^[A-Za-z0-9_-]{1,200}$/.test(groupId)) throw Error('Invalid existing group ID.');
  if (!/^\d+\.\d+\.\d+$/.test(baselineMarketingVersion)) throw Error('Exact app, marketing version and build numbers are required.');
  const current = await exactBuild(build, marketingVersion, appId, read), baseline = await exactBuild(baselineBuild, baselineMarketingVersion, appId, read);
  const beta = await read('builds/' + encodeURIComponent(current.id) + '/buildBetaDetail');
  const query = new URLSearchParams({ 'filter[app]': appId, 'filter[isInternalGroup]': 'true', 'fields[betaGroups]': 'name,createdDate,isInternalGroup,hasAccessToAllBuilds', limit: '200' });
  const found = await list('betaGroups?' + query, read);
  const groups = found.data.filter(x => x.attributes?.isInternalGroup === true && (!groupId || x.id === groupId));
  if (groups.length > 20) throw Error('Too many internal groups for a bounded status audit.');
  const results = [];
  for (const group of groups) {
    const membership = await list('betaGroups/' + encodeURIComponent(group.id) + '/builds?fields[builds]=version,processingState,expired&limit=200', read);
    const ids = new Set(membership.data.map(x => x.id)), hadBaseline = ids.has(baseline.id), hasNewBuild = ids.has(current.id);
    const existedBeforeBaseline = Number.isFinite(Date.parse(group.attributes.createdDate)) && Date.parse(group.attributes.createdDate) <= Date.parse(baseline.attributes.uploadedDate);
    const preexistingAutomaticGroup = existedBeforeBaseline && group.attributes.hasAccessToAllBuilds === true;
    results.push({ id: group.id, name: group.attributes.name, isInternalGroup: true, hasAccessToAllBuilds: group.attributes.hasAccessToAllBuilds === true,
      hadBaseline, preexistingAutomaticGroup, hasNewBuild, existingDistributionGroup: hadBaseline || preexistingAutomaticGroup,
      associationConfirmed: hasNewBuild && (hadBaseline || preexistingAutomaticGroup) });
  }
  const valid = current.attributes.processingState === 'VALID' && current.attributes.expired === false && Date.parse(current.attributes.expirationDate) > now;
  const internalBuildState = beta.data?.attributes?.internalBuildState;
  const available = valid && internalBuildState === 'IN_BETA_TESTING' && results.some(x => x.associationConfirmed);
  return { checkedAt: new Date(now).toISOString(), operation, appId, marketingVersion, baselineMarketingVersion,
    build: current.attributes.version, buildId: current.id, baselineBuild, baselineBuildId: baseline.id, processingState: current.attributes.processingState,
    expired: current.attributes.expired, expirationDate: current.attributes.expirationDate, internalBuildState,
    availableToExistingInternalGroup: available, groups: results,
    status: available ? 'available-to-existing-internal-group' : 'not-yet-confirmed',
    limitations: ['This confirms Apple group access, not installation or automatic update on a particular phone.', 'An automatic-distribution flag without the new build association is not reported as confirmed availability.', 'External TestFlight and App Store publication are separate.'] };
}
export async function main(env = process.env, { read = createAppleReader(env), now = Date.now() } = {}) {
  const build = env.EXPECTED_BUILD ?? process.argv[2], baselineBuild = env.BASELINE_BUILD ?? '19.1';
  const marketingVersion = env.EXPECTED_MARKETING_VERSION ?? '1.0.1', appId = env.APP_STORE_CONNECT_APP_ID;
  let receipt;
  try {
    receipt = await checkAvailability({ build, baselineBuild, marketingVersion, baselineMarketingVersion: env.BASELINE_MARKETING_VERSION || marketingVersion, groupId: env.EXISTING_GROUP_ID || undefined, appId, read, now });
  } catch (error) {
    // Do not persist raw provider, crypto, or credential errors in public job artifacts.
    const safeMessage = /^(?:Apple read request failed: \d{3}|Apple read credentials are not configured\.|Exact app\/marketing version\/build is not uniquely visible: \d+\.\d+|Exact app, marketing version and build numbers are required\.|Invalid existing group ID\.|Unsupported Apple read endpoint\.|Apple (?:read response exceeded the expected limit|list response was incomplete|list pagination exceeded the bounded audit)\.|Too many internal groups for a bounded status audit\.)$/.test(error?.message ?? '')
      ? error.message : 'Apple availability could not be confirmed by this read-only audit.';
    const safeValue = (value, pattern) => pattern.test(value ?? '') ? value : null;
    receipt = { checkedAt: new Date(now).toISOString(), operation,
      appId: safeValue(appId, /^\d+$/), marketingVersion: safeValue(marketingVersion, /^\d+\.\d+\.\d+$/),
      build: safeValue(build, /^\d+\.\d+$/), baselineBuild: safeValue(baselineBuild, /^\d+\.\d+$/),
      availableToExistingInternalGroup: false, status: 'not-yet-confirmed', error: safeMessage,
      limitations: ['A failed or incomplete read does not prove that Apple has rejected the build.', 'No distribution settings were changed.'] };
  }
  const output = env.AVAILABILITY_OUTPUT ?? 'build/testflight-availability.json';
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
  if (!receipt.availableToExistingInternalGroup) process.exitCode = 1;
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
