import "server-only";
import { publicImageServiceClient } from "./public-image-safety";

type Client = ReturnType<typeof publicImageServiceClient>;
type DeletionJob = {
  id: string;
  bucket: "beauty-profile-media" | "salon-profile-media";
  object_path: string;
  uploaded_by_user_id: string;
  object_id: string;
  object_version: string;
  object_etag: string;
  sha256: string;
  bytes: number;
  lease_token: string;
  leased_until: string;
};

export type PublicPostMediaDeletionCounts = {
  claimed: number;
  removed: number;
  /** Every claimed job that has not been confirmed complete, including deferred jobs. */
  failed: number;
  deferred: number;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID}$`);
const SALON_PATH = new RegExp(`^${UUID}/(?:looks/${UUID}/${UUID}|updates/${UUID})[.]webp$`);
// The shared service client caps each fetch at 12 seconds. Do not start a
// request that could outlive the lease; the SQL finish also checks the lease.
const REQUEST_BUDGET_MS = 12000;
const NEW_WORK_BUDGET_MS = 10000;
const MAX_BATCH = 5;

function isPinnedDeletionJob(value: unknown, now: number): value is DeletionJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Record<string, unknown>;
  for (const key of ["id", "uploaded_by_user_id", "object_id", "lease_token"]) {
    if (typeof job[key] !== "string" || !UUID_PATTERN.test(job[key])) return false;
  }
  for (const key of ["object_version", "object_etag"]) {
    if (typeof job[key] !== "string" || !job[key].trim() || job[key].length > 1024 || /[\u0000-\u001f\u007f]/.test(job[key])) return false;
  }
  if (typeof job.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(job.sha256) ||
    typeof job.bytes !== "number" || !Number.isSafeInteger(job.bytes) || job.bytes < 1 || job.bytes > 512000 ||
    typeof job.leased_until !== "string" || !Number.isFinite(Date.parse(job.leased_until)) || Date.parse(job.leased_until) <= now ||
    typeof job.object_path !== "string") return false;
  // The table-returning RPC includes processing status. Keep minimal typed
  // clients compatible, but never accept an explicit legacy/hold/other state.
  if ("status" in job && job.status !== "processing") return false;
  if (job.bucket === "beauty-profile-media") {
    return new RegExp(`^${job.uploaded_by_user_id}/beauty/(?:image|before|after)/${UUID}[.]webp$`).test(job.object_path);
  }
  return job.bucket === "salon-profile-media" && SALON_PATH.test(job.object_path);
}

function canStartRequest(job: DeletionJob, deadline: number) {
  const now = Date.now();
  return now < deadline && Date.parse(job.leased_until) - now > REQUEST_BUDGET_MS;
}

async function releaseFailedRemoval(client: Client, job: DeletionJob, deadline: number) {
  if (!canStartRequest(job, deadline)) return;
  try {
    await client.rpc("finish_public_post_media_deletion", {
      p_id: job.id, p_lease: job.lease_token, p_error: "storage_remove_failed",
    });
  } catch { /* A failed release remains reclaimable after the database lease. */ }
}

export async function processPublicPostMediaDeletion(
  client: Client,
  job: unknown,
  deadline: number,
): Promise<"removed" | "failed" | "deferred"> {
  if (!Number.isFinite(deadline) || !isPinnedDeletionJob(job, Date.now())) return "failed";
  if (!canStartRequest(job, deadline)) return "deferred";
  try {
    // Claim is the authority for ownership, reference/hold checks, exact live
    // object identity and the permanent no-reattachment/no-recreation fence.
    // Only Storage API removal deletes bytes; never delete storage metadata.
    const result = await client.storage.from(job.bucket).remove([job.object_path]);
    if (result.error) {
      await releaseFailedRemoval(client, job, deadline);
      return "failed";
    }
  } catch {
    await releaseFailedRemoval(client, job, deadline);
    return "failed";
  }

  // Timeout, expiry or a lost response leaves this job uncheckpointed. Retrying
  // an already absent object is safe; only SQL-confirmed absence completes it.
  if (!canStartRequest(job, deadline)) return "deferred";
  try {
    const result = await client.rpc("finish_public_post_media_deletion", {
      p_id: job.id, p_lease: job.lease_token, p_error: null,
    });
    return !result.error && result.data === true ? "removed" : "failed";
  } catch {
    return "failed";
  }
}

export async function runPublicPostMediaDeletions(
  client: Client = publicImageServiceClient(),
): Promise<PublicPostMediaDeletionCounts> {
  const deadline = Date.now() + NEW_WORK_BUDGET_MS;
  let jobs: unknown[];
  try {
    const result = await client.rpc("claim_public_post_media_deletions", { p_limit: MAX_BATCH });
    if (result.error || !Array.isArray(result.data) || result.data.length > MAX_BATCH) throw new Error();
    jobs = result.data;
  } catch {
    throw new Error("Public photo deletion queue could not be read.");
  }
  const counts: PublicPostMediaDeletionCounts = { claimed: jobs.length, removed: 0, failed: 0, deferred: 0 };
  for (const job of jobs) {
    const outcome = await processPublicPostMediaDeletion(client, job, deadline);
    if (outcome === "removed") counts.removed++;
    else {
      counts.failed++;
      if (outcome === "deferred") counts.deferred++;
    }
  }
  // Never expose paths, author IDs, raw Storage/DB errors, or image payloads.
  return counts;
}
