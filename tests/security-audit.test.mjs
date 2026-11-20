import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSecurityAudit } from '../scripts/security-audit.mjs';

const url = 'https://github.com/advisories/GHSA-jrc7-96c5-q579';
const fixture = () => ({ metadata: { vulnerabilities: { critical: 1 } }, vulnerabilities: {
  'maplibre-gl': { name: 'maplibre-gl', severity: 'critical', nodes: ['node_modules/maplibre-gl'], via: [{ url }] },
} });
const lock = version => ({ packages: { 'node_modules/maplibre-gl': { version } } });
test('only the supplier-confirmed MapLibre 5.24.1 range correction is accepted', () => {
  const report = assessSecurityAudit(fixture(), lock('5.24.1'));
  assert.equal(report.blocked.length, 0);
  assert.equal(report.acceptedCorrections.length, 1);
  for (const version of ['5.24.0', '6.4.0', '5.24.2', undefined]) {
    assert.equal(assessSecurityAudit(fixture(), lock(version)).blocked.length, 1);
  }
});
test('new advisories, transitive vulnerable copies and other critical packages still block', () => {
  const newAdvisory = fixture(); newAdvisory.vulnerabilities['maplibre-gl'].via.push({ url: 'https://github.com/advisories/another' });
  assert.equal(assessSecurityAudit(newAdvisory, lock('5.24.1')).blocked.length, 1);
  const nested = fixture(); nested.vulnerabilities['maplibre-gl'].nodes.push('node_modules/other/node_modules/maplibre-gl');
  assert.equal(assessSecurityAudit(nested, lock('5.24.1')).blocked.length, 1);
  const other = fixture(); other.vulnerabilities.next = { name: 'next', severity: 'critical', via: [{ url: 'https://fixture.invalid/advisory' }] };
  other.metadata.vulnerabilities.critical = 2;
  assert.equal(assessSecurityAudit(other, lock('5.24.1')).blocked[0].name, 'next');
});
test('an incomplete or unavailable audit never reports success', () => {
  for (const value of [{}, { error: { code: 'ENOAUDIT' } }, { metadata: { vulnerabilities: {} } },
    { metadata: { vulnerabilities: { critical: 1 } }, vulnerabilities: {} }]) {
    assert.throws(() => assessSecurityAudit(value, lock('5.24.1')), /complete/);
  }
});
