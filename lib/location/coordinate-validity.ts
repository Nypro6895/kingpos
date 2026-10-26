import type { NormalizedPublicSalonAddress } from "@/types/location";

export type StoredLocationPin = {
  latitude: number | null;
  longitude: number | null;
  geocoding_address_fingerprint: string | null;
  geocoding_provider: string | null;
  geocoding_place_id: string | null;
  geocoding_status: string | null;
  geocoded_at: string | null;
  geocoding_pin_origin: "auto_census" | "auto_maptiler" | "owner_confirmed" | null;
};

/** Preserve source pins; only a current, complete pair may be used for distance. */
export function hasCurrentLocationPin(row: StoredLocationPin | null, address: NormalizedPublicSalonAddress) {
  if (!row
    || typeof row.latitude !== "number" || typeof row.longitude !== "number"
    || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)
    || row.latitude < -90 || row.latitude > 90 || row.longitude < -180 || row.longitude > 180
    || row.latitude === 0 && row.longitude === 0
    || ["stale", "address_required", "pending", "failed"].includes(row.geocoding_status ?? "")) return false;
  // Legacy and owner pins without a recorded fingerprint are not erased.
  return !row.geocoding_address_fingerprint || Boolean(address.isComplete && address.fingerprint
    && row.geocoding_address_fingerprint === address.fingerprint);
}

/** Immutable pin fields used by the owner refresh RPC's compare-and-swap. */
export function locationPinSnapshot(row: StoredLocationPin | null) {
  return {
    latitude: row?.latitude ?? null,
    longitude: row?.longitude ?? null,
    fingerprint: row?.geocoding_address_fingerprint ?? null,
    provider: row?.geocoding_provider ?? null,
    placeId: row?.geocoding_place_id ?? null,
    origin: row?.geocoding_pin_origin ?? null,
    geocodedAt: row?.geocoded_at ?? null,
  };
}
