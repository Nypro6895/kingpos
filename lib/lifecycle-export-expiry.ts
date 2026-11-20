import "server-only";
import { createClient } from "@supabase/supabase-js";

type ExpiredExport = {
  id: string;
  lease: string;
  bucket: string;
  path: string;
  requesterId: string | null;
  expiresAt: string;
};

export function lifecycleExportServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Export cleanup is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(5000)])
            : AbortSignal.timeout(5000),
        }),
    },
  });
}

type Client = ReturnType<typeof lifecycleExportServiceClient>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function processExpiredLifecycleExport(
  client: Client,
  job: ExpiredExport,
  deadline: number,
) {
  // Never let malformed queue metadata target another bucket or another export.
  const parts = job.path?.split("/") ?? [];
  if (
    Date.now() >= deadline ||
    job.bucket !== "lifecycle-exports" ||
    !uuid.test(job.id) ||
    !uuid.test(job.lease) ||
    !job.requesterId ||
    parts.length !== 3 ||
    parts[0] !== job.requesterId ||
    parts[1] !== job.id ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(parts[2]) ||
    !Number.isFinite(Date.parse(job.expiresAt)) ||
    Date.parse(job.expiresAt) > Date.now()
  ) {
    return false;
  }
  try {
    // Storage API owns blob and metadata removal; never delete storage rows in SQL.
    const { error } = await client.storage.from(job.bucket).remove([job.path]);
    if (error) return false;
    const result = await client.rpc("finish_lifecycle_export_expiry", {
      p_export_id: job.id,
      p_lease: job.lease,
    });
    return !result.error && result.data === true;
  } catch {
    return false;
  }
}

export async function runLifecycleExportExpiry() {
  const client = lifecycleExportServiceClient();
  const deadline = Date.now() + 20000;
  const result = await client.rpc("claim_expired_lifecycle_exports", { p_limit: 10 });
  if (result.error || !Array.isArray(result.data)) {
    throw new Error("Export expiry queue could not be read.");
  }
  let removed = 0;
  let failed = 0;
  for (const job of result.data as ExpiredExport[]) {
    if (await processExpiredLifecycleExport(client, job, deadline)) removed++;
    else failed++;
  }
  // Only counts leave the worker; paths, identities and payloads are not logged.
  return { removed, failed };
}
