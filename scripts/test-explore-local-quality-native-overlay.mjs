// QA-only compatible read-index overlay on a preserved synthetic fixture.
// This is not a production deployment/backfill procedure.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { initializeNativeFixture, sourceHash } from '../tests/fixtures/explore-local-quality-native-bootstrap.mjs';
import { readQualityMigrationBundle } from '../tests/fixtures/explore-local-quality-migration-manifest.mjs';
import { prepareNativeQuality } from '../tests/fixtures/explore-local-quality-native-preparation.mjs';
import { readQualityCatalog } from '../tests/fixtures/explore-local-quality-catalog-fingerprint.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => { const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=')]; }));
const root = path.resolve('.'), runtime = path.resolve('work/explore-local-quality-runtime');
const scale = Number(args.scale ?? 500000), suffix = args['fixture-suffix'] ?? 'bulkorganic';
const reuseIndexes = args['reuse-indexes'] === 'true', acceptEffective = args['accept-effective'] === 'true';
if (![100000, 500000, 1000000].includes(scale) || !/^[a-z][a-z0-9_]{0,20}$/.test(suffix)) throw new Error('Invalid bounded owned fixture.');
const database = `explore_load_local_quality_${suffix}_${scale}`;
const { Client } = createRequire(path.join(runtime, 'package.json'))('pg');
const url = name => `postgresql://explore_local_bench@127.0.0.1:55441/${name}`;
const bundle = readQualityMigrationBundle({ archiveDirectory: 'work/explore-local-quality-evidence/frozen' });
const report = { startedAt: new Date().toISOString(), database, scale, candidate: bundle.receipt, limitations: ['QA-only index/function overlay on an owned synthetic database; never a production rollout recommendation.', 'Original applied setup identity is preserved. Candidate effective code is accepted only when catalog matches a fresh fixture and projection content digests remain equal.', 'Content proof uses row count plus two independent seeded64-bit row-text hash sums; it is an order-independent local integrity check, not an adversarial cryptographic proof.', 'Index-build and diagnostic times are outside steady-query performance claims.'] };
const output = path.resolve(args.output ?? `work/explore-local-quality-evidence/native-overlay-${bundle.identitySha256.slice(0, 8)}-${scale}.json`);
mkdirSync(path.dirname(output), { recursive: true });
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
function extractFunction(source, name) {
  const start = source.indexOf(`CREATE FUNCTION public.${name}(`);
  if (start < 0 || source.indexOf(`CREATE FUNCTION public.${name}(`, start + 1) !== -1) throw new Error(`Expected one exact function definition: ${name}`);
  const body = source.indexOf('AS $$', start), end = source.indexOf('$$;', body + 5);
  if (body < 0 || end < 0) throw new Error(`Cannot isolate function: ${name}`);
  return source.slice(start, end + 3).replace(/^CREATE FUNCTION /, 'CREATE OR REPLACE FUNCTION ');
}
function extractIndex(source, name) {
  const line = source.split(/\r?\n/).filter(value => value.startsWith(`CREATE INDEX ${name} `));
  if (line.length !== 1 || !line[0].endsWith(';')) throw new Error(`Expected one complete index definition: ${name}`);
  return line[0];
}
const main = bundle.entries[0].sql, prep = bundle.entries[1].sql;
const overlaySql = ['BEGIN;', 'SET LOCAL search_path=public,extensions;', "SET LOCAL lock_timeout='1s';",
  extractFunction(main, 'explore_local_name_signatures'), extractFunction(main, 'explore_local_fuzzy_match'),
  extractFunction(main, 'explore_local_has_post'),
  ...(reuseIndexes ? [] : [extractIndex(main, 'explore_local_quality_name_signatures'), extractIndex(main, 'explore_local_quality_name_compact')]),
  extractFunction(main, 'explore_unified_pull_batch'), extractFunction(prep, 'activate_explore_local_quality'),
  'REVOKE ALL ON FUNCTION public.explore_local_name_signatures(text),public.explore_local_fuzzy_match(text,text) FROM PUBLIC,anon,authenticated;',
  'GRANT EXECUTE ON FUNCTION public.explore_local_name_signatures(text),public.explore_local_fuzzy_match(text,text) TO service_role;', 'COMMIT;'].join('\n\n') + '\n';
const overlaySha = sourceHash(overlaySql), archive = path.resolve(`work/explore-local-quality-evidence/frozen/overlay-${overlaySha}.sql`);
if (existsSync(archive)) { if (sourceHash(readFileSync(archive)) !== overlaySha) throw new Error('Archived overlay hash mismatch.'); }
else { writeFileSync(archive, overlaySql, { flag: 'wx' }); chmodSync(archive, 0o444); }
report.overlay = { file: path.relative(root, archive).replaceAll('\\', '/'), sha256: overlaySha };
report.reuseIndexes = reuseIndexes;
report.scriptSha256 = sourceHash(readFileSync(new URL(import.meta.url)));

async function digest(db) {
  const result = {};
  for (const table of ['explore_local_quality_documents', 'explore_local_quality_postings', 'explore_local_quality_preparation', 'explore_local_quality_dirty']) {
    result[table] = (await db.query(`SELECT count(*)::bigint AS rows,coalesce(sum(hashtextextended(t::text,0)::numeric),0)::text AS hash_sum_0,coalesce(sum(hashtextextended(t::text,1)::numeric),0)::text AS hash_sum_1 FROM public.${table} t`)).rows[0];
  }
  result.clock = (await db.query('SELECT * FROM explore_unified_search_clock')).rows;
  return result;
}
const admin = new Client({ connectionString: url('postgres'), application_name: 'explore_local_quality_owned_overlay_admin' });
const db = new Client({ connectionString: url(database), application_name: 'explore_local_quality_owned_overlay' });
let fresh;
try {
  await admin.connect();
  const directory = (await admin.query('SHOW data_directory')).rows[0].data_directory;
  if (path.resolve(directory).toLowerCase() !== path.join(runtime, 'data').toLowerCase()) throw new Error('Unowned native server.');
  await db.connect(); await db.query('SET statement_timeout=0');
  report.originalSetupMarker = (await db.query('SELECT * FROM explore_local_quality_benchmark')).rows[0];
  if (report.originalSetupMarker.task_root !== root || report.originalSetupMarker.scale !== scale) throw new Error('Owned target marker mismatch.');
  const existing = (await db.query("SELECT to_regclass('public.explore_local_quality_name_signatures') IS NOT NULL AS signatures,to_regclass('public.explore_local_quality_name_compact') IS NOT NULL AS compact")).rows[0];
  if (reuseIndexes ? !existing.signatures || !existing.compact : existing.signatures || existing.compact) throw new Error('Existing candidate indexes do not match the explicit reuse mode.');
  let originalSetupIdentity = report.originalSetupMarker.quality_setup_sha ?? report.originalSetupMarker.quality_sha;
  if (args['setup-receipt']) {
    const sourceBytes = readFileSync(args['setup-receipt']), source = JSON.parse(sourceBytes);
    const declared = source.qualityMigration?.identitySha256;
    if (!declared || originalSetupIdentity && originalSetupIdentity !== declared || !source.setup.some(entry => entry.scale === scale)) throw new Error('Original setup receipt does not match this owned target.');
    originalSetupIdentity = declared;
    report.originalSetupReceipt = { file: args['setup-receipt'], sha256: sourceHash(sourceBytes), identitySha256: declared };
  }
  if (!originalSetupIdentity) throw new Error('An interrupted setup requires its exact archived original setup receipt.');
  report.beforeCatalog = await readQualityCatalog(db); report.beforeData = await digest(db); save();
  bundle.verifyArchivedBytes();
  let began = performance.now(); await db.query(overlaySql); report.overlayDurationMs = performance.now() - began;
  began = performance.now(); await db.query('ANALYZE public.explore_local_quality_documents'); report.analyzeDurationMs = performance.now() - began;
  report.afterData = await digest(db); report.projectionUnchanged = JSON.stringify(report.beforeData) === JSON.stringify(report.afterData);
  if (!report.projectionUnchanged) throw new Error('Read-index overlay changed projection/state/clock contents.');
  report.afterCatalog = await readQualityCatalog(db); save();
  const freshDatabase = `explore_load_local_quality_catalog_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  if ((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [freshDatabase])).rowCount) throw new Error('Fresh fixture name already exists.');
  await admin.query(`CREATE DATABASE ${freshDatabase}`);
  fresh = new Client({ connectionString: url(freshDatabase), application_name: 'explore_local_quality_owned_fresh_catalog' });
  await fresh.connect(); await fresh.query('SET statement_timeout=0');
  await initializeNativeFixture(fresh, { scale: 10 });
  report.freshDatabase = freshDatabase;
  report.freshPreparation = await prepareNativeQuality(fresh, { bundle, scale: 10 });
  report.freshCatalog = await readQualityCatalog(fresh);
  report.catalogMatchesFresh = report.afterCatalog.sha256 === report.freshCatalog.sha256;
  if (!report.catalogMatchesFresh) throw new Error('Overlay catalog differs from a fresh candidate schema; no effective identity may be accepted.');
  report.compatibilityProof = { database, scale, originalSetupIdentity, candidateIdentity: bundle.identitySha256, overlaySha256: overlaySha,
    projectionBefore: report.beforeData, projectionAfter: report.afterData, projectionUnchanged: true, catalogSha256: report.afterCatalog.sha256, freshCatalogSha256: report.freshCatalog.sha256 };
  report.compatibilityProofSha256 = sourceHash(JSON.stringify(report.compatibilityProof));
  if (acceptEffective) {
    await db.query('ALTER TABLE explore_local_quality_benchmark ADD COLUMN IF NOT EXISTS quality_setup_sha text,ADD COLUMN IF NOT EXISTS quality_effective_sha text,ADD COLUMN IF NOT EXISTS quality_catalog_sha text,ADD COLUMN IF NOT EXISTS quality_overlay_sha text,ADD COLUMN IF NOT EXISTS quality_overlay_proof text,ADD COLUMN IF NOT EXISTS quality_overlay_proof_sha text');
    await db.query('UPDATE explore_local_quality_benchmark SET quality_setup_sha=$1,quality_effective_sha=$2,quality_catalog_sha=$3,quality_overlay_sha=$4,quality_overlay_proof=$5,quality_overlay_proof_sha=$6', [originalSetupIdentity,bundle.identitySha256,report.afterCatalog.sha256,overlaySha,path.relative(root,output).replaceAll('\\','/'),report.compatibilityProofSha256]);
    report.effectiveIdentityPublished = true;
  }
  report.passed = true; report.completedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ passed: true, output, overlaySha256: overlaySha, candidateIdentity: bundle.identitySha256, catalogSha256: report.afterCatalog.sha256, projectionUnchanged: true, overlayDurationMs: report.overlayDurationMs }));
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  report.passed = false; report.error = { code: error.code, message: error.message }; save(); process.exitCode = 1;
  console.error(JSON.stringify({ output, error: report.error }));
} finally { await fresh?.end().catch(() => {}); await db.end().catch(() => {}); await admin.end().catch(() => {}); }
