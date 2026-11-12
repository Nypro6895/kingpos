import type { Coordinates } from "@/types/location";
import { hasValidCoordinates } from "@/lib/location/distance";

export function mapDirectionsUrl(destination: string | Coordinates, apple = false) {
  const value = typeof destination === "string" ? destination.trim()
    : hasValidCoordinates(destination) ? `${destination.latitude},${destination.longitude}` : "";
  return value ? apple
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(value)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(value)}` : undefined;
}

export function salonMapEmbedUrl(address: string) {
  const value = address.trim();
  return value ? `https://www.google.com/maps?q=${encodeURIComponent(value)}&output=embed` : undefined;
}
