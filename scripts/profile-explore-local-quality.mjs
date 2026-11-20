// Single-request nested native EXPLAIN evidence, only on this task's owned synthetic server.
import { createRequire } from 'node:module';
import { statSync, openSync, readSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const options = Object.fromEntries(process.argv.slice(2).map(value => { const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=')]; }));
const runtime = path.resolve('work/explore-local-quality-runtime');
const phase = options.phase ?? 'baseline', scale = Number(options.scale ?? 100000);
const fixtureSuffix = options['fixture-suffix'] ?? 'bulkorganic';
const thresholdMs = Number(options['threshold-ms'] ?? 20);
const timeoutMs = Number(options['timeout-ms'] ?? 30000);
if (!Number.isInteger(thresholdMs) || thresholdMs < 0 || thresholdMs > 1000) throw new Error('Invalid bounded plan threshold.');
if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('Invalid bounded profiling deadline.');
if (!/^[a-z][a-z0-9_]{0,20}$/.test(fixtureSuffix)) throw new Error('Invalid owned fixture suffix.');
if (!['baseline', 'quality'].includes(phase) || ![100000, 500000, 1000000].includes(scale)) throw new Error('Invalid owned fixture selection.');
const { Client } = createRequire(path.join(runtime, 'package.json'))('pg');
const db = new Client({ connectionString: `postgresql://explore_local_bench@127.0.0.1:55441/explore_load_local_quality_${fixtureSuffix}_${scale}`, application_name: 'explore_local_quality_profile' });
const log = path.join(runtime, 'server-error.log');
const report = { startedAt: new Date().toISOString(), phase, scale, thresholdMs, mode: 'single-request native nested auto_explain ANALYZE BUFFERS', results: [], limitations: [`Threshold ${thresholdMs}ms excludes cheaper nested statements. Use threshold0 on a selected after case for complete fast-path plan capture.`, 'Profiling adds overhead; these are plan-shape/scan evidence, not benchmark latency.', 'Fixture minimal canonical helpers exclude selected-card HTTP enrichment.'] };
const out = path.resolve(options.output ?? `work/explore-local-quality-evidence/plans-${phase}-${scale}.json`); mkdirSync(path.dirname(out), { recursive: true });
try {
  await db.connect();
  const owner = (await db.query('SELECT * FROM explore_local_quality_benchmark')).rows[0];
  const directory = (await db.query('SHOW data_directory')).rows[0].data_directory;
  if (owner.task_root !== path.resolve('.') || path.resolve(directory).toLowerCase() !== path.join(runtime, 'data').toLowerCase() || Boolean(owner.quality_sha) !== (phase === 'quality')) throw new Error('Owned fixture/phase verification failed.');
  report.fixture = { database: `explore_load_local_quality_${fixtureSuffix}_${scale}`, scale: owner.scale, originalSetupIdentity: owner.quality_setup_sha ?? owner.quality_sha, qualitySha: owner.quality_sha, effectiveIdentity: owner.quality_effective_sha ?? owner.quality_sha, compatibilityProofFile: owner.quality_overlay_proof };
  report.timeoutMs = timeoutMs;
  await db.query(`LOAD 'auto_explain'; SET auto_explain.log_min_duration=${thresholdMs}; SET auto_explain.log_nested_statements=on; SET auto_explain.log_analyze=on; SET auto_explain.log_buffers=on; SET auto_explain.log_format=json; SET auto_explain.log_timing=off; SET statement_timeout=${timeoutMs};`);
  const offset = statSync(log).size;
  const profileCases = [
    { name: 'broad city', query: '', kind: 'service', category: 'Nails', location: 'Milwaukee, WI' },
    { name: 'one letter name prefix', query: 'd', kind: 'name', category: '', location: 'Milwaukee, WI' },
    { name: 'exact name city', query: 'King Nails', kind: 'name', category: '', location: 'Milwaukee, WI' },
    { name: 'fuzzy name city', query: 'Kign Nails', kind: 'name', category: '', location: 'Milwaukee, WI' },
    { name: 'missing name city', query: 'zzzzunknownsalon', kind: 'name', category: '', location: 'Milwaukee, WI' },
    { name: 'generic word typo Nailz', query: 'Nailz', kind: 'name', category: '', location: 'Milwaukee, WI' },
    { name: 'generic word typo Naiks Nails', query: 'Naiks Nails', kind: 'name', category: '', location: 'Milwaukee, WI' },
    { name: 'GPS dense', query: '', kind: 'service', category: 'Nails', latitude: 43.0389, longitude: -87.9065 },
    { name: 'GPS missing word', query: 'zzzzunknownsalon', kind: 'name', category: '', latitude: 43.0389, longitude: -87.9065 },
    { name: 'GPS dense explicit Closest', query: '', kind: 'service', category: 'Nails', latitude: 43.0389, longitude: -87.9065, sort: 'closest' },
    { name: 'broad city explicit newest', query: '', kind: 'service', category: 'Nails', location: 'Milwaukee, WI', sort: 'newest' },
  ].filter(c => !options.only || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') === options.only);
  if (!profileCases.length) throw new Error('No bounded profile case selected.');
  for (const c of profileCases) {
    try {
      const start = performance.now();
      const result = (await db.query(`SELECT search_public_explore_session(p_query=>$1,p_category=>$2,p_location=>$3,p_latitude=>$4,p_longitude=>$5,p_sort=>$7,p_limit=>12,p_scope_policy=>'fixed',p_content_query=>$1,p_query_kind=>$6,p_location_priority=>true) page`, [c.query, c.category, c.location ?? '', c.latitude ?? null, c.longitude ?? null, c.kind, c.sort ?? 'relevance'])).rows[0].page;
      report.results.push({ name: c.name, durationMs: performance.now() - start, primary: result.primaryCount, reference: result.referenceCount, appliedSort: result.appliedSort, rankingBasis: result.rankingBasis });
    } catch (error) { report.results.push({ name: c.name, code: error.code, message: error.message }); }
  }
  await db.end();
  const length = statSync(log).size - offset, data = Buffer.alloc(length), fd = openSync(log, 'r');
  try { readSync(fd, data, 0, length, offset); } finally { closeSync(fd); }
  const raw = data.toString('utf8');
  writeFileSync(out.replace(/\.json$/, '.log'), raw);
  const records = raw.split(/(?=^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/m);
  report.plans = [];
  for (const record of records) {
    const start = record.indexOf('{');
    if (start === -1 || !record.includes('plan:')) continue;
    let depth = 0, quoted = false, escaped = false, end = -1;
    for (let index = start; index < record.length; index++) {
      const char = record[index];
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
      else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) { end = index + 1; break; }
    }
    try { if (end !== -1) report.plans.push(JSON.parse(record.slice(start, end))); } catch { /* Raw log is retained for incomplete or nonplan records. */ }
  }
  report.planSummaries = report.plans.map(plan => {
    let visits = 0, filtered = 0, scans = [], sorts = [];
    const walk = node => {
      visits += (node['Actual Rows'] ?? 0) * (node['Actual Loops'] ?? 0);
      filtered += ((node['Rows Removed by Filter'] ?? 0) + (node['Rows Removed by Join Filter'] ?? 0)) * (node['Actual Loops'] ?? 0);
      if (/Scan/.test(node['Node Type'] ?? '')) scans.push({ type: node['Node Type'], relation: node['Relation Name'], index: node['Index Name'], rows: node['Actual Rows'], loops: node['Actual Loops'], filterRemoved: node['Rows Removed by Filter'], indexCondition: node['Index Cond'] });
      if (/Sort/.test(node['Node Type'] ?? '')) sorts.push({ type: node['Node Type'], rows: node['Actual Rows'], method: node['Sort Method'], spaceKb: node['Sort Space Used'], spaceType: node['Sort Space Type'] });
      for (const child of node.Plans ?? []) walk(child);
    };
    walk(plan.Plan);
    return { query: (plan['Query Text'] ?? '').slice(0, 200), planNodeRowVisits: visits, planNodeFilteredVisits: filtered, sharedHitBlocks: plan.Plan['Shared Hit Blocks'], sharedReadBlocks: plan.Plan['Shared Read Blocks'], tempReadBlocks: plan.Plan['Temp Read Blocks'], tempWrittenBlocks: plan.Plan['Temp Written Blocks'], scans, sorts };
  });
  report.completedAt = new Date().toISOString(); writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ file: out, results: report.results, plans: report.plans.length, summaries: [...report.planSummaries].sort((a,b) => b.planNodeRowVisits-a.planNodeRowVisits).slice(0,12).map(p => ({ query: p.query, visits: p.planNodeRowVisits, filtered: p.planNodeFilteredVisits, tempRead: p.tempReadBlocks, sorts: p.sorts })) }));
} catch (error) { report.fatal = { message: error.message, code: error.code }; writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); await db.end().catch(() => {}); throw error; }
