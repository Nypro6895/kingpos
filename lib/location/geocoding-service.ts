import "server-only";

import { normalizePublicSalonAddress } from "@/lib/location/address";
import { hasValidCoordinates } from "@/lib/location/distance";
import { geocodeWithMapTiler } from "@/lib/location/providers/maptiler-geocoder";
import type {
  GeocodingProviderStatus,
  GeocodingServiceResult,
  PublicSalonAddressInput,
} from "@/types/location";

const MAPTILER_SERVER_KEY_ENV_NAME = "MAPTILER_API_KEY";

export function getGeocodingProviderStatus(): GeocodingProviderStatus {
  const apiKey = process.env[MAPTILER_SERVER_KEY_ENV_NAME]?.trim() ?? "";

  if (!apiKey) {
    return {
      configured: false,
      missingConfiguration: [MAPTILER_SERVER_KEY_ENV_NAME],
      provider: null,
      reason: "server_key_missing",
    };
  }

  return {
    configured: true,
    missingConfiguration: [],
    provider: "maptiler",
    reason: "configured",
  };
}

export async function geocodePublicSalonAddress(
  addressInput: PublicSalonAddressInput,
): Promise<GeocodingServiceResult> {
  const address = normalizePublicSalonAddress(addressInput);

  if (!address.isComplete || !address.geocodingAddress) {
    return {
      error: {
        message: "A complete public salon address is required before geocoding.",
        type: "address_incomplete",
      },
      result: null,
    };
  }

  const providerStatus = getGeocodingProviderStatus();

  if (!providerStatus.configured) {
    return {
      error: {
        message: "No server-side geocoding provider is configured.",
        type: "provider_unavailable",
      },
      result: null,
    };
  }

  return geocodeWithMapTiler({
    address,
    apiKey: process.env[MAPTILER_SERVER_KEY_ENV_NAME]?.trim() ?? "",
  });
}

export function isAcceptableGeocodingResult(
  result: GeocodingServiceResult["result"],
) {
  return (
    Boolean(result) &&
    hasValidCoordinates(result) &&
    (result?.confidence === null ||
      result?.confidence === "medium" ||
      result?.confidence === "high")
  );
}
