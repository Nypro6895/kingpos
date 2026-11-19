// Native SQL adapter for the same bounded foreground preparation protocol.
import { performance } from 'node:perf_hooks';
import { runPreparation, PREPARATION_RPCS } from '../../scripts/backfill-explore-local-quality.mjs';
import { fixtureId } from './explore-local-quality-native-bootstrap.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const stats = values => { const sorted = [...values].sort((a, b) => a - b); return { count: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1] ?? null, p95: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, max: sorted.at(-1) ?? null }; };

export async function prepareNativeQuality(db, { bundle, scale, controlDb, limit = 100, onProgress = () => {}, existingSchemaProof } = {}) {
  bundle.verifyArchivedBytes();
  const receipt = { identity: bundle.receipt, startedAt: new Date().toISOString(), migrations: [], calls: [], controls: [],
    settings: { limit, nativePauseMs: 0, operatorDefaultPauseMs: 100, rpcStatementTimeoutMs: 3000, maxBatches: Math.ceil(scale / limit) + 1000 },
    limitations: ['Native adapter deliberately omits operator pauses to measure raw bounded backfill work and writer interference. The foreground CLI defaults to 100ms between batches, so its operational wall time is longer.', 'Controls acquire RowExclusive locks on BOTH canonical history tables and the canonical revision row NOWAIT, then roll back. They prove sampled lock availability, not complete source writes or import throughput.', 'A matched real source UPDATE timed out at2s on both the corrected baseline and idle prototype in old refresh_explore_unified_search; see canonical-writer-baseline-control.json. That known fixture limitation is separate from this lock gate.', 'Lock controls and all preparation calls finish before steady-query latency measurements.', 'PostgreSQL DDL still takes short schema locks; bounded preparation does not imply zero-lock deployment.'] };
  if (existingSchemaProof) {
    if (existingSchemaProof.candidateIdentity !== bundle.identitySha256 || !existingSchemaProof.catalogSha256 || !existingSchemaProof.projectionUnchanged) throw new Error('Resume requires a matching explicit compatible-schema proof.');
    receipt.mode = 'resume_verified_compatible_schema'; receipt.existingSchemaProof = existingSchemaProof;
  } else receipt.mode = 'fresh_exact_migration_pair';
  let active = 'migration', batchActive = false, stopControl = false;
  const controlId = fixtureId(scale);
  const dbOriginalTimeout = (await db.query('SHOW statement_timeout')).rows[0].statement_timeout;
  let controlOriginalSettings;
  const fingerprint = async () => (await controlDb.query('SELECT explore_unified_salon_fingerprint(d) AS fingerprint FROM explore_salon_documents d WHERE salon_id=$1', [controlId])).rows[0]?.fingerprint;
  if (controlDb) {
    controlOriginalSettings = (await controlDb.query("SELECT current_setting('statement_timeout') AS statement_timeout,current_setting('lock_timeout') AS lock_timeout")).rows[0];
    await controlDb.query("SET statement_timeout=2000;SET lock_timeout='500ms'");
    receipt.controlSourceBefore = await fingerprint();
  }
  const control = controlDb ? (async () => {
    while (!stopControl) {
      const sample = { phase: active, startedAt: new Date().toISOString(), startedDuringBatch: batchActive };
      let began = performance.now();
      try {
        await controlDb.query('BEGIN');
        await controlDb.query('LOCK TABLE public.explore_unified_salon_history,public.explore_unified_content_history IN ROW EXCLUSIVE MODE NOWAIT');
        sample.tableWriterLock = { passed: true, durationMs: performance.now() - began };
      } catch (error) { sample.tableWriterLock = { passed: false, durationMs: performance.now() - began, code: error.code, message: error.message }; }
      finally { await controlDb.query('ROLLBACK'); }
      began = performance.now();
      try {
        await controlDb.query('BEGIN');
        const result = await controlDb.query('SELECT revision FROM public.explore_unified_search_clock WHERE id FOR UPDATE NOWAIT');
        if (result.rowCount !== 1) throw new Error('Canonical clock control target is absent.');
        sample.canonicalClockLock = { passed: true, durationMs: performance.now() - began };
      } catch (error) { sample.canonicalClockLock = { passed: false, durationMs: performance.now() - began, code: error.code, message: error.message }; }
      finally { await controlDb.query('ROLLBACK'); }
      receipt.controls.push(sample);
      if (!stopControl) await delay(1000);
    }
  })() : null;
  const beganAll = performance.now();
  try {
    for (const entry of existingSchemaProof ? [] : bundle.entries) {
      const began = performance.now();
      await db.query(entry.sql);
      receipt.migrations.push({ file: entry.file, sha256: entry.sha256, durationMs: performance.now() - began });
      onProgress({ event: 'migration', ...receipt.migrations.at(-1) });
    }
    await db.query('SET statement_timeout=3000');
    active = 'backfill';
    const beganPreparation = performance.now();
    const result = await runPreparation({ options: { apply: true, activate: true, limit, maxBatches: receipt.settings.maxBatches, pauseMs: 100 },
      wait: async ms => { receipt.omittedOperatorPauseMs = (receipt.omittedOperatorPauseMs ?? 0) + ms; },
      rpc: async (name, args) => {
        if (!Object.values(PREPARATION_RPCS).includes(name)) throw new Error('Unexpected native preparation RPC.');
        if (name === PREPARATION_RPCS.activate) active = 'activation';
        if (name === PREPARATION_RPCS.batch) active = 'backfill';
        batchActive = name === PREPARATION_RPCS.batch;
        const began = performance.now();
        try {
          const response = await db.query(`SELECT public.${name}(${name === PREPARATION_RPCS.batch ? '$1::integer' : ''}) AS state`, name === PREPARATION_RPCS.batch ? [args.p_limit] : []);
          const call = { rpc: name, durationMs: performance.now() - began, state: response.rows[0].state };
          receipt.calls.push(call); return call.state;
        } catch (error) {
          receipt.calls.push({ rpc: name, durationMs: performance.now() - began, error: { code: error.code, message: error.message } }); throw error;
        } finally { batchActive = false; }
      },
      onProgress: progress => onProgress(progress),
    });
    receipt.preparationDurationMs = performance.now() - beganPreparation;
    receipt.result = result;
    if (!result.state.ready || !result.state.done || result.state.pending || result.stopped) throw new Error('Quality preparation did not reach active, fully reconciled readiness.');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    receipt.error = { message: error.message, code: error.code }; error.preparationReceipt = receipt; throw error;
  } finally {
    stopControl = true; await control;
    if (controlDb) {
      receipt.controlSourceAfter = await fingerprint();
      receipt.controlSourceUnchanged = receipt.controlSourceBefore === receipt.controlSourceAfter;
      if (!receipt.controlSourceUnchanged) throw new Error('Rollback-only writer control changed the canonical source fingerprint.');
      await controlDb.query("SELECT set_config('statement_timeout',$1,false),set_config('lock_timeout',$2,false)", [controlOriginalSettings.statement_timeout, controlOriginalSettings.lock_timeout]);
    }
    await db.query("SELECT set_config('statement_timeout',$1,false)", [dbOriginalTimeout]);
    receipt.totalDurationMs = performance.now() - beganAll;
    receipt.completedAt = new Date().toISOString();
    receipt.batchCount = receipt.calls.filter(call => call.rpc === PREPARATION_RPCS.batch).length;
    receipt.batchSqlDurationMs = receipt.calls.filter(call => call.rpc === PREPARATION_RPCS.batch).reduce((sum, call) => sum + call.durationMs, 0);
    receipt.busyBatchCount = receipt.calls.filter(call => call.rpc === PREPARATION_RPCS.batch && call.state?.busy).length;
    receipt.batchMs = stats(receipt.calls.filter(call => call.rpc === PREPARATION_RPCS.batch).map(call => call.durationMs));
    const backfillControls = receipt.controls.filter(sample => sample.phase === 'backfill');
    receipt.writerControlSummary = { samples: receipt.controls.length, backfillSamples: backfillControls.length,
      backfillStartedDuringBatch: backfillControls.filter(sample => sample.startedDuringBatch).length,
      failures: receipt.controls.filter(sample => !sample.tableWriterLock.passed || !sample.canonicalClockLock.passed).length,
      migrationFailures: receipt.controls.filter(sample => sample.phase === 'migration' && (!sample.tableWriterLock.passed || !sample.canonicalClockLock.passed)).length,
      backfillFailures: backfillControls.filter(sample => !sample.tableWriterLock.passed || !sample.canonicalClockLock.passed).length,
      canonicalClockLockMs: stats(receipt.controls.map(sample => sample.canonicalClockLock.durationMs)),
      backfillCanonicalClockLockMs: stats(backfillControls.map(sample => sample.canonicalClockLock.durationMs)) };
  }
  return receipt;
}
