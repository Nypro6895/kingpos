import type { ExploreGpsAreaResponse, ExploreGpsPoint } from "@/types/explore-gps-area";
import type { ExploreGpsArea } from "@/types/explore-gps-area";
import { readExperienceState, writeExperienceState } from "@/lib/experience-state";

function isCachedGpsArea(value: unknown): value is ExploreGpsArea {
  if (!value || typeof value !== "object") return false;
  const area = value as ExploreGpsArea;
  return typeof area.label === "string" && area.label.length > 0 && area.label.length <= 200 && /^[A-Z]{2}$/.test(area.state)
    && (area.city === null || typeof area.city === "string") && (area.postalCode === null || typeof area.postalCode === "string")
    && area.country === "US" && area.source === "gps" && (area.provider === "maptiler" || area.provider === "us_census")
    && ["city", "postal", "state"].includes(area.precision) && typeof area.attribution?.label === "string" && typeof area.attribution?.url === "string";
}

export async function fetchExploreGpsArea(point: ExploreGpsPoint, signal: AbortSignal, scope?: string) {
  if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
  // Keep exact coordinates: rounding could borrow an area across a ZIP/state
  // boundary. This snapshot never substitutes for reacquiring the user's GPS.
  const context = scope && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
    ? { namespace: "gps-area", scope, key: JSON.stringify([point.latitude, point.longitude]) } : null;
  const cached = context ? readExperienceState(context, isCachedGpsArea) : null;
  if (cached) return cached;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; abort(); }, 7000);
  try {
    const response = await fetch("/api/explore/area", { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(point), signal: controller.signal });
    const result = await response.json() as ExploreGpsAreaResponse;
    if (!response.ok || !result.area || result.error) throw new Error("We couldn't find your area. Choose a location or try again.");
    if (context && !signal.aborted && isCachedGpsArea(result.area)) writeExperienceState(context, result.area, { ttlMs: 600000 });
    return result.area;
  } catch (error) {
    if (timedOut) throw new Error("Finding your area is taking longer than usual. Try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
