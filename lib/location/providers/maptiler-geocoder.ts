import "server-only";

import { hasValidCoordinates } from "@/lib/location/distance";
import type {
  GeocodingConfidence,
  GeocodingServiceResult,
  NormalizedPublicSalonAddress,
} from "@/types/location";

const MAPTILER_GEOCODING_ENDPOINT = "https://api.maptiler.com/geocoding";
const MAPTILER_TIMEOUT_MS = 5000;
const MAX_QUERY_LENGTH = 240;

type MapTilerFeature = {
  center?: unknown;
  context?: unknown;
  id?: unknown;
  place_name?: unknown;
  place_type?: unknown;
  properties?: unknown;
  relevance?: unknown;
  text?: unknown;
};

type MapTilerResponse = {
  features?: unknown;
};

function confidenceFromRelevance(value: unknown): GeocodingConfidence | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value >= 0.85) {
    return "high";
  }

  if (value >= 0.65) {
    return "medium";
  }

  return "low";
}

function readFeatureCoordinates(feature: MapTilerFeature) {
  if (!Array.isArray(feature.center) || feature.center.length < 2) {
    return null;
  }

  const [longitude, latitude] = feature.center;
  const coordinates = {
    latitude: typeof latitude === "number" ? latitude : Number.NaN,
    longitude: typeof longitude === "number" ? longitude : Number.NaN,
  };

  return hasValidCoordinates(coordinates) ? coordinates : null;
}

function normalizeMatchText(value: string | null | undefined) {
  return (
    value
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim() ?? ""
  );
}

function readFeatureText(feature: MapTilerFeature) {
  const parts: string[] = [];

  if (typeof feature.place_name === "string") {
    parts.push(feature.place_name);
  }

  if (typeof feature.text === "string") {
    parts.push(feature.text);
  }

  if (Array.isArray(feature.context)) {
    for (const item of feature.context) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const contextItem = item as { text?: unknown; short_code?: unknown };

      if (typeof contextItem.text === "string") {
        parts.push(contextItem.text);
      }

      if (typeof contextItem.short_code === "string") {
        parts.push(contextItem.short_code);
      }
    }
  }

  return normalizeMatchText(parts.join(" "));
}

function readPlaceTypes(feature: MapTilerFeature) {
  const values: string[] = [];

  if (Array.isArray(feature.place_type)) {
    values.push(
      ...feature.place_type.filter(
        (value): value is string => typeof value === "string",
      ),
    );
  }

  if (feature.properties && typeof feature.properties === "object") {
    const properties = feature.properties as {
      accuracy?: unknown;
      type?: unknown;
    };

    if (typeof properties.type === "string") {
      values.push(properties.type);
    }

    if (typeof properties.accuracy === "string") {
      values.push(properties.accuracy);
    }
  }

  return values.map((value) => value.toLowerCase());
}

function hasAcceptablePlaceType(feature: MapTilerFeature) {
  const placeTypes = readPlaceTypes(feature);

  if (placeTypes.length === 0) {
    return true;
  }

  const acceptableTypes = new Set([
    "address",
    "building",
    "exact",
    "interpolated",
    "poi",
    "point",
    "street",
  ]);

  return placeTypes.some((type) => acceptableTypes.has(type));
}

function addressMatchesFeatureContext(
  feature: MapTilerFeature,
  address: NormalizedPublicSalonAddress,
) {
  const featureText = readFeatureText(feature);

  if (!featureText) {
    return false;
  }

  const city = normalizeMatchText(address.city);
  const state = normalizeMatchText(address.state);
  const postalCode = normalizeMatchText(address.postalCode?.split("-")[0]);

  if (city && !featureText.includes(city)) {
    return false;
  }

  if (state && !featureText.includes(state)) {
    return false;
  }

  if (postalCode && /\b\d{5}\b/.test(featureText) && !featureText.includes(postalCode)) {
    return false;
  }

  return true;
}

function pickFeature(
  features: unknown,
  address: NormalizedPublicSalonAddress,
): MapTilerFeature | null {
  if (!Array.isArray(features)) {
    return null;
  }

  return (
    features.find((feature): feature is MapTilerFeature => {
      if (!feature || typeof feature !== "object") {
        return false;
      }

      const candidate = feature as MapTilerFeature;
      const confidence = confidenceFromRelevance(candidate.relevance);

      return Boolean(
        readFeatureCoordinates(candidate) &&
          hasAcceptablePlaceType(candidate) &&
          addressMatchesFeatureContext(candidate, address) &&
          (confidence === "high" || confidence === "medium"),
      );
    }) ?? null
  );
}

function providerErrorMessage(status: number) {
  if (status === 429) {
    return "The geocoding provider is rate limiting requests.";
  }

  if (status === 401 || status === 403) {
    return "The geocoding provider key is not authorized.";
  }

  return "The geocoding provider request failed.";
}

export async function geocodeWithMapTiler(input: {
  address: NormalizedPublicSalonAddress;
  apiKey: string;
}): Promise<GeocodingServiceResult> {
  const query = input.address.geocodingAddress?.trim() ?? "";

  if (!input.address.isComplete || !query) {
    return {
      error: {
        message: "A complete public salon address is required before geocoding.",
        type: "address_incomplete",
      },
      result: null,
    };
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return {
      error: {
        message: "The public salon address is too long to geocode safely.",
        type: "request_failed",
      },
      result: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAPTILER_TIMEOUT_MS);

  try {
    const url = new URL(
      `${MAPTILER_GEOCODING_ENDPOINT}/${encodeURIComponent(query)}.json`,
    );
    url.searchParams.set("key", input.apiKey);
    url.searchParams.set("limit", "5");
    url.searchParams.set("language", "en");

    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        error: {
          message: providerErrorMessage(response.status),
          type: response.status === 429 ? "rate_limited" : "request_failed",
        },
        result: null,
      };
    }

    const payload = (await response.json()) as MapTilerResponse;
    const feature = pickFeature(payload.features, input.address);

    if (!feature) {
      return {
        error: {
          message: "The geocoding provider did not return a usable address match.",
          type: "low_confidence",
        },
        result: null,
      };
    }

    const coordinates = readFeatureCoordinates(feature);

    if (!coordinates) {
      return {
        error: {
          message: "The geocoding provider returned invalid coordinates.",
          type: "invalid_coordinates",
        },
        result: null,
      };
    }

    return {
      error: null,
      result: {
        ...coordinates,
        confidence: confidenceFromRelevance(feature.relevance),
        formattedAddress:
          typeof feature.place_name === "string" && feature.place_name.trim()
            ? feature.place_name.trim()
            : input.address.formattedAddress,
        geocodedAt: new Date().toISOString(),
        provider: "maptiler",
        providerPlaceId:
          typeof feature.id === "string" && feature.id.trim()
            ? feature.id.trim()
            : null,
      },
    };
  } catch (error) {
    return {
      error: {
        message:
          error instanceof Error && error.name === "AbortError"
            ? "The geocoding provider timed out."
            : "The geocoding provider request failed.",
        type:
          error instanceof Error && error.name === "AbortError"
            ? "timeout"
            : "request_failed",
      },
      result: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
