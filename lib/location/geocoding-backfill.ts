import "server-only";

import { getCurrentBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { normalizePublicSalonAddress } from "@/lib/location/address";
import { getGeocodingProviderStatus } from "@/lib/location/geocoding-service";
import { refreshCurrentSalonMapLocation } from "@/lib/location/salon-map-location";
import { hasPermission } from "@/lib/permissions";
import {
  SALON_SETTING_SELECT,
} from "@/lib/salon-settings";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { SalonSetting } from "@/types/salon-setting";

const MAX_BACKFILL_BATCH_SIZE = 10;
const DEFAULT_BACKFILL_BATCH_SIZE = 5;
const DEFAULT_BACKFILL_DELAY_MS = 500;

type BackfillLocationRow = {
  geocoding_address_fingerprint: string | null;
  geocoding_status: string | null;
  id: string;
  latitude: number | null;
  longitude: number | null;
};

export type GeocodingBackfillReport = {
  failed: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  succeeded: number;
  total: number;
};

function incrementReason(report: GeocodingBackfillReport, reason: string) {
  report.skipped += 1;
  report.skippedReasons[reason] = (report.skippedReasons[reason] ?? 0) + 1;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function backfillCurrentOrganizationMapLocations(input: {
  delayMs?: number;
  limit?: number;
} = {}): Promise<GeocodingBackfillReport> {
  const context = await getCurrentBusinessContext();
  const report: GeocodingBackfillReport = {
    failed: 0,
    skipped: 0,
    skippedReasons: {},
    succeeded: 0,
    total: 0,
  };

  if (
    !context.user ||
    !isSalonManageContext(context) ||
    !context.currentOrganization
  ) {
    incrementReason(report, "invalid_context");
    return report;
  }

  if (!(await hasPermission("salon_settings.manage", context))) {
    incrementReason(report, "permission_denied");
    return report;
  }

  const providerStatus = getGeocodingProviderStatus();

  if (!providerStatus.configured) {
    incrementReason(report, "provider_unavailable");
    return report;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    incrementReason(report, "supabase_unavailable");
    return report;
  }

  const limit = Math.min(
    MAX_BACKFILL_BATCH_SIZE,
    Math.max(1, Math.floor(input.limit ?? DEFAULT_BACKFILL_BATCH_SIZE)),
  );
  const { data: activeLocations, error: locationsError } = await supabase
    .from("locations")
    .select("id, latitude, longitude, geocoding_status, geocoding_address_fingerprint")
    .eq("organization_id", context.currentOrganization.id)
    .eq("status", "active")
    .limit(limit)
    .returns<BackfillLocationRow[]>();

  if (locationsError) {
    incrementReason(report, "locations_query_failed");
    return report;
  }

  const activeLocationIds = (activeLocations ?? []).map((location) => location.id);

  if (activeLocationIds.length === 0) {
    incrementReason(report, "no_active_locations");
    return report;
  }

  const { data: settings, error: settingsError } = await supabase
    .from("salon_settings")
    .select(SALON_SETTING_SELECT)
    .eq("organization_id", context.currentOrganization.id)
    .eq("public_discovery_enabled", true)
    .in("salon_id", activeLocationIds)
    .limit(limit)
    .returns<SalonSetting[]>();

  if (settingsError) {
    incrementReason(report, "settings_query_failed");
    return report;
  }

  const locationById = new Map(
    (activeLocations ?? []).map((location) => [location.id, location]),
  );

  for (const setting of settings ?? []) {
    report.total += 1;
    const address = normalizePublicSalonAddress({
      addressLine1: setting.address_line1,
      addressLine2: setting.address_line2,
      city: setting.city,
      country: setting.country,
      postalCode: setting.postal_code,
      state: setting.state,
    });
    const location = locationById.get(setting.salon_id);

    if (!address.isComplete) {
      incrementReason(report, "address_required");
      continue;
    }

    if (
      location?.geocoding_status === "mapped" &&
      location.geocoding_address_fingerprint === address.fingerprint &&
      typeof location.latitude === "number" &&
      typeof location.longitude === "number"
    ) {
      incrementReason(report, "already_mapped");
      continue;
    }

    try {
      const state = await refreshCurrentSalonMapLocation({
        context,
        reason: "backfill",
        setting,
      });

      if (state.status === "mapped") {
        report.succeeded += 1;
      } else {
        report.failed += 1;
      }
    } catch {
      report.failed += 1;
    }

    await delay(Math.max(0, input.delayMs ?? DEFAULT_BACKFILL_DELAY_MS));
  }

  return report;
}
