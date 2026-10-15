import "server-only";

import { normalizePublicSalonAddress } from "@/lib/location/address";
import { hasValidCoordinates } from "@/lib/location/distance";
import { hasCurrentLocationPin, locationPinSnapshot } from "@/lib/location/coordinate-validity";
import {
  geocodePublicSalonAddress,
  getGeocodingProviderStatus,
  isAcceptableGeocodingResult,
} from "@/lib/location/geocoding-service";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { SalonSetting } from "@/types/salon-setting";
import type {
  Coordinates,
  GeocodingServiceError,
  NormalizedPublicSalonAddress,
  SalonMapLocationStatus,
  StoredGeocodingStatus,
} from "@/types/location";

const GEOCODING_REFRESH_DEBOUNCE_MS = 60_000;

type LocationGeocodingRow = {
  geocoded_at: string | null;
  geocoding_address_fingerprint: string | null;
  geocoding_error_code: string | null;
  geocoding_place_id: string | null;
  geocoding_provider: string | null;
  geocoding_status: StoredGeocodingStatus | null;
  geocoding_pin_origin: "auto_census" | "auto_maptiler" | "owner_confirmed" | null;
  latitude: number | null;
  longitude: number | null;
  updated_at: string | null;
};

export type SalonMapLocationState = {
  address: NormalizedPublicSalonAddress;
  coordinates: Coordinates | null;
  geocodedAt: string | null;
  geocodingProvider: string | null;
  providerConfigured: boolean;
  providerLabel: string | null;
  providerMissingConfiguration: string[];
  refreshEnabled: boolean;
  status: SalonMapLocationStatus;
  statusDescription: string;
  statusLabel: string;
};

function addressInputFromSetting(setting: SalonSetting) {
  return {
    addressLine1: setting.address_line1,
    addressLine2: setting.address_line2,
    city: setting.city,
    country: setting.country,
    postalCode: setting.postal_code,
    state: setting.state,
  };
}

function readCoordinates(row: LocationGeocodingRow | null) {
  const coordinates = {
    latitude: row?.latitude ?? null,
    longitude: row?.longitude ?? null,
  };

  return hasValidCoordinates(coordinates) && !(coordinates.latitude === 0 && coordinates.longitude === 0) ? coordinates : null;
}

function mapStatus(input: {
  address: NormalizedPublicSalonAddress;
  coordinates: Coordinates | null;
  providerConfigured: boolean;
  row: LocationGeocodingRow | null;
}): SalonMapLocationStatus {
  if (input.coordinates && !input.row?.geocoding_address_fingerprint
    && !["stale", "address_required", "pending", "failed"].includes(input.row?.geocoding_status ?? "")) {
    return "mapped";
  }
  if (!input.address.isComplete) {
    return "address_required";
  }

  if (input.row?.geocoding_status === "failed") {
    return "failed";
  }

  if (input.row?.geocoding_status === "stale") {
    return "stale";
  }

  if (input.row?.geocoding_status === "pending") {
    return "pending";
  }

  if (
    input.row?.geocoding_status === "provider_unavailable" &&
    !input.providerConfigured &&
    !input.coordinates
  ) {
    return "provider_unavailable";
  }

  if (
    input.coordinates &&
    input.address.fingerprint &&
    input.row?.geocoding_address_fingerprint &&
    input.row.geocoding_address_fingerprint !== input.address.fingerprint
  ) {
    return "stale";
  }

  if (input.coordinates) {
    return "mapped";
  }

  return input.providerConfigured ? "pending" : "provider_unavailable";
}

function statusCopy(status: SalonMapLocationStatus) {
  switch (status) {
    case "address_required":
      return {
        description:
          "Add a complete public street address, city, state, and ZIP before map location can be prepared.",
        label: "Address required",
      };
    case "failed":
      return {
        description:
          "We could not update the map location. Your salon can still be found by city, state, and ZIP.",
        label: "Needs refresh",
      };
    case "mapped":
      return {
        description:
          "Your salon is located on the map and can appear in nearby search results.",
        label: "Mapped",
      };
    case "pending":
      return {
        description:
          "Confirm the salon address, then refresh its map location.",
        label: "Ready to locate",
      };
    case "stale":
      return {
        description:
          "The salon address has changed. Refresh the map location to update its pin.",
        label: "Refresh needed",
      };
    case "provider_unavailable":
      return {
        description:
          "Map location lookup is temporarily unavailable. Your salon can still be found by city, state, and ZIP.",
        label: "Map lookup unavailable",
      };
  }
}

function isRecentGeocodingAttempt(row: LocationGeocodingRow | null) {
  if (!row?.updated_at) {
    return false;
  }

  const updatedAt = new Date(row.updated_at).getTime();

  return (
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt < GEOCODING_REFRESH_DEBOUNCE_MS
  );
}

function geocodingErrorCode(error: GeocodingServiceError) {
  return error.type;
}

async function loadLocationGeocodingRow(input: {
  context: CurrentBusinessContext;
  setting: SalonSetting;
}) {
  if (!input.context.user || !isSalonManageContext(input.context)) {
    return null;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("locations")
    .select(
      "latitude, longitude, geocoded_at, geocoding_status, geocoding_provider, geocoding_place_id, geocoding_error_code, geocoding_address_fingerprint, geocoding_pin_origin, updated_at",
    )
    .eq("id", input.setting.salon_id)
    .maybeSingle<LocationGeocodingRow>();

  if (error) {
    console.warn("Supabase load salon map location state failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: input.setting.salon_id,
    });
    return null;
  }

  return data;
}

async function updateLocationGeocodingRow(input: {
  context: CurrentBusinessContext;
  setting: SalonSetting;
  updates: Partial<LocationGeocodingRow>;
  priorRow: LocationGeocodingRow | null;
}) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase || !input.priorRow) {
    return false;
  }

  const address = normalizePublicSalonAddress(addressInputFromSetting(input.setting));
  const { data, error } = await supabase.rpc("set_current_salon_geocoding_state", {
    p_salon_id: input.setting.salon_id,
    p_fingerprint: address.fingerprint,
    p_prior_pin: locationPinSnapshot(input.priorRow),
    p_values: {
      status: input.updates.geocoding_status,
      errorCode: input.updates.geocoding_error_code ?? null,
      latitude: input.updates.latitude ?? null,
      longitude: input.updates.longitude ?? null,
      provider: input.updates.geocoding_provider ?? null,
      placeId: input.updates.geocoding_place_id ?? null,
    },
  });

  if (error) {
    console.warn("Supabase update salon map location state failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: input.setting.salon_id,
    });
  }
  return !error && (data === "updated" || data === "succeeded");
}

async function assertCanManageMapLocation(input: {
  context: CurrentBusinessContext;
  reason: "address_save" | "backfill" | "manual_refresh";
  setting: SalonSetting;
}) {
  const { context, setting } = input;

  if (
    !context.user ||
    !isSalonManageContext(context) ||
    !context.currentAccount ||
    !context.currentSalon
  ) {
    throw new Error("Choose a salon workspace before mapping this salon.");
  }

  if (
    input.reason !== "backfill" &&
    setting.salon_id !== context.currentSalon.id
  ) {
    throw new Error("Map location can only be refreshed for the selected salon.");
  }

  if (!(await hasPermission("salon_settings.manage", context))) {
    throw new Error("You do not have permission to refresh this map location.");
  }
}

export async function getCurrentSalonMapLocationState(input: {
  context?: CurrentBusinessContext;
  setting: SalonSetting;
}): Promise<SalonMapLocationState> {
  const context = input.context ?? (await getCurrentBusinessContext());
  const row = await loadLocationGeocodingRow({
    context,
    setting: input.setting,
  });
  const address = normalizePublicSalonAddress(addressInputFromSetting(input.setting));
  const sourceCoordinates = readCoordinates(row);
  const coordinates = hasCurrentLocationPin(row, address) ? sourceCoordinates : null;
  const providerStatus = getGeocodingProviderStatus();
  const status = mapStatus({
    address,
    coordinates: sourceCoordinates,
    providerConfigured: providerStatus.configured,
    row,
  });
  const copy = statusCopy(status);

  return {
    address,
    coordinates,
    geocodedAt: row?.geocoded_at ?? null,
    geocodingProvider: row?.geocoding_provider ?? null,
    providerConfigured: providerStatus.configured,
    providerLabel: providerStatus.provider,
    providerMissingConfiguration: providerStatus.missingConfiguration,
    refreshEnabled:
      providerStatus.configured &&
      address.isComplete &&
      row?.geocoding_pin_origin !== "owner_confirmed" &&
      (status === "failed" || status === "pending" || status === "stale"),
    status,
    statusDescription: copy.description,
    statusLabel: copy.label,
  };
}

export async function refreshCurrentSalonMapLocation(input: {
  context: CurrentBusinessContext;
  reason: "address_save" | "backfill" | "manual_refresh";
  setting: SalonSetting;
}): Promise<SalonMapLocationState> {
  await assertCanManageMapLocation(input);

  const row = await loadLocationGeocodingRow(input);
  const address = normalizePublicSalonAddress(addressInputFromSetting(input.setting));
  const providerStatus = getGeocodingProviderStatus();

  if (!row || row.geocoding_pin_origin === "owner_confirmed"
    || input.reason !== "manual_refresh" && (hasCurrentLocationPin(row, address)
      || (row.latitude !== null || row.longitude !== null)
        && row.geocoding_pin_origin !== "auto_census" && row.geocoding_pin_origin !== "auto_maptiler")) {
    return getCurrentSalonMapLocationState(input);
  }

  if (!address.isComplete) {
    await updateLocationGeocodingRow({
      ...input,
      priorRow: row,
      updates: {
        geocoding_error_code: "address_required",
        geocoding_status: "address_required",
      },
    });
    return getCurrentSalonMapLocationState(input);
  }

  if (!providerStatus.configured) {
    await updateLocationGeocodingRow({
      ...input,
      priorRow: row,
      updates: {
        geocoding_error_code: "provider_unavailable",
        geocoding_status: "provider_unavailable",
      },
    });
    return getCurrentSalonMapLocationState(input);
  }

  if (
    input.reason !== "manual_refresh" &&
    row?.geocoding_status === "pending" &&
    isRecentGeocodingAttempt(row)
  ) {
    return getCurrentSalonMapLocationState(input);
  }

  const prepared = await updateLocationGeocodingRow({
    ...input,
    priorRow: row,
    updates: {
      geocoding_error_code: null,
      geocoding_status: "pending",
    },
  });
  if (!prepared) return getCurrentSalonMapLocationState(input);

  const geocoding = await geocodePublicSalonAddress(address);

  if (geocoding.error || !isAcceptableGeocodingResult(geocoding.result)) {
    await updateLocationGeocodingRow({
      ...input,
      priorRow: row,
      updates: {
        geocoding_error_code: geocoding.error
          ? geocodingErrorCode(geocoding.error)
          : "low_confidence",
        geocoding_status: "failed",
      },
    });
    return getCurrentSalonMapLocationState(input);
  }

  await updateLocationGeocodingRow({
    ...input,
    priorRow: row,
    updates: {
      geocoding_error_code: null,
      geocoding_place_id: geocoding.result.providerPlaceId,
      geocoding_provider: geocoding.result.provider,
      geocoding_status: "mapped",
      latitude: geocoding.result.latitude,
      longitude: geocoding.result.longitude,
    },
  });

  return getCurrentSalonMapLocationState(input);
}

export async function syncCurrentSalonMapLocationAddressState(input: {
  context: CurrentBusinessContext;
  setting: SalonSetting;
}) {
  if (!input.context.user || !isSalonManageContext(input.context)) {
    return;
  }

  const row = await loadLocationGeocodingRow(input);
  const address = normalizePublicSalonAddress(addressInputFromSetting(input.setting));
  const coordinates = readCoordinates(row);
  const providerStatus = getGeocodingProviderStatus();
  const updates: Partial<LocationGeocodingRow> = {};

  if (!address.isComplete) {
    updates.geocoding_status = "address_required";
    updates.geocoding_error_code = "address_required";
  } else if (
    coordinates &&
    address.fingerprint &&
    row?.geocoding_address_fingerprint &&
    row.geocoding_address_fingerprint !== address.fingerprint
  ) {
    updates.geocoding_status = "stale";
    updates.geocoding_error_code = null;
  } else if (!providerStatus.configured && !coordinates) {
    updates.geocoding_status = "provider_unavailable";
    updates.geocoding_error_code = "provider_unavailable";
  } else if (
    providerStatus.configured &&
    address.fingerprint &&
    !isRecentGeocodingAttempt(row) &&
    (!coordinates || row?.geocoding_address_fingerprint !== address.fingerprint)
  ) {
    await refreshCurrentSalonMapLocation({
      ...input,
      reason: "address_save",
    });
    return;
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  await updateLocationGeocodingRow({
    ...input,
    priorRow: row,
    updates,
  });
}
