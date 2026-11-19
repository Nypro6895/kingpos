import { isDeepStrictEqual } from 'node:util';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const matches = (value, pattern) => typeof value === 'string' && pattern.test(value);
const deployment = value => matches(value, /^dpl_[A-Za-z0-9]+$/);
const commit = value => matches(value, /^[a-f0-9]{40}$/i);
const digest = value => matches(value, /^[a-f0-9]{64}$/i);

// Date.parse alone normalizes invalid calendar dates such as February 30.
function timestamp(value) {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return false;
  const [, y, m, d, h, min, sec, , offsetH, offsetM] = parts;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(h) <= 23 && Number(min) <= 59 && Number(sec) <= 59
    && (offsetH === undefined || Number(offsetH) <= 23 && Number(offsetM) <= 59)
    && Number.isFinite(Date.parse(value));
}

/** Byte authentication and current-alias freshness remain coordinator gates.
 * This checks that the parsed, hash-verified receipt proves this exact baseline.
 */
export function validateBaselineEvidence(baseline, receipt) {
  try {
    return record(baseline) && record(receipt)
      && receipt.schemaVersion === 1 && receipt.kind === 'reylumi-production-baseline'
      && receipt.alias === 'reylumi.com'
      && baseline.authenticatedAliasVerified === true && receipt.authenticatedAliasVerified === true
      && deployment(receipt.deploymentId) && receipt.deploymentId === baseline.deploymentId
      && commit(receipt.sourceCommit) && receipt.sourceCommit === baseline.sourceCommit
      && digest(receipt.sourceManifestSha256) && receipt.sourceManifestSha256 === baseline.sourceManifestSha256
      && timestamp(receipt.capturedAt);
  } catch { return false; }
}

function completedTarget(channel, target) {
  if (!record(target) || target.verified !== true || !target.evidence) return false;
  if (channel === 'web') return target.status === 'published'
    && deployment(target.deploymentId) && deployment(target.baselineDeploymentId)
    && digest(target.sourceSha256) && digest(target.overlaySha256);
  return channel === 'ios' && ['testflight-available', 'app-store-published'].includes(target.status)
    && text(target.version) && text(target.build) && commit(target.commit);
}

function journalValue(value) {
  // readJournal ignores only this transport-only return field as well.
  const content = { ...value };
  delete content.filePath;
  return content;
}

/** A file with valid bytes is insufficient: publication must also exist in the
 * journal for the exact ready revision and requested channel.
 */
export function validateDependencyEvidence(row, receipt, journalEvents) {
  try {
    if (!record(row) || !record(receipt) || !Array.isArray(journalEvents)
      || !text(row.eventId) || !text(row.changeId) || !['web', 'ios'].includes(row.channel)
      || receipt.kind !== 'release' || !text(receipt.id) || !timestamp(receipt.recordedAt)
      || !Array.isArray(receipt.changes) || !receipt.changes.includes(row.eventId)) return false;

    const changes = journalEvents.filter(event => record(event) && event.kind === 'change' && event.id === row.eventId);
    const releases = journalEvents.filter(event => record(event) && event.kind === 'release' && event.id === receipt.id);
    if (changes.length !== 1 || releases.length !== 1) return false;
    const change = changes[0];
    return change.status === 'ready' && change.changeId === row.changeId
      && Array.isArray(change.channels) && change.channels.includes(row.channel)
      && isDeepStrictEqual(journalValue(receipt), journalValue(releases[0]))
      && completedTarget(row.channel, receipt.targets?.[row.channel]);
  } catch { return false; }
}
