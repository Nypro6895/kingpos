// Reproducible isolated native PostgreSQL search benchmark. Never accepts production hosts/databases.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { initializeNativeFixture, legacyMigrationStack, unifiedMigrationStack, sourceHash } from '../tests/fixtures/explore-local-quality-native-bootstrap.mjs';
import { readQualityMigrationBundle } from '../tests/fixtures/explore-local-quality-migration-manifest.mjs';
import { prepareNativeQuality } from '../tests/fixtures/explore-local-quality-native-preparation.mjs';
import { verifyEffectiveQuality } from '../tests/fixtures/explore-local-quality-effective-identity.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => { const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=')]; }));
const taskRoot = path.resolve('.');
const runtime = path.resolve(args.runtime ?? 'work/explore-local-quality-runtime');
const endpoint = new URL(args['database-url'] ?? 'postgresql://explore_local_bench@127.0.0.1:55441/postgres');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.port !== '55441' || endpoint.pathname !== '/postgres') throw new Error('Only the owned localhost:55441 postgres admin connection is accepted.');
const scales = (args.scales ?? '100000,500000,1000000').split(',').map(Number);
const levels = (args.concurrency ?? '1,8,16').split(',').map(Number);
const samples = Number(args.samples ?? 42), pages = Number(args.pages ?? 2);
const phase = args.phase ?? 'baseline';
const fixtureSuffix = args['fixture-suffix'] ?? 'bulkorganic';
if (!/^[a-z][a-z0-9_]{0,20}$/.test(fixtureSuffix)) throw new Error('Invalid owned fixture suffix.');
if (scales.some(n => !Number.isInteger(n) || n < 1 || n > 1000000) || levels.some(n => !Number.isInteger(n) || n < 1 || n > 16) || !Number.isInteger(samples) || samples < 1 || samples > 1000 || !Number.isInteger(pages) || pages < 1 || pages > 50 || !['baseline', 'quality'].includes(phase)) throw new Error('Invalid bounded benchmark options.');
const { Pool } = createRequire(path.join(runtime, 'package.json'))('pg');
const output = path.resolve(args.output ?? `work/explore-local-quality-evidence/native-${phase}.json`);
mkdirSync(path.dirname(output), { recursive: true });
const sourceFiles = ['tests/fixtures/explore-local-quality-native-bootstrap.mjs', 'tests/fixtures/explore-local-quality-migration-manifest.mjs', 'tests/fixtures/explore-local-quality-native-preparation.mjs', 'tests/fixtures/explore-local-quality-catalog-fingerprint.mjs', 'tests/fixtures/explore-local-quality-effective-identity.mjs', 'tests/fixtures/explore-social-bootstrap.sql', 'scripts/benchmark-explore-local-quality.mjs', 'scripts/test-explore-local-quality-native-overlay.mjs', 'scripts/backfill-explore-local-quality.mjs', ...legacyMigrationStack.map(n => `supabase/migrations/${n}`), ...unifiedMigrationStack.map(n => `supabase/migrations/${n}`)];
if (args['migration-file']) throw new Error('Use --migration-files=first.sql,second.sql for the complete ordered migration pair.');
// Each file is read once; receipt hashes and executed strings share the same bytes.
const qualityBundle = phase === 'quality' ? readQualityMigrationBundle({ root: taskRoot, inputFiles: args['migration-files']?.split(','), archiveDirectory: 'work/explore-local-quality-evidence/frozen' }) : null;
const frozenQualitySha = qualityBundle?.identitySha256;
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, sourceHash(readFileSync(file))]));
if (qualityBundle) for (const entry of qualityBundle.receipt.files) sourceHashes[entry.appliedSourceFile] = entry.sha256;
const report = { startedAt: new Date().toISOString(), phase, engine: 'native PostgreSQL17 dedicated localhost:55441', sourceHashes,
  qualityMigration: qualityBundle?.receipt ?? null,
  qualityIdentitySemantics: 'Frozen expected final schema source. Per-scale setup/effective-identity receipts distinguish fresh exact application from a verified compatible QA overlay/resume; original setup SQL identities are preserved.',
  settings: { samples, pages, levels, scales, statementTimeoutMs: Number(args['timeout-ms'] ?? 3000) }, environment: { cpu: os.cpus()[0]?.model, cpus: os.cpus().length, memoryBytes: os.totalmem() }, limitations: ['Synthetic minimal canonical source shapes and public visibility/block helpers; exact product search migrations execute, not the entire application schema.', 'Setup bulk seeds final historical read-model rows using exact product fingerprint functions, bypassing old upgrade/all-ID refresh coordination. Secondary projection indexes are rebuilt from identical saved definitions and all source triggers restored before queries. Actual new quality migration/backfill is applied unchanged.', 'SQL over localhost only; excludes HTTP, rendering, selected-card lifetime enrichment and media delivery.', 'No OS cache eviction; chronological warmed-buffer samples are not cold-disk or a monotonic scaling proof.', 'Dense Milwaukee has coordinates, Madison has 5% coordinates, Green Bay has none, LA is far away. These are separate regional distributions in one fixture, not three complete-database replicas.', 'Concurrency is SQL workers, not online-user capacity.', 'Baseline and quality share the same source fixture per scale, but adding quality projections changes memory/cache and physical size.'], runs: [], setup: [] };
const persist = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const pct = (xs, p) => xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1] : null;
const stats = xs => ({ count: xs.length, p50: pct(xs, .5), p95: pct(xs, .95), max: xs.length ? Math.max(...xs) : null });
const cases = [
  { name: 'one letter name prefix', query: 'd', queryKind: 'name', category: '', location: 'Milwaukee, WI' },
  { name: 'two letter name prefix', query: 'di', queryKind: 'name', category: '', location: 'Milwaukee, WI' },
  { name: 'absent one letter name prefix', query: 'z', queryKind: 'name', category: '', location: 'Milwaukee, WI' },
  { name: 'absent two letter name prefix', query: 'zz', queryKind: 'name', category: '', location: 'Milwaukee, WI' },
  { name: 'exact name city', query: 'King Nails', queryKind: 'name', category: '', location: 'Milwaukee, WI' },
  { name: 'fuzzy name city', query: 'Kign Nails', queryKind: 'name', category: '', location: 'Milwaukee, WI' },
  { name: 'broad category city', query: '', queryKind: 'service', category: 'Nails', location: 'Milwaukee, WI' },
  { name: 'missing name city', query: 'zzzzunknownsalon', queryKind: 'name', category: '', location: 'Milwaukee, WI' },
  { name: 'specific service city', query: 'dip powder', queryKind: 'service', category: 'Nails', location: 'Milwaukee, WI' },
  { name: 'broad gel service city', query: 'gel', queryKind: 'service', category: 'Nails', location: 'Milwaukee, WI' },
  { name: 'broad manicure service city', query: 'manicure', queryKind: 'service', category: 'Nails', location: 'Milwaukee, WI' },
  { name: 'style city', query: 'red almond cat eye', queryKind: 'style', category: 'Nails', location: 'Milwaukee, WI' },
  { name: 'broad state', query: '', queryKind: 'service', category: 'Nails', location: 'WI' },
  { name: 'GPS dense', query: '', queryKind: 'service', category: 'Nails', latitude: 43.0389, longitude: -87.9065, location: '' },
  { name: 'GPS sparse regional', query: '', queryKind: 'service', category: 'Nails', latitude: 43.0731, longitude: -89.4012, location: '' },
  { name: 'GPS zero regional', query: '', queryKind: 'service', category: 'Nails', latitude: 44.5133, longitude: -88.0133, location: '' },
  { name: 'GPS missing word', query: 'zzzzunknownsalon', queryKind: 'name', category: '', latitude: 43.0389, longitude: -87.9065, location: '' },
  { name: 'style missing city', query: 'quantumunicorn', queryKind: 'style', category: 'Nails', location: 'Milwaukee, WI' },
  { name: 'GPS dense explicit Closest', query: '', queryKind: 'service', category: 'Nails', latitude: 43.0389, longitude: -87.9065, location: '', sort: 'closest' },
  { name: 'broad city explicit newest', query: '', queryKind: 'service', category: 'Nails', location: 'Milwaukee, WI', sort: 'newest' },
  { name: 'keyword unsupported Trust fallback', query: 'dip powder', queryKind: 'service', category: 'Nails', location: 'Milwaukee, WI', sort: 'trusted' },
];
const rpc = `SELECT search_public_explore_session(p_query=>$1,p_category=>$2,p_location=>$3,p_latitude=>$4,p_longitude=>$5,p_sort=>$8,p_limit=>12,p_cursor=>$6::jsonb,p_scope_policy=>'fixed',p_intent=>'search',p_content_query=>$1,p_query_kind=>$7,p_location_priority=>true,p_filters=>'{}'::jsonb) AS page`;
async function cursorContractChecks(db) {
  const checks = [];
  await db.query('SET statement_timeout=15000');
  const params = ['', 'Nails', 'Milwaukee, WI', null, null, null, 'service', 'relevance'];
  const first = (await db.query(rpc, params)).rows[0].page;
  if (!first.sessionCursor || first.searchVersion !== 3) throw new Error('Cursor contract fixture did not create a v3 session.');
  async function rejected(name, values, code = '22023') {
    try { await db.query(rpc, values); throw new Error(`${name} was unexpectedly accepted`); }
    catch (error) { if (error.code !== code) throw error; checks.push({ name, passed: true, code }); }
  }
  await rejected('changed query cannot reuse cursor', ['changed query', ...params.slice(1, 5), first.sessionCursor, 'service', 'relevance']);
  await db.query("SELECT set_config('test.viewer','f0000000-0000-4000-8000-000000000001',false)");
  try { await rejected('other viewer cannot reuse cursor', [...params.slice(0, 5), first.sessionCursor, 'service', 'relevance']); }
  finally { await db.query("SELECT set_config('test.viewer','',false)"); }
  await rejected('old cursor version cannot enter v3', [...params.slice(0, 5), { ...first.sessionCursor, version: 1 }, 'service', 'relevance']);
  await db.query("UPDATE explore_search_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [first.sessionCursor.session]);
  await rejected('expired session cannot continue', [...params.slice(0, 5), first.sessionCursor, 'service', 'relevance']);
  return checks;
}
const admin = new Pool({ connectionString: endpoint.href, max: 1, application_name: 'explore_local_quality_owned_admin' });
try {
  const identity = (await admin.query('SHOW data_directory')).rows[0].data_directory;
  const ownData = path.join(runtime, 'data');
  if (path.resolve(identity).toLowerCase() !== ownData.toLowerCase()) throw new Error('Server data directory does not belong to this task.');
  for (const scale of scales) {
    const database = `explore_load_local_quality_${fixtureSuffix}_${scale}`;
    const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount > 0;
    if (!exists) {
      if (phase !== 'baseline') throw new Error(`Baseline fixture missing: ${database}`);
      await admin.query(`CREATE DATABASE ${database}`);
    }
    const url = new URL(endpoint); url.pathname = `/${database}`;
    const pool = new Pool({ connectionString: url.href, max: Math.max(2, ...levels), application_name: `explore_local_quality_${phase}` });
    try {
      const client = await pool.connect();
      try {
        await client.query('SET statement_timeout=0');
        const hasMarker = (await client.query("SELECT to_regclass('public.explore_local_quality_benchmark') AS marker")).rows[0].marker;
        if (!hasMarker) {
          if ((await client.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n) throw new Error('Unmarked nonempty database; refusing setup.');
          const began = performance.now();
          await client.query('CREATE TABLE explore_local_quality_benchmark(task_root text PRIMARY KEY,scale integer,quality_sha text)');
          await client.query('INSERT INTO explore_local_quality_benchmark VALUES($1,$2,NULL)', [taskRoot, scale]);
          await initializeNativeFixture(client, { scale, onStage: stage => { console.log(`${database}: ${stage} (${Math.round(performance.now() - began)}ms)`); } });
          report.setup.push({ scale, durationMs: performance.now() - began }); persist();
        }
        const marker = (await client.query('SELECT * FROM explore_local_quality_benchmark')).rows[0];
        if (marker.task_root !== taskRoot || marker.scale !== scale) throw new Error('Ownership/scale marker mismatch.');
        const hasQualitySchema = (await client.query("SELECT to_regclass('public.explore_local_quality_documents') IS NOT NULL AS installed")).rows[0].installed;
        if (hasQualitySchema && !marker.quality_sha && !(args['resume-preparation'] === 'true' && marker.quality_effective_sha)) throw new Error('A partial quality preparation exists without an accepted effective identity; preserve it as diagnostic or explicitly resume after catalog proof.');
        const ready = (await client.query("SELECT (SELECT count(*)::int FROM explore_unified_salon_history WHERE valid_to IS NULL) AS salons,(SELECT count(*)::int FROM salon_profile_looks) AS organic_posts,(SELECT count(*)::int FROM explore_salon_documents WHERE nullif(phone,'') IS NOT NULL) AS salons_with_phone,(SELECT count(*)::int FROM explore_salon_documents WHERE nullif(address_line1,'') IS NOT NULL) AS salons_with_street,(SELECT count(*)::int FROM explore_salon_documents WHERE nullif(description,'') IS NOT NULL) AS salons_with_description,(SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='D' AND tgrelid IN ('explore_salon_documents'::regclass,'salon_profile_looks'::regclass,'salon_profile_updates'::regclass,'salon_directory_listings'::regclass,'salon_profile_media_assets'::regclass)) AS disabled_triggers")).rows[0];
        if (ready.salons !== scale || ready.organic_posts < Math.floor(scale / 19) * 2 || ready.disabled_triggers !== 0) throw new Error('Owned fixture setup is incomplete; preserve it as diagnostic and use a fresh fixture suffix.');
        report.setup.push({ scale, dataset: ready });
        if (phase === 'baseline' && marker.quality_sha) throw new Error('Quality migration already applied; baseline would be invalid.');
        if (phase === 'quality') {
          const sha = frozenQualitySha;
          qualityBundle.verifyArchivedBytes();
          const effective = hasQualitySchema ? await verifyEffectiveQuality(client, marker, sha) : null;
          if (effective) { report.setup.push({ scale, existingSchemaIdentity: effective }); persist(); }
          if (!marker.quality_sha) {
            const controlDb = await pool.connect();
            try {
              const preparation = await prepareNativeQuality(client, { bundle: qualityBundle, scale, controlDb, existingSchemaProof: effective?.compatibilityProof,
                onProgress: progress => { if (progress.event !== 'batch' || progress.batch % 100 === 0 || progress.done) console.log(JSON.stringify({ scale, ...progress })); } });
              report.setup.push({ scale, qualityPreparation: preparation }); persist();
              if (preparation.writerControlSummary.backfillFailures > 0) throw new Error('Bounded backfill prevented a sampled canonical writer/RowExclusive control; preserve this fixture for diagnosis.');
              const count = (await client.query('SELECT count(*)::int n FROM explore_local_quality_documents WHERE valid_to IS NULL')).rows[0].n;
              if (count !== scale) throw new Error('Active quality projection count does not match the unchanged synthetic source.');
              await client.query('UPDATE explore_local_quality_benchmark SET quality_sha=$1', [effective?.originalSetupIdentity ?? sha]);
              persist();
            } catch (error) { if (error.preparationReceipt) { report.setup.push({ scale, failedQualityPreparation: error.preparationReceipt }); persist(); } throw error; }
            finally { controlDb.release(); }
          }
        }
      } finally { client.release(); }
      if (args['setup-only'] === 'true') continue;
      // Flush this owned synthetic server's setup writes before either phase's measurement.
      await pool.query('CHECKPOINT');
      const contractClient = await pool.connect();
      try {
        try { report.setup.push({ scale, cursorChecks: await cursorContractChecks(contractClient) }); }
        catch (error) { report.setup.push({ scale, cursorChecksError: { message: error.message, code: error.code } }); if (phase === 'quality') throw error; }
        persist();
      }
      finally { contractClient.release(); }
      for (const concurrency of levels) {
        const run = { scale, concurrency, sessions: samples, cases: [], errors: [], firstPages: [], continuations: [] };
        const caseRows = cases.map(c => ({ name: c.name, first: [], next: [], errors: [], correctnessFailures: [], observations: [] }));
        let task = 0, completed = 0;
        const worker = async () => {
          const db = await pool.connect();
          try {
            await db.query(`SET statement_timeout=${report.settings.statementTimeoutMs}`);
            while (task < samples) {
              const sample = task++, index = sample % cases.length, c = cases[index], entry = caseRows[index];
              const seen = new Set(); let cursor = null;
              for (let page = 1; page <= pages; page++) {
                const began = performance.now();
                try {
                  const result = (await db.query(rpc, [c.query, c.category, c.location, c.latitude ?? null, c.longitude ?? null, cursor, c.queryKind, c.sort ?? 'relevance'])).rows[0].page;
                  const ms = performance.now() - began;
                  (page === 1 ? entry.first : entry.next).push(ms); (page === 1 ? run.firstPages : run.continuations).push(ms);
                  if (result.searchVersion !== 3 || !Array.isArray(result.rows) || result.rows.length > 12) entry.correctnessFailures.push({ sample, page, reason: 'version/row bound' });
                  for (const row of result.rows ?? []) {
                    if (seen.has(row.salon_id)) entry.correctnessFailures.push({ sample, page, reason: 'duplicate ID' }); seen.add(row.salon_id);
                    if (row.is_primary_match && c.location === 'Milwaukee, WI' && row.city !== 'Milwaukee') entry.correctnessFailures.push({ sample, page, reason: 'primary outside fixed city' });
                    if (row.is_primary_match && c.latitude != null && (row.distance_miles == null || Number(row.distance_miles) > 50)) entry.correctnessFailures.push({ sample, page, reason: 'primary GPS distance missing/outside50mi' });
                  }
                  if (entry.observations.length < 3) entry.observations.push({ sample, page, rows: result.rows.length, primary: result.primaryCount, reference: result.referenceCount, totalLoaded: result.totalCount, hasMore: result.hasMore, requestedSort: result.requestedSort, appliedSort: result.appliedSort, sortFallbackReason: result.sortFallbackReason, rankingBasis: result.rankingBasis });
                  cursor = result.nextCursor;
                  if (!result.hasMore || !cursor) break;
                } catch (error) {
                  const detail = { sample, page, code: error.code, message: error.message, durationMs: performance.now() - began };
                  entry.errors.push(detail); run.errors.push({ case: c.name, ...detail }); break;
                }
              }
              completed++;
              if (completed % 10 === 0 || completed === samples) {
                report.progress = { phase, scale, concurrency, completed, sessions: samples, errors: run.errors.length };
                persist(); console.log(JSON.stringify(report.progress));
              }
            }
          } finally { db.release(); }
        };
        const began = performance.now(); await Promise.all(Array.from({ length: concurrency }, worker));
        run.durationMs = performance.now() - began;
        run.firstPage = stats(run.firstPages); run.continuation = stats(run.continuations);
        run.firstPage.attempts = run.firstPage.count + run.errors.filter(error => error.page === 1).length;
        run.continuation.attempts = run.continuation.count + run.errors.filter(error => error.page > 1).length;
        run.timeoutCount = run.errors.filter(error => error.code === '57014').length;
        run.latencyIncludes = 'successful SQL calls only; timed-out/failed attempts are counted separately with their duration';
        delete run.firstPages; delete run.continuations;
        run.cases = caseRows.map(c => ({ ...c, first: stats(c.first), next: stats(c.next) }));
        report.runs.push(run); persist();
        console.log(JSON.stringify({ phase, scale, concurrency, firstP95: run.firstPage.p95, nextP95: run.continuation.p95, errors: run.errors.length, ms: run.durationMs }));
      }
      const metadataClient = await pool.connect();
      try {
        await metadataClient.query('SET statement_timeout=0');
        report.setup.push({ scale, storage: (await metadataClient.query("SELECT pg_size_pretty(pg_database_size(current_database())) AS total,(SELECT count(*)::int FROM explore_unified_salon_history) AS salonHistory,(SELECT count(*)::int FROM explore_unified_content_history) AS contentHistory")).rows[0] });
        if (phase === 'quality') {
          report.setup.push({ scale, qualityStorage: (await metadataClient.query("SELECT relname,pg_relation_size(oid) AS heapBytes,pg_indexes_size(oid) AS indexBytes,pg_total_relation_size(oid) AS totalBytes FROM pg_class WHERE relname IN ('explore_local_quality_documents','explore_local_quality_postings')")).rows,
            postingFanout: (await metadataClient.query("SELECT count(*)::bigint postings,count(DISTINCT salon_id)::bigint salons FROM explore_local_quality_postings")).rows[0] });
        }
      } finally { metadataClient.release(); }
      persist();
    } finally { await pool.end(); }
  }
  delete report.progress; report.completedAt = new Date().toISOString(); persist();
} catch (error) { report.fatal = { message: error.message, code: error.code }; persist(); console.error(JSON.stringify({ fatal: report.fatal, output })); process.exitCode = 1; }
finally { await admin.end(); }
