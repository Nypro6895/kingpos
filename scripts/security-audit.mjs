import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mapAdvisory = 'https://github.com/advisories/GHSA-jrc7-96c5-q579';
const mapSupplierAdvisory = 'https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579';
const blockingSeverities = new Set(['high', 'critical']);

/** A narrow upstream range correction, never an exception for another version/advisory. */
export function assessSecurityAudit(audit, lock) {
  if (!audit?.metadata?.vulnerabilities || !audit.vulnerabilities || audit.error || !lock?.packages) {
    throw Error('A complete npm audit response and lockfile are required');
  }
  for (const severity of blockingSeverities) {
    const reported = audit.metadata.vulnerabilities[severity] ?? 0;
    const detailed = Object.values(audit.vulnerabilities).filter(finding => finding?.severity === severity).length;
    if (!Number.isSafeInteger(reported) || reported < 0 || reported !== detailed) {
      throw Error('A complete, consistent npm audit response is required');
    }
  }
  const blocked = [], acceptedCorrections = [];
  for (const [name, finding] of Object.entries(audit.vulnerabilities)) {
    if (!blockingSeverities.has(finding.severity)) continue;
    const corrected = name === 'maplibre-gl' && finding.name === name &&
      Array.isArray(finding.nodes) && finding.nodes.length > 0 &&
      finding.nodes.every(node => (node === 'node_modules/maplibre-gl' || node.endsWith('/node_modules/maplibre-gl')) &&
        lock.packages[node]?.version === '5.24.1') &&
      Array.isArray(finding.via) && finding.via.length > 0 &&
      finding.via.every(via => typeof via === 'object' && via !== null && via.url === mapAdvisory);
    if (corrected) {
      acceptedCorrections.push({ name, version: '5.24.1', advisory: mapAdvisory,
        supplierEvidence: mapSupplierAdvisory,
        reason: 'Supplier lists 5.24.1 as patched; the bulk advisory range incorrectly includes this 5.x patch. Actual attribution sanitizer has a browser regression test.' });
    } else {
      blocked.push({ name, severity: finding.severity,
        advisories: (finding.via ?? []).map(via => typeof via === 'string' ? via : via.url) });
    }
  }
  return { counts: audit.metadata.vulnerabilities, blocked, acceptedCorrections };
}

export function runSecurityAudit(root = process.cwd()) {
  const cliCandidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
  const cli = cliCandidates.find(file => file && /npm-cli\.js$/.test(file) && existsSync(file));
  if (!cli) throw Error('Run this check with npm run security:audit so the npm CLI is explicit');
  const result = spawnSync(process.execPath, [cli, 'audit', '--json'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status)) throw Error('npm audit could not complete; security status is unknown');
  let audit;
  try { audit = JSON.parse(result.stdout); } catch { throw Error('npm audit returned an invalid response'); }
  const report = assessSecurityAudit(audit, JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')));
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.blocked.length) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runSecurityAudit(); } catch (error) {
    process.stderr.write(`Security audit failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
