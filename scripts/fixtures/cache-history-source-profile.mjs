import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(process.env.CACHE_HISTORY_ARTIFACT_DIR || 'artifacts/auth-workspace-cache-repair-20261018');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const revisions = [
  ['pre-cache', 'cc53062ca58795e37ab62269655bea73f4902241'],
  ['first-scoped-cache', '0dbd5f8d747c04d5e5454dc42fbf3ee64212816f'],
  ['first-native-local-entry', '54f1e01e251172a31e852a874b7b0ad1ca600c06'],
  ['shipped-build37-source', 'ea618840b71e35fbd54bd31532f2676d6fd895a6'],
  ['instrumented-before-repair', '2ef993bb88d368d7e318b0965f5193db2a9f6ec0'],
  ['repair-working-source', null],
];
const selected = [
  'next.config.ts', 'app/(app)/layout.tsx', 'app/(app)/staff/today/page.tsx',
  'components/experience-scope.tsx', 'components/experience-page-boundary.tsx',
  'lib/use-experience-resource.ts', 'lib/experience-resource-cache.ts',
  'lib/experience-offline-client.ts', 'lib/experience-persistent-cache.ts', 'lib/experience-authorized-read.ts',
  'app/staff/today/today-dashboard-client.tsx', 'app/staff/today/today-progressive-client.tsx',
  'app/local-app/entry.tsx', 'lib/app-local-resource.ts',
];
const important = /cacheComponents:|const context = await|const languagePlugin = await|const dashboard = await|phase: "(?:core|shell)"|useAppLocalResource<|getAppLocalHost\(\)\.context|const value = usable\(|const activeAdmission =|const context = !isPublic|void refreshExperienceOfflineAuthorization|addEventListener\("(?:focus|online|reylumi:foreground)"|setBlocked\(true\)|freshForMs:|RETRY_DELAYS|timeoutMs: 8_000/;
const stages = revisions.map(([label, revision]) => {
  const tree = revision ? new Set(git('ls-tree', '-r', '--name-only', revision).split('\n')) : null;
  return {
    label, revision: revision ?? git('rev-parse', 'HEAD').trim(), workingSource: revision === null,
    files: selected.map(file => {
      if (tree ? !tree.has(file) : !existsSync(file)) return { file, present: false };
      const text = revision ? git('show', `${revision}:${file}`) : readFileSync(file, 'utf8');
      return { file, present: true, sha256: createHash('sha256').update(text).digest('hex'), evidence: text.split(/\r?\n/).flatMap((code, index) => important.test(code) ? [{ line: index + 1, code: code.trim() }] : []).slice(0, 30) };
    }),
  };
});
const report = {
  capturedAt: new Date().toISOString(), mode: 'Read-only exact Git/source inspection; no backend requests',
  firstCommittedScopedCache: {
    commit: revisions[1][1], parent: revisions[0][1],
    provenance: git('log', '--all', '--diff-filter=A', '--format=%H %P %aI %s', '--', 'lib/experience-resource-cache.ts').trim(),
    limitation: 'The first cache commit assembles a larger release; source comparison isolates these modules and cannot attribute every release behavior to caching.',
  },
  firstCommittedNativeLocalEntry: {
    commit: revisions[2][1],
    provenance: git('log', '--all', '--diff-filter=A', '--format=%H %P %aI %s', '--', 'app/local-app/entry.tsx').trim(),
    earlierFrozenBundleCommit: '45575132092cef6577c7905977c156145551871e',
    frozenBundleProvenance: git('log', '--all', '--diff-filter=A', '--format=%H %P %aI %s', '--', 'ios/Reylumi/LocalAppBundle/manifest.json').trim(),
    limitation: 'A frozen generated local runtime was committed before its source entry. These are source-history boundaries, not upload/installation proof.',
  },
  confirmedArchitecture: [
    'Pre-cache parent already waits for business context in the server layout and the full Today dashboard in its server page; absence of a browser cache does not prove fast historical backend reads.',
    'First scoped-cache release adds cacheComponents, scoped provider and retained boundary; its protected view can hide during stale authority validation. It initially has no later offline lease lifecycle.',
    'Shipped build37 source contains hosted offline lease reads and a distinct installed native-local entry. These paths have different admission and refresh mechanisms.',
    'Instrumented source splits Today into independently requested sections; generic cache-mechanics fixture does not measure those report calculations.',
    'An installed cold launch without a usable saved context must finish native context delivery and JS admission before private workspace readers mount; fresh retained data cannot substitute for that authority step.',
    'Warm fresh scoped data is reused in the controlled browser comparison. Revalidation may still contact a server even when no data HTTP is required.',
  ],
  limitations: ['No historic production or database timings reconstructed', 'No comparable bundled-native app existed in the pre-cache parent', 'Current repair source is not deployed and remains working until coordinator freeze'],
  stages,
};
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'cache-history-source-profile.json'), JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify({ stages: stages.length, firstCache: revisions[1][1], preCache: revisions[0][1], firstNativeEntry: revisions[2][1], evidence: 'cache-history-source-profile.json' }) + '\n');
