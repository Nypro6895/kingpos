export const LOCATION_STATUSES = ["active", "inactive"] as const;

export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export type Location = {
  id: string;
  organization_id: string;
  name: string;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  geocoded_at?: string | null;
  geocoding_address_fingerprint?: string | null;
  geocoding_error_code?: string | null;
  geocoding_place_id?: string | null;
  geocoding_provider?: string | null;
  geocoding_status?: StoredGeocodingStatus | null;
  status: LocationStatus;
  created_at: string;
  updated_at: string;
};

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type PublicSalonAddressInput = {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  country?: string | null;
  postalCode?: string | null;
  state?: string | null;
};

export type NormalizedPublicSalonAddress = {
  city: string | null;
  cityStateLabel: string;
  country: string;
  fingerprint: string | null;
  formattedAddress: string;
  geocodingAddress: string | null;
  isComplete: boolean;
  missingParts: Array<"addressLine1" | "city" | "postalCode" | "state">;
  postalCode: string | null;
  state: string | null;
};

export type StoredGeocodingStatus =
  | "address_required"
  | "failed"
  | "mapped"
  | "pending"
  | "provider_unavailable"
  | "stale";

export type SalonMapLocationStatus =
  | StoredGeocodingStatus
  | "provider_unavailable";

export type GeocodingProviderStatus = {
  configured: boolean;
  missingConfiguration: string[];
  provider: "maptiler" | null;
  reason: "configured" | "server_key_missing";
};

export type GeocodingConfidence = "high" | "low" | "medium";

export type GeocodingResult = Coordinates & {
  confidence: GeocodingConfidence | null;
  geocodedAt: string;
  formattedAddress: string;
  provider: "maptiler";
  providerPlaceId: string | null;
};

export type GeocodingErrorType =
  | "address_incomplete"
  | "invalid_coordinates"
  | "low_confidence"
  | "provider_unavailable"
  | "rate_limited"
  | "request_failed"
  | "timeout";

export type GeocodingServiceError = {
  message: string;
  type: GeocodingErrorType;
};

export type GeocodingServiceResult =
  | { error: null; result: GeocodingResult }
  | { error: GeocodingServiceError; result: null };
