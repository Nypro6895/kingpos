import type { Coordinates } from "@/types/location";

const EARTH_RADIUS_MILES = 3958.7613;

export function isValidLatitude(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number | null | undefined) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
  );
}

export function hasValidCoordinates(
  value:
    | {
        latitude?: number | null;
        longitude?: number | null;
      }
    | null
    | undefined,
): value is Coordinates {
  return isValidLatitude(value?.latitude) && isValidLongitude(value?.longitude);
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function distanceMilesBetween(
  origin: Coordinates,
  destination: Coordinates,
) {
  const originLatitude = toRadians(origin.latitude);
  const destinationLatitude = toRadians(destination.latitude);
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function formatDistanceMiles(distanceMiles: number | null | undefined) {
  if (typeof distanceMiles !== "number" || !Number.isFinite(distanceMiles)) {
    return null;
  }

  return distanceMiles < 10
    ? `${distanceMiles.toFixed(1)} mi`
    : `${Math.round(distanceMiles)} mi`;
}
