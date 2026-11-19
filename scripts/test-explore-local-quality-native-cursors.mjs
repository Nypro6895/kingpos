// Bounded deep-cursor correctness gate on the already-owned million-salon fixture.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readQualityMigrationBundle } from '../tests/fixtures/explore-local-quality-migration-manifest.mjs';
import { verifyEffectiveQuality } from '../tests/fixtures/explore-local-quality-effective-identity.mjs';
const runtime = path.resolve('work/explore-local-quality-runtime');
const { Client } = createRequire(path.join(runtime, 'package.json'))('pg');
const db = new Client({ connectionString: 'postgresql://explore_local_bench@127.0.0.1:55441/explore_load_local_quality_bulkorganic_1000000', application_name: 'explore_local_quality_deep_cursor' });
const qualityBundle = readQualityMigrationBundle(), migrationSha = qualityBundle.identitySha256;
const report = { startedAt: new Date().toISOString(), engine: 'owned native PostgreSQL17, one million synthetic salons', migrationSha, qualityMigration: qualityBundle.receipt, pages: [], limitations: ['One anonymous fixed-city browse session, one SQL worker; not a throughput or universal deep-scroll guarantee.', 'No canonical source writes; returned IDs, frozen private order keys and page boundaries are checked.'] };
const output = path.resolve('work/explore-local-quality-evidence/native-deep-cursor.json'); mkdirSync(path.dirname(output), { recursive: true });
try {
  await db.connect();
  const owner = (await db.query('SELECT * FROM explore_local_quality_benchmark')).rows[0];
  const data = (await db.query('SHOW data_directory')).rows[0].data_directory;
  assert.equal(owner.task_root, path.resolve('.'));
  assert.equal(path.resolve(data).toLowerCase(), path.join(runtime, 'data').toLowerCase());
  report.effectiveIdentity = await verifyEffectiveQuality(db, owner, migrationSha);
  await db.query('SET statement_timeout=3000');
  const seen = new Set(); let cursor = null, last = null;
  const compare = (a, b) => { for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) { if (a.key[i] < b.key[i]) return -1; if (a.key[i] > b.key[i]) return 1; } return a.id.localeCompare(b.id); };
  for (let page = 1; page <= 50; page++) {
    const began = performance.now();
    const result = (await db.query(`SELECT search_public_explore_session(p_query=>'',p_category=>'Nails',p_location=>'Milwaukee, WI',p_sort=>'relevance',p_limit=>12,p_cursor=>$1::jsonb,p_scope_policy=>'fixed',p_content_query=>'',p_query_kind=>'service',p_location_priority=>true) page`, [cursor])).rows[0].page;
    const durationMs = performance.now() - began;
    assert.equal(result.rows.length, 12); assert.equal(result.hasMore, true);
    const ids = result.rows.map(row => row.salon_id);
    for (const row of result.rows) { assert.equal(row.is_primary_match, true); assert.equal(row.city, 'Milwaukee'); assert(!seen.has(row.salon_id), `duplicate ${row.salon_id}`); seen.add(row.salon_id); }
    const keys = (await db.query("SELECT salon_id,unified_payload->'orderKey' AS key,ordinal FROM explore_search_session_candidates WHERE session_id=$1 AND salon_id=ANY($2::uuid[]) ORDER BY ordinal", [result.sessionCursor.session, ids])).rows;
    assert.equal(keys.length, 12); assert.deepEqual(keys.map(row => row.salon_id), ids);
    for (const row of keys) { assert(Array.isArray(row.key)); const current = { key: row.key.map(Number), id: row.salon_id }; if (last) assert(compare(last, current) < 0, 'frozen rank/UUID order moved backward'); last = current; }
    assert(Number(result.nextCursor.after) > Number(cursor?.after ?? 0));
    cursor = result.nextCursor; report.pages.push({ page, durationMs, after: cursor.after, totalLoaded: result.totalCount });
  }
  report.uniqueRows = seen.size; assert.equal(report.uniqueRows, 600);
  report.passed = true; report.completedAt = new Date().toISOString();
} catch (error) { report.passed = false; report.error = { message: error.message, code: error.code }; process.exitCode = 1; }
finally { await db.end().catch(() => {}); writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ passed: report.passed, pages: report.pages.length, uniqueRows: report.uniqueRows, error: report.error, output }));
