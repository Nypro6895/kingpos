// Extended keyword/sort regression on owned native fixtures; complements the balanced scale matrix.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readQualityMigrationBundle } from '../tests/fixtures/explore-local-quality-migration-manifest.mjs';
import { verifyEffectiveQuality } from '../tests/fixtures/explore-local-quality-effective-identity.mjs';
const options = Object.fromEntries(process.argv.slice(2).map(value => { const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=')]; }));
const scale = Number(options.scale ?? 1000000), phase = options.phase ?? 'quality', suffix = options['fixture-suffix'] ?? 'bulkorganic';
const levels = (options.concurrency ?? '1,8,16').split(',').map(Number), repeats = Number(options.repeats ?? 2);
if (![100000, 500000, 1000000].includes(scale) || !['baseline', 'quality'].includes(phase) || !/^[a-z][a-z0-9_]{0,20}$/.test(suffix) || levels.some(n => !Number.isInteger(n) || n < 1 || n > 16) || !Number.isInteger(repeats) || repeats < 1 || repeats > 32) throw new Error('Invalid owned-fixture options.');
const runtime = path.resolve('work/explore-local-quality-runtime');
const { Pool } = createRequire(path.join(runtime, 'package.json'))('pg');
const database = `explore_load_local_quality_${suffix}_${scale}`;
const qualityBundle = phase === 'quality' ? readQualityMigrationBundle() : null;
const pool = new Pool({ connectionString: `postgresql://explore_local_bench@127.0.0.1:55441/${database}`, max: Math.max(...levels), application_name: 'explore_local_quality_sort_gate' });
const cases = options['generic-typos-only'] === 'true' ? [
  { name: 'Generic typo Nailz city', sort: 'relevance', query: 'Nailz', kind: 'name', category: '' },
  { name: 'Generic typo Naiks Nails city', sort: 'relevance', query: 'Naiks Nails', kind: 'name', category: '' },
] : [
  { name: 'Closest service gel GPS', sort: 'closest', query: 'gel', kind: 'service', category: 'Nails', gps: true },
  { name: 'Closest style GPS', sort: 'closest', query: 'red almond cat eye', kind: 'style', category: 'Nails', gps: true },
  { name: 'Closest broad name GPS', sort: 'closest', query: 'Directory Nails', kind: 'name', category: '', gps: true },
  { name: 'Closest missing name GPS', sort: 'closest', query: 'zzzzunknownsalon', kind: 'name', category: '', gps: true },
  { name: 'Newest service city', sort: 'newest', query: 'dip powder', kind: 'service', category: 'Nails' },
  { name: 'Newest style city', sort: 'newest', query: 'red almond cat eye', kind: 'style', category: 'Nails' },
  { name: 'Newest broad name city', sort: 'newest', query: 'Directory Nails', kind: 'name', category: '' },
  { name: 'Newest missing name city', sort: 'newest', query: 'zzzzunknownsalon', kind: 'name', category: '' },
];
const report = { startedAt: new Date().toISOString(), scale, phase, database, repeats, levels, runs: [], limitations: ['Two repetitions per case by default; this is a targeted regression gate, not a production percentile/capacity guarantee.', 'SQL over localhost only; no HTTP, rendering or selected-card enrichment.', 'Successful-call latency and failures are separate; baseline timeout censored values must not be treated as successful response times.'] };
const output = path.resolve(options.output ?? `work/explore-local-quality-evidence/native-sort-gate-${phase}-${scale}.json`); mkdirSync(path.dirname(output), { recursive: true });
const persist = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const stats = values => { const sorted = [...values].sort((a, b) => a - b); return { count: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1] ?? null, p95: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, max: sorted.at(-1) ?? null }; };
try {
  const setup = await pool.connect();
  try {
    const owner = (await setup.query('SELECT * FROM explore_local_quality_benchmark')).rows[0], directory = (await setup.query('SHOW data_directory')).rows[0].data_directory;
    if (owner.task_root !== path.resolve('.') || owner.scale !== scale || path.resolve(directory).toLowerCase() !== path.join(runtime, 'data').toLowerCase() || Boolean(owner.quality_sha) !== (phase === 'quality')) throw new Error('Owned-fixture/phase verification failed.');
    if (phase === 'quality') report.effectiveIdentity = await verifyEffectiveQuality(setup, owner, qualityBundle.identitySha256);
    report.qualitySha = owner.quality_sha; report.qualityMigration = qualityBundle?.receipt ?? null; await setup.query('CHECKPOINT');
  } finally { setup.release(); }
  for (const concurrency of levels) {
    const results = cases.map(c => ({ name: c.name, first: [], next: [], errors: [], correctnessFailures: [], metadata: [] }));
    let task = 0, inFlight = 0, peakInFlight = 0, firstInFlight = 0, peakFirstInFlight = 0;
    const worker = async () => {
      const db = await pool.connect();
      try {
        await db.query('SET statement_timeout=3000');
        while (task < cases.length * repeats) {
          const sample = task++, index = sample % cases.length, c = cases[index], entry = results[index];
          let cursor = null, lastDistance = -Infinity; const seen = new Set();
          for (let page = 1; page <= 2; page++) {
            const began = performance.now();
            inFlight++; peakInFlight = Math.max(peakInFlight, inFlight);
            if (page === 1) { firstInFlight++; peakFirstInFlight = Math.max(peakFirstInFlight, firstInFlight); }
            try {
              const response = (await db.query(`SELECT search_public_explore_session(p_query=>$1,p_category=>$2,p_location=>$3,p_latitude=>$4,p_longitude=>$5,p_sort=>$6,p_limit=>12,p_cursor=>$7::jsonb,p_scope_policy=>'fixed',p_content_query=>$1,p_query_kind=>$8,p_location_priority=>true) page`, [c.query, c.category, c.gps ? '' : 'Milwaukee, WI', c.gps ? 43.0389 : null, c.gps ? -87.9065 : null, c.sort, cursor, c.kind])).rows[0].page;
              (page === 1 ? entry.first : entry.next).push(performance.now() - began);
              if (response.searchVersion !== 3 || response.rows.length > 12 || response.appliedSort !== c.sort) entry.correctnessFailures.push({ sample, page, reason: 'version/bound/applied sort' });
              for (const row of response.rows) {
                if (seen.has(row.salon_id)) entry.correctnessFailures.push({ sample, page, reason: 'duplicate ID' }); seen.add(row.salon_id);
                if (row.is_primary_match && !c.gps && row.city !== 'Milwaukee') entry.correctnessFailures.push({ sample, page, reason: 'primary outside fixed city' });
                if (c.gps && row.is_primary_match) {
                  const distance = Number(row.distance_miles);
                  if (row.distance_miles == null || distance + 1e-9 < lastDistance || distance > 50) entry.correctnessFailures.push({ sample, page, reason: 'Closest primary distance order/scope' });
                  lastDistance = distance;
                }
              }
              if (entry.metadata.length < 4) entry.metadata.push({ sample, page, rows: response.rows.length, primary: response.primaryCount, appliedSort: response.appliedSort, rankingBasis: response.rankingBasis });
              cursor = response.nextCursor; if (!response.hasMore || !cursor) break;
            } catch (error) { entry.errors.push({ sample, page, code: error.code, message: error.message, durationMs: performance.now() - began }); break; }
            finally { inFlight--; if (page === 1) firstInFlight--; }
          }
        }
      } finally { db.release(); }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    const run = { concurrency, sessions: cases.length * repeats, peakInFlightSqlCalls: peakInFlight, peakFirstPageSqlCalls: peakFirstInFlight, cases: results.map(c => ({ ...c, first: stats(c.first), next: stats(c.next) })) };
    run.errors = run.cases.reduce((n, c) => n + c.errors.length, 0); run.correctnessFailures = run.cases.reduce((n, c) => n + c.correctnessFailures.length, 0);
    report.runs.push(run); persist(); console.log(JSON.stringify({ phase, scale, concurrency, errors: run.errors, correctnessFailures: run.correctnessFailures }));
  }
  report.completedAt = new Date().toISOString(); report.passed = report.runs.every(run => run.errors === 0 && run.correctnessFailures === 0); persist();
  if (phase === 'quality' && !report.passed) process.exitCode = 1;
} catch (error) { report.fatal = { message: error.message, code: error.code }; persist(); process.exitCode = 1; }
finally { await pool.end(); }
