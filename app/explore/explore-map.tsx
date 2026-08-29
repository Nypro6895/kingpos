"use client";

import "./explore-map.css";

import {
  LumiTrustPopover,
} from "@/components/reylumi-trust";
import { buildReylumiTrustSummary } from "@/lib/reylumi-trust";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Coordinates } from "@/types/location";
import type { ExploreMapSalon } from "@/types/explore";

type ExploreMapProps = {
  maptilerKey: string;
  onSelectSalon?: (salonId: string) => void;
  salons: ExploreMapSalon[];
  selectedSalonId?: string | null;
  userCoordinates?: Coordinates | null;
};

type MapLibreBounds = {
  extend: (coordinates: [number, number]) => void;
  isEmpty: () => boolean;
};

type MapLibreMap = {
  addControl: (control: unknown, position?: string) => void;
  easeTo: (options: Record<string, unknown>) => void;
  fitBounds: (bounds: MapLibreBounds, options: Record<string, unknown>) => void;
  on: (event: string, callback: () => void) => void;
  remove: () => void;
};

type MapLibreMarker = {
  addTo: (map: MapLibreMap) => MapLibreMarker;
  remove: () => void;
  setLngLat: (coordinates: [number, number]) => MapLibreMarker;
};

type MapLibreApi = {
  LngLatBounds: new () => MapLibreBounds;
  Map: new (options: Record<string, unknown>) => MapLibreMap;
  Marker: new (options: { element: HTMLElement }) => MapLibreMarker;
  NavigationControl: new (options: Record<string, unknown>) => unknown;
};

declare global {
  interface Window {
    maplibregl?: MapLibreApi;
  }
}

let mapLibrePromise: Promise<MapLibreApi> | null = null;

function loadMapLibre() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MapLibre is only available in the browser."));
  }

  if (window.maplibregl) {
    return Promise.resolve(window.maplibregl);
  }

  if (mapLibrePromise) {
    return mapLibrePromise;
  }

  mapLibrePromise = new Promise<MapLibreApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = "/api/vendor/maplibre-gl";
    script.onload = () => {
      if (window.maplibregl) {
        resolve(window.maplibregl);
      } else {
        reject(new Error("MapLibre did not initialize."));
      }
    };
    script.onerror = () => reject(new Error("MapLibre could not be loaded."));
    document.head.appendChild(script);
  });

  return mapLibrePromise;
}

function markerClass(selected: boolean) {
  return [
    "grid size-8 place-items-center rounded-full border-2 text-xs font-semibold shadow-lg transition",
    selected
      ? "border-white bg-emerald-600 text-white ring-4 ring-emerald-600/25"
      : "border-white bg-zinc-950 text-white hover:bg-emerald-700",
  ].join(" ");
}

export function ExploreMap({
  maptilerKey,
  onSelectSalon,
  salons,
  selectedSalonId,
  userCoordinates,
}: ExploreMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapLibreRef = useRef<MapLibreApi | null>(null);
  const markerRefs = useRef<MapLibreMarker[]>([]);
  const markerElementRefs = useRef(new Map<string, HTMLElement>());
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReadyToken, setMapReadyToken] = useState(0);
  const [markerReadyToken, setMarkerReadyToken] = useState(0);

  useEffect(() => {
    if (!containerRef.current || !maptilerKey || salons.length === 0) {
      return;
    }

    let cancelled = false;

    loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        const map = new maplibregl.Map({
          attributionControl: { compact: true },
          center: [salons[0].longitude, salons[0].latitude],
          container: containerRef.current,
          style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(
            maptilerKey,
          )}`,
          zoom: salons.length === 1 ? 12 : 10,
        });

        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "top-right",
        );
        map.on("error", () => {
          setMapError("Map tiles could not be loaded right now.");
        });
        mapLibreRef.current = maplibregl;
        mapRef.current = map;
        setMapReadyToken((token) => token + 1);
      })
      .catch(() => {
        if (!cancelled) {
          setMapError("Map could not be loaded right now.");
        }
      });

    const markerElementMap = markerElementRefs.current;

    return () => {
      cancelled = true;
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      markerElementMap.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [maptilerKey, salons]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = mapLibreRef.current;

    if (!map || !maplibregl) {
      return;
    }

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];
    markerElementRefs.current.clear();

    const bounds = new maplibregl.LngLatBounds();

    salons.forEach((salon, index) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = markerClass(false);
      element.textContent = String(index + 1);
      element.setAttribute("aria-label", `Select ${salon.name} on the map`);
      element.addEventListener("click", () => onSelectSalon?.(salon.id));

      const marker = new maplibregl.Marker({ element })
        .setLngLat([salon.longitude, salon.latitude])
        .addTo(map);

      markerRefs.current.push(marker);
      markerElementRefs.current.set(salon.id, element);
      bounds.extend([salon.longitude, salon.latitude]);
    });

    if (userCoordinates) {
      const userElement = document.createElement("div");
      userElement.className =
        "size-4 rounded-full border-2 border-white bg-sky-500 shadow-md ring-4 ring-sky-500/20";
      userElement.setAttribute("aria-label", "Your current location");

      const marker = new maplibregl.Marker({ element: userElement })
        .setLngLat([userCoordinates.longitude, userCoordinates.latitude])
        .addTo(map);

      markerRefs.current.push(marker);
      bounds.extend([userCoordinates.longitude, userCoordinates.latitude]);
    }

    if (salons.length === 1 && !userCoordinates) {
      map.easeTo({
        center: [salons[0].longitude, salons[0].latitude],
        duration: 350,
        zoom: 13,
      });
    } else if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        duration: 350,
        maxZoom: 13,
        padding: 56,
      });
    }
    setMarkerReadyToken((token) => token + 1);
  }, [mapReadyToken, onSelectSalon, salons, userCoordinates]);

  useEffect(() => {
    for (const [salonId, element] of markerElementRefs.current) {
      // MapLibre markers live outside React; this keeps selection styling in sync without rebuilding markers.
      // eslint-disable-next-line react-hooks/immutability
      element.className = markerClass(salonId === selectedSalonId);
    }
  }, [markerReadyToken, selectedSalonId]);

  const selectedSalon = salons.find((salon) => salon.id === selectedSalonId) ?? salons[0];
  const selectedTrust = selectedSalon
    ? buildReylumiTrustSummary(selectedSalon.trust)
    : null;

  return (
    <div className="relative min-h-[22rem] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
      <div className="absolute inset-0" ref={containerRef} />
      {mapError ? (
        <div className="absolute inset-x-3 top-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 shadow-sm">
          {mapError}
        </div>
      ) : null}
      {selectedSalon ? (
        <div className="absolute inset-x-3 bottom-3 rounded-md border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="flex min-w-0 items-center gap-1.5">
            {selectedSalon.href ? (
              <Link
                className="line-clamp-1 min-w-0 rounded-md text-sm font-semibold text-zinc-950 transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={selectedSalon.href}
              >
                {selectedSalon.name}
              </Link>
            ) : (
              <p className="line-clamp-1 min-w-0 text-sm font-semibold text-zinc-950">
                {selectedSalon.name}
              </p>
            )}
            {selectedTrust ? (
              <LumiTrustPopover
                actionHref={
                  selectedSalon.href ? `${selectedSalon.href}#lumi-trust` : null
                }
                entityName={selectedSalon.name}
                markClassName="grid h-8 w-8 place-items-center rounded-full bg-white p-0 text-brand-orange ring-1 ring-brand-orange/20 hover:bg-brand-orange-soft"
                presentation="spark"
                size="sm"
                summary={selectedTrust}
              />
            ) : null}
          </div>
          <p className="mt-1 line-clamp-1 text-xs font-medium text-zinc-600">
            {[selectedSalon.locationLabel, selectedSalon.distanceMiles !== null ? `${selectedSalon.distanceMiles < 10 ? selectedSalon.distanceMiles.toFixed(1) : Math.round(selectedSalon.distanceMiles)} mi` : null]
              .filter(Boolean)
              .join(" \u00b7 ")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
