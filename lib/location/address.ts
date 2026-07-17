import type {
  NormalizedPublicSalonAddress,
  PublicSalonAddressInput,
} from "@/types/location";

const DEFAULT_COUNTRY = "US";

function clean(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

function configuredDefaultCountry() {
  return clean(process.env.KINGPOS_DEFAULT_COUNTRY) ?? DEFAULT_COUNTRY;
}

function normalizeCountry(value: string | null | undefined) {
  return clean(value)?.toUpperCase() ?? configuredDefaultCountry();
}

function normalizeState(value: string | null | undefined) {
  return clean(value)?.toUpperCase() ?? null;
}

function normalizePostalCode(value: string | null | undefined) {
  return clean(value)?.toUpperCase() ?? null;
}

export function normalizePublicSalonAddress(
  input: PublicSalonAddressInput,
): NormalizedPublicSalonAddress {
  const addressLine1 = clean(input.addressLine1);
  const addressLine2 = clean(input.addressLine2);
  const city = clean(input.city);
  const state = normalizeState(input.state);
  const postalCode = normalizePostalCode(input.postalCode);
  const country = normalizeCountry(input.country);
  const missingParts: NormalizedPublicSalonAddress["missingParts"] = [];

  if (!addressLine1) {
    missingParts.push("addressLine1");
  }

  if (!city) {
    missingParts.push("city");
  }

  if (!state) {
    missingParts.push("state");
  }

  if (!postalCode) {
    missingParts.push("postalCode");
  }

  const cityStateLabel = [city, state].filter(Boolean).join(", ");
  const formattedAddress = [
    addressLine1,
    addressLine2,
    [cityStateLabel, postalCode].filter(Boolean).join(" "),
    country,
  ]
    .filter(Boolean)
    .join(", ");
  const isComplete = missingParts.length === 0;
  const geocodingAddress = isComplete ? formattedAddress : null;
  const fingerprint = geocodingAddress
    ? [
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode,
        country,
      ]
        .filter(Boolean)
        .join("|")
        .toLowerCase()
    : null;

  return {
    city,
    cityStateLabel,
    country,
    fingerprint,
    formattedAddress,
    geocodingAddress,
    isComplete,
    missingParts,
    postalCode,
    state,
  };
}
