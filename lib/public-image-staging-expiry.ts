import "server-only";
import { publicImageServiceClient } from "./public-image-safety";
import { PUBLIC_IMAGE_QUARANTINE_BUCKET } from "./public-image-staging";

type Client = ReturnType<typeof publicImageServiceClient>;
type ExpiredStaging = {
  bucket: string;
  object_path: string;
  quarantine_path: string;
  uploaded_by_user_id: string;
  salon_id: string | null;
  purpose: string;
  status: string;
  created_at: string;
  private_removed_at: null;
  cleanup_claimed_until: string;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID}$`);
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function isExpiredStaging(value: unknown, now: number): value is ExpiredStaging {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.bucket !== "string" ||
    typeof item.object_path !== "string" ||
    typeof item.quarantine_path !== "string" ||
    typeof item.uploaded_by_user_id !== "string" || !UUID_PATTERN.test(item.uploaded_by_user_id) ||
    typeof item.created_at !== "string" || !Number.isFinite(Date.parse(item.created_at)) ||
    Date.parse(item.created_at) > now - RETENTION_MS ||
    item.private_removed_at !== null ||
    typeof item.cleanup_claimed_until !== "string" || !Number.isFinite(Date.parse(item.cleanup_claimed_until)) ||
    Date.parse(item.cleanup_claimed_until) <= now ||
    typeof item.status !== "string" || !["cancelled", "rejected", "approved"].includes(item.status) ||
    item.quarantine_path !== `${item.bucket}/${item.object_path}`
  ) return false;

  // Match the reservation's complete path and actor/salon scope, not a prefix
  // supplied by the queue. Identity assets and legacy public media cannot match.
  if (item.bucket === "beauty-profile-media") {
    if (item.salon_id !== null || typeof item.purpose !== "string" || !["image", "before", "after"].includes(item.purpose)) return false;
    return new RegExp(`^${item.uploaded_by_user_id}/beauty/${item.purpose}/${UUID}[.]webp$`).test(item.object_path);
  }
  if (item.bucket !== "salon-profile-media" || typeof item.salon_id !== "string" || !UUID_PATTERN.test(item.salon_id)) return false;
  if (item.purpose === "look") return new RegExp(`^${item.salon_id}/looks/${UUID}/${UUID}[.]webp$`).test(item.object_path);
  if (item.purpose === "update") return new RegExp(`^${item.salon_id}/updates/${UUID}[.]webp$`).test(item.object_path);
  return false;
}

export async function processExpiredPublicImageStaging(
  client: Client,
  job: unknown,
  deadline: number,
) {
  const now = Date.now();
  // The SQL claim cancels old staged uploads before any Storage deletion. A
  // still-staged row is never deleted, even if malformed queue data returns it.
  if (!Number.isFinite(deadline) || now >= deadline || !isExpiredStaging(job, now)) return false;
  try {
    // Always remove the private source, including an approved image's redundant
    // copy. Never use the manifest's public bucket as the deletion destination.
    const { error } = await client.storage.from(PUBLIC_IMAGE_QUARANTINE_BUCKET).remove([job.quarantine_path]);
    if (error) return false;
    const result = await client.rpc("finish_public_image_staging_expiry", {
      p_bucket: job.bucket,
      p_path: job.object_path,
    });
    // SQL verifies that the Storage row is absent. Failed or uncertain removal
    // stays uncheckpointed and is reclaimable after the short database lease.
    return !result.error && result.data === true;
  } catch {
    return false;
  }
}

export async function runPublicImageStagingExpiry(client: Client = publicImageServiceClient()) {
  // Leave room for the existing account-erasure budget on the shared route.
  const deadline = Date.now() + 10000;
  const result = await client.rpc("claim_expired_public_image_staging", { p_limit: 10 });
  if (result.error || !Array.isArray(result.data) || result.data.length > 10) {
    throw new Error("Private photo expiry queue could not be read.");
  }
  let removed = 0;
  let failed = 0;
  for (const job of result.data) {
    if (await processExpiredPublicImageStaging(client, job, deadline)) removed++;
    else failed++;
  }
  // Only counts leave the worker; paths, identities and image data stay private.
  return { removed, failed };
}
