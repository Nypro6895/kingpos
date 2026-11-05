import "server-only";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

export class PlatformError extends Error {
  constructor(message: string, readonly outcome: "rejected" | "unknown" = "rejected",readonly code?:string) { super(message); }
}
export const platformEnabled = () => process.env.MARKET_PLATFORM_ENABLED === "true";
export async function platformRpc<T>(operation: string, params?: Record<string, unknown>): Promise<T> {
  if (!platformEnabled()) throw new PlatformError("Developer Market is not enabled in this environment.");
  const client = await createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true });
  if (!client) throw new PlatformError("Sign in to your Reylumi account to continue.","rejected","AUTH_REQUIRED");
  const { data, error } = await client.rpc(`market_platform_${operation}`, params);
  if (error) {
    if(error.code==="PT429")throw new PlatformError("Runtime request limit reached. Retry after the current minute.","rejected","PT429");
    if (["22023", "PT409", "42501"].includes(error.code)) throw new PlatformError(error.message,"rejected",error.code);
    throw new PlatformError("Market could not complete this request. Reload and retry.", "unknown");
  }
  return data as T;
}

export type Version = { id: string; app_id: string; version: string; sha256: string; canonical: string; manifest: Manifest; publisher?: string; review?: { decision: string; reason: string } | null };
export type Manifest = { schemaVersion: 1; type: "hosted-app"; version: string; name: string; description: string; launchUrl: string; privacyUrl: string; supportUrl: string; scopes: string[]; price: { currency: "usd"; amountCents: number; billing: "one-time-version" } };
export type Installation = { id: string; salon_id: string; version_id: string; state: string; manifest: Manifest };
export type CommerceWorkspace = { testEnabled: boolean; seller: { charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean } | null; orders: { id: string; charge_id: string | null; version_id: string; amount_cents: number; fee_cents: number; refunded_cents: number; disputed: boolean; state: string; transfer_id: string | null }[]; payouts: { payout_id: string; amount_cents: number; currency: string; status: string }[] };
export type FinanceWorkspace = CommerceWorkspace & { testEnabled: boolean; refundIntents: unknown };
export type Workspace = { organization: { id: string; name: string } | null; reviewer: boolean; apps: { id: string; active: boolean; versions: Version[] }[]; moderation: { id: string; active: boolean; publisher: string }[]; queue: Version[]; catalog: Version[]; salons: { id: string; name: string }[]; installations: Installation[]; sandboxes: { id: string; version_id: string; expires_at: string; request_count: number; last_request_at: string | null }[] };
