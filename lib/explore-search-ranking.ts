import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getLumiTrustEvidenceBySalonId } from "@/lib/lumi-trust-data";
import { LUMI_TRUST_RULES, reylumiTrustScore } from "@/lib/reylumi-trust";

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type Rpc = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<RpcResult>;
type Job = { salon_id: string; generation: number; fingerprint: string | null; lease: string };
type Decision = { salon_id: string; booking_enabled: boolean; bookable_service_id: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serviceRpc(): Rpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Explore ranking worker is not configured.");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return async (name, args, signal) => {
    if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    const query = client.rpc(name, args);
    const result = await (signal ? query.abortSignal(signal) : query);
    if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    return { data: result.data as unknown, error: result.error };
  };
}

/** Only the private worker materializes canonical aggregates. Searches never call this. */
export async function runExploreSearchRankingWorker(options: {
  rpc?: Rpc; batchSize?: number; maxBatches?: number; signal?: AbortSignal; refreshDue?: boolean;
} = {}) {
  const rpc = options.rpc ?? serviceRpc();
  const signal = options.signal;
  const batchSize = Math.min(100, Math.max(1, Math.floor(options.batchSize ?? 50)));
  const maxBatches = Math.min(10, Math.max(1, Math.floor(options.maxBatches ?? 1)));
  let claimed = 0, published = 0, failed = 0, batches = 0, hasMore = false;
  const call = async (name: string, args: Record<string, unknown>, callSignal = signal) => {
    if (callSignal?.aborted) throw new DOMException("Request aborted", "AbortError");
    const result = await rpc(name, args, callSignal);
    if (result.error) throw Object.assign(new Error("Explore ranking update failed."), { code: result.error.code, phase: name });
    return result.data;
  };
  if (options.refreshDue !== false) await call("refresh_explore_search_rank_due", { p_limit: 1000 });
  for (let index = 0; index < maxBatches; index++) {
    const data = await call("claim_explore_search_rank_jobs", { p_limit: batchSize });
    if (!Array.isArray(data) || data.length === 0) break;
    if (data.length > batchSize) throw new Error("Invalid ranking work batch.");
    const jobs = data as Job[];
    if (jobs.some(job => !UUID.test(job.salon_id) || !UUID.test(job.lease) || !Number.isSafeInteger(Number(job.generation)) || Number(job.generation) < 1 || (job.fingerprint !== null && typeof job.fingerprint !== "string"))) throw new Error("Invalid ranking work batch.");
    claimed += jobs.length; batches++;
    try {
      const ids = jobs.filter(job => job.fingerprint !== null).map(job => job.salon_id);
      // Serialize the selected reads to limit simultaneous database backends.
      const evidence = ids.length ? await getLumiTrustEvidenceBySalonId(async (name, args) => ({ data: await call(name, args), error: null }), ids) : new Map();
      const decisionRows = ids.length ? await call("get_public_explore_decision_signals", { target_salon_ids: ids }) : [];
      const policyRows = ids.length ? await call("get_explore_rank_refresh_policy", { p_ids: ids }) : [];
      const noDecay = new Set(Array.isArray(policyRows) ? policyRows.filter(row => row && typeof row === "object" && row.may_skip_decay === true && ids.includes(row.salon_id)).map(row => row.salon_id) : []);
      const decisions = new Map<string, Decision>();
      if (Array.isArray(decisionRows)) for (const raw of decisionRows) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Decision;
        if (ids.includes(row.salon_id) && typeof row.booking_enabled === "boolean" && (!row.booking_enabled || (typeof row.bookable_service_id === "string" && UUID.test(row.bookable_service_id)))) decisions.set(row.salon_id, row);
      }
      const invalid: Job[] = [];
      const rows = jobs.flatMap(job => {
        if (job.fingerprint === null) return [{ ...job }]; // A real tombstone, not an invented empty Trust score.
        const proof = evidence.get(job.salon_id), decision = decisions.get(job.salon_id);
        if (!proof || !decision) { invalid.push(job); return []; }
        return [{ ...job, rule_version: LUMI_TRUST_RULES.version, evidence_as_of: proof.asOf,
          trust_score: reylumiTrustScore({ averageRating: null, trustEvidence: proof }),
          empty_evidence: noDecay.has(job.salon_id) && [proof.verifiedVisitCount, proof.uniqueVisitorCount, proof.feedbackCustomerCount, proof.goodFeedbackCount, proof.issueFeedbackCount, proof.eligibleReturnCustomerCount, proof.returningCustomerCount].every(value => value === 0),
          bookable: decision.booking_enabled, bookable_service_id: decision.booking_enabled ? decision.bookable_service_id : null }];
      });
      const result = rows.length ? await call("publish_explore_search_rank_jobs", { p_rows: rows }) : null;
      if (result && typeof result === "object") {
        const value = result as { published?: unknown; hasMore?: unknown };
        published += typeof value.published === "number" ? value.published : 0;
        hasMore = value.hasMore === true;
      }
      if (invalid.length) { await call("fail_explore_search_rank_jobs", { p_jobs: invalid }); failed += invalid.length; hasMore ||= jobs.length === batchSize; }
      if (!hasMore) break;
    } catch (cause) {
      // Cleanup gets its own short deadline so a cancelled job does not hold leases for five minutes.
      try { await call("fail_explore_search_rank_jobs", { p_jobs: jobs }, AbortSignal.timeout(5000)); } catch { /* Lease expiry remains the bounded recovery mechanism. */ }
      if (cause && typeof cause === "object") Object.assign(cause, { progress: { claimed, published, failed, batches } });
      throw cause;
    }
  }
  return { claimed, published, failed, batches, hasMore };
}


type RankingProgress = { claimed: number; published: number; failed: number; batches: number };
type RankingRetry = { attempt: number; code: string; phase: string; batchSize: number; nextBatchSize: number; progress: RankingProgress };

/** Operator-only retry: finite attempts, smaller transactions, same canonical worker. */
export async function runExploreSearchRankingWithRetry(options: {
  worker?: typeof runExploreSearchRankingWorker; batchSize?: number; maxBatches?: number;
  signal?: AbortSignal; refreshDue?: boolean; onRetry?: (retry: RankingRetry) => void;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
} = {}) {
  const worker = options.worker ?? runExploreSearchRankingWorker;
  let batchSize = Math.min(100, Math.max(1, Math.floor(options.batchSize ?? 50)));
  const totals: RankingProgress = { claimed: 0, published: 0, failed: 0, batches: 0 };
  const wait = options.wait ?? waitForExploreSearchRankingPause;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (options.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    try {
      const result = await worker({ batchSize, maxBatches: options.maxBatches ?? 10, signal: options.signal, refreshDue: attempt === 1 && options.refreshDue !== false });
      return { ...result, claimed: totals.claimed + result.claimed, published: totals.published + result.published,
        failed: totals.failed + result.failed, batches: totals.batches + result.batches, retryCount: attempt - 1, batchSize };
    } catch (cause) {
      const failure = cause as { code?: string; phase?: string; progress?: Partial<RankingProgress> };
      if (options.signal?.aborted || !["57014", "55P03"].includes(failure?.code ?? "") || attempt === 3) throw cause;
      const progress: RankingProgress = { claimed: 0, published: 0, failed: 0, batches: 0 };
      for (const key of ["claimed", "published", "failed", "batches"] as const) {
        const value = failure.progress?.[key];
        if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) { progress[key] = value; totals[key] += value; }
      }
      const nextBatchSize = Math.max(1, Math.floor(batchSize / 2));
      options.onRetry?.({ attempt, code: failure.code!, phase: /^[a-z_]{1,80}$/.test(failure.phase ?? "") ? failure.phase! : "worker", batchSize, nextBatchSize, progress });
      await wait(attempt * 1000, options.signal);
      batchSize = nextBatchSize;
    }
  }
  throw new Error("Ranking retry could not finish.");
}


/** Finite, cancellable pacing for operator runs and retry backoff. */
export function waitForExploreSearchRankingPause(milliseconds: number, signal?: AbortSignal) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 10000) throw new Error("Invalid ranking pause.");
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Request aborted", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Request aborted", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
