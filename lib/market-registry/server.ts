import "server-only";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { MarketRegistryInputError } from "./manifest";
import type { MarketRegistryLoad, MarketRegistryQueue, MarketRegistryWorkspace } from "@/types/market-registry";

class RegistryAccessError extends Error {}

export function isMarketRegistryEnabled() {
  return process.env.MARKET_PRIVATE_REGISTRY_ENABLED === "true";
}

/** Every operation obtains the current authenticated client. No service role,
 * cached tenant context or platform-owner permission shortcut is used here. */
export async function marketRegistryRpc<T>(name: string, params?: Record<string, unknown>): Promise<T> {
  if (!isMarketRegistryEnabled()) throw new RegistryAccessError("Private app review is not available.");
  const client = await createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true });
  if (!client) throw new RegistryAccessError("Sign in with an account authorized for private app review.");
  const { data, error } = await client.rpc(name, params);
  if (error) {
    if (error.code === "42501") throw new RegistryAccessError("Your account does not have access to this private workspace.");
    // Only deliberately raised validation/conflict messages are safe to display.
    // Never expose schema, SQL, connection details or raw auth/provider errors.
    if (error.code === "22023" || error.code === "PT409" || error.code === "40001" || error.code === "23505") {
      throw new MarketRegistryInputError(error.code === "22023"
        ? "The app details or review are invalid. Check the fields and try again."
        : "This draft or submission changed. Reload it before trying again.");
    }
    throw new Error("Private app review could not be updated. Please try again.");
  }
  if (data === null) throw new Error("Private app review returned no result. Please try again.");
  return data as T;
}

async function load<T>(name: string): Promise<MarketRegistryLoad<T>> {
  if (!isMarketRegistryEnabled()) return { status: "disabled", message: "Private app review is not available." };
  try {
    return { status: "ready", data: await marketRegistryRpc<T>(name) };
  } catch (error) {
    return error instanceof RegistryAccessError
      ? { status: "unauthorized", message: error.message }
      : { status: "unavailable", message: "Private app review could not be loaded. Please try again." };
  }
}

export function loadDeveloperWorkspace() { return load<MarketRegistryWorkspace>("market_registry_workspace"); }
export function loadReviewQueue() { return load<MarketRegistryQueue>("market_registry_review_queue"); }

export function registryActionError(error: unknown): string {
  return error instanceof MarketRegistryInputError || error instanceof RegistryAccessError
    ? error.message
    : "Private app review could not be updated. Please reload and try again.";
}
