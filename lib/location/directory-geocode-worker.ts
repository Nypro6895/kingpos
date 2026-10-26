import "server-only";
import { geocodeDirectoryAddressWithCensus } from "@/lib/location/providers/census-address-geocoder";
import { normalizePublicSalonAddress } from "@/lib/location/address";
import type { CensusAddressResult } from "@/lib/location/census-address-match";
import type { PublicSalonAddressInput } from "@/types/location";

type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };
export type DirectoryGeocodeRpc = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
type Candidate = { salonId: string; fingerprint: string; address: PublicSalonAddressInput };
type WorkerOptions = {
  rpc: DirectoryGeocodeRpc; after?: string | null; limit?: number; dryRun?: boolean;
  geocode?: (address: PublicSalonAddressInput) => Promise<CensusAddressResult>;
  pause?: (milliseconds: number) => Promise<void>; minimumDelayMs?: number;
};
export type DirectoryGeocodeWorkerReport = {
  dryRun: boolean; scanned: number; nextAfter: string | null; hasMore: boolean;
  examined: number; accepted: number; applied: number; rejected: number; skipped: number;
  results: Array<{ salonId: string; outcome: string; reason: string | null }>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

/** One bounded maintenance tick, never called from Explore or a public API. Default is read-only. */
export async function runDirectoryGeocodeBatch(options: WorkerOptions): Promise<DirectoryGeocodeWorkerReport> {
  const dryRun = options.dryRun !== false;
  if (options.after && !UUID.test(options.after)) throw new Error("Invalid maintenance cursor");
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(5, Math.floor(options.limit!))) : 5;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const result = await options.rpc(name, args);
    // SQL/URLs/credentials are intentionally excluded from maintenance errors.
    if (result.error) throw new Error("Directory geocode maintenance RPC failed: " + name);
    return result.data;
  };
  const page = object(await rpc("get_directory_geocode_candidates", { p_after: options.after ?? null, p_limit: limit, p_scan_limit: 256 }));
  const raw = Array.isArray(page.candidates) ? page.candidates.slice(0, limit) : [];
  const candidates: Candidate[] = raw.map(object).flatMap(item => {
    const values = object(item.address);
    if (["addressLine1", "addressLine2", "city", "state", "postalCode", "country"].some(field => values[field] != null && typeof values[field] !== "string")) return [];
    const address = values as PublicSalonAddressInput;
    // Do not trust malformed fixtures/RPC responses with an arbitrary address fingerprint.
    if (typeof item.salonId !== "string" || !UUID.test(item.salonId) || typeof item.fingerprint !== "string"
      || normalizePublicSalonAddress(address).fingerprint !== item.fingerprint) return [];
    return [{ salonId: item.salonId, fingerprint: item.fingerprint, address }];
  });
  const report: DirectoryGeocodeWorkerReport = {
    dryRun, scanned: typeof page.scanned === "number" ? Math.min(256, Math.max(0, page.scanned)) : 0,
    nextAfter: typeof page.nextAfter === "string" && UUID.test(page.nextAfter) ? page.nextAfter : null,
    hasMore: page.hasMore === true, examined: 0, accepted: 0, applied: 0, rejected: 0,
    skipped: raw.length - candidates.length, results: [],
  };
  const pause = options.pause ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const delay = Math.max(1000, options.minimumDelayMs ?? 1000);
  for (const candidate of candidates) {
    let lease: string | null = null;
    if (!dryRun) {
      const value = await rpc("claim_directory_geocode_job", { p_salon_id: candidate.salonId, p_fingerprint: candidate.fingerprint });
      if (typeof value !== "string" || !UUID.test(value)) {
        report.skipped++; report.results.push({ salonId: candidate.salonId, outcome: "skipped", reason: "source_changed_or_leased" }); continue;
      }
      lease = value;
    }
    if (report.examined > 0) await pause(delay);
    let result: CensusAddressResult;
    try { result = await (options.geocode ?? geocodeDirectoryAddressWithCensus)(candidate.address); }
    catch { result = { match: null, reason: "network" }; }
    report.examined++;
    if (result.match?.fingerprint !== candidate.fingerprint) result = { match: null, reason: result.match ? "fingerprint_mismatch" : result.reason };
    if (result.match) report.accepted++; else report.rejected++;
    const outcome = dryRun ? (result.match ? "accepted_dry_run" : "rejected_dry_run") : await rpc("finish_directory_geocode_job", {
      p_salon_id: candidate.salonId, p_fingerprint: candidate.fingerprint, p_lease_token: lease,
      p_match: result.match, p_reason: result.reason,
    });
    if (outcome === "succeeded") report.applied++;
    if (outcome === "source_busy" || outcome === "stale" || outcome === "lease_lost") report.skipped++;
    report.results.push({ salonId: candidate.salonId, outcome: typeof outcome === "string" ? outcome : "invalid_outcome", reason: result.reason });
  }
  return report;
}
