/** A containing administrative area, never a salon position or distance. */
export type ExploreGpsArea = {
  label: string;
  city: string | null;
  state: string;
  postalCode: string | null;
  country: "US";
  source: "gps";
  provider: "maptiler" | "us_census";
  precision: "city" | "postal" | "state";
  attribution: { label: string; url: string };
};

export type ExploreGpsAreaErrorKind =
  | "invalid"
  | "unsupported"
  | "unavailable"
  | "timeout"
  | "network"
  | "rate_limited"
  | "cancelled";

export type ExploreGpsAreaResponse = {
  area: ExploreGpsArea | null;
  error: string | null;
  errorKind: ExploreGpsAreaErrorKind | null;
};

export type ExploreGpsPoint = { latitude: number; longitude: number };
