"use client";
import { SalonName } from "@/components/salon-member-badge";

import { SalonAddressLink } from "@/components/salon-address-link";
import {ExploreSalonLove,ExploreBookButton} from "@/components/explore-account-actions";
import {SalonTrustLine,SalonVerifiedBadge} from "@/components/salon-trust-line";
import {salonPopularPrice} from "@/lib/salon-identity";

import "./explore-map.css";

import { SalonOperatingStatusBadge } from "@/components/salon-operating-status-badge";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { hasValidCoordinates } from "@/lib/location/distance";
import type { Coordinates } from "@/types/location";
import type { ExploreMapSalon } from "@/types/explore";
import { mapDirectionsUrl } from "@/lib/location/map-links";
import { WorkspaceText } from "@/components/workspace-language";

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
  resize: () => void;
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
        script.remove();
        mapLibrePromise = null;
        reject(new Error("MapLibre did not initialize."));
      }
    };
    script.onerror = () => {
      script.remove();
      mapLibrePromise = null;
      reject(new Error("MapLibre could not be loaded."));
    };
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
  salons: sourceSalons,
  selectedSalonId,
  userCoordinates: sourceUserCoordinates,
}: ExploreMapProps) {
  const salons = useMemo(() => sourceSalons.filter(salon => hasValidCoordinates(salon)
    && !(salon.latitude === 0 && salon.longitude === 0)), [sourceSalons]);
  const userCoordinates = hasValidCoordinates(sourceUserCoordinates) ? sourceUserCoordinates : null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapLibreRef = useRef<MapLibreApi | null>(null);
  const markerRefs = useRef<MapLibreMarker[]>([]);
  const markerElementRefs = useRef(new Map<string, HTMLElement>());
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReadyToken, setMapReadyToken] = useState(0);
  const [markerReadyToken, setMarkerReadyToken] = useState(0);
  const initialSalonRef = useRef(salons[0]);
  const onSelectRef = useRef(onSelectSalon);
  const hasSalons = salons.length > 0;

  useEffect(() => { initialSalonRef.current = salons[0]; }, [salons]);
  useEffect(() => { onSelectRef.current = onSelectSalon; }, [onSelectSalon]);

  useEffect(() => {
    if (!containerRef.current || !maptilerKey || !hasSalons) {
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        const initialSalon = initialSalonRef.current;
        if (!initialSalon) return;
        const map = new maplibregl.Map({
          attributionControl: { compact: true },
          center: [initialSalon.longitude, initialSalon.latitude],
          container: containerRef.current,
          style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(
            maptilerKey,
          )}`,
          zoom: 10,
        });

        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "top-right",
        );
        map.on("error", () => {
          if (!cancelled) setMapError("Map tiles could not be loaded right now.");
        });
        map.on("load", () => { if (!cancelled) setMapError(null); });
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => map.resize());
          resizeObserver.observe(containerRef.current);
        }
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
      resizeObserver?.disconnect();
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      markerElementMap.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [maptilerKey, hasSalons]);

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
      element.addEventListener("click", () => onSelectRef.current?.(salon.id));

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
        offset: [0, -80],
      });
    } else if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        duration: 350,
        maxZoom: 13,
        padding: { top: 48, left: 32, right: 32, bottom: 220 },
      });
    }
    setMarkerReadyToken((token) => token + 1);
  }, [mapReadyToken, salons, userCoordinates]);

  useEffect(() => {
    for (const [salonId, element] of markerElementRefs.current) {
      // MapLibre markers live outside React; this keeps selection styling in sync without rebuilding markers.
      // eslint-disable-next-line react-hooks/immutability
      element.className = markerClass(salonId === selectedSalonId);
      element.setAttribute("aria-pressed", String(salonId === selectedSalonId));
    }
  }, [markerReadyToken, selectedSalonId]);

  useEffect(() => {
    const salon = salons.find(item => item.id === selectedSalonId);
    if (salon) mapRef.current?.easeTo({ center: [salon.longitude, salon.latitude], duration: 250, offset: [0, -80] });
  }, [selectedSalonId, salons, mapReadyToken]);

  const selectedSalon = salons.find((salon) => salon.id === selectedSalonId) ?? salons[0];

  return (
    <div className="relative h-full min-h-[22rem] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
      <div className="absolute inset-0" ref={containerRef} />
      {mapError || !maptilerKey || !hasSalons ? (
        <div className="absolute inset-x-3 top-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 shadow-sm">
          <WorkspaceText text={!hasSalons ? "No mapped salons in this area yet." : !maptilerKey ? "Map is unavailable right now." : mapError ?? "Map is unavailable right now."} />
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
                <SalonName name={selectedSalon.name} salonId={selectedSalon.id}/>
              </Link>
            ) : (
              <p className="line-clamp-1 min-w-0 text-sm font-semibold text-zinc-950">
                <SalonName name={selectedSalon.name} salonId={selectedSalon.id}/>
              </p>
            )}
            <SalonVerifiedBadge verified={selectedSalon.trust.identityVerified}/>
          </div>
          <div className="mt-2 flex gap-2"><ExploreSalonLove salonId={selectedSalon.id} name={selectedSalon.name}/><ExploreBookButton href={selectedSalon.bookingHref} name={selectedSalon.name} contactHref={selectedSalon.href} phoneHref={selectedSalon.phoneHref}/></div>
          <a className="mt-2 inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200" href={mapDirectionsUrl(selectedSalon)} target="_blank" rel="noopener noreferrer"><WorkspaceText text="Get directions" /></a>
          <SalonTrustLine signals={selectedSalon.trust} href={selectedSalon.href} name={selectedSalon.name} className="text-zinc-600"/>
          {salonPopularPrice(selectedSalon.trust)?<p className="text-[11px] leading-5 text-zinc-600">{salonPopularPrice(selectedSalon.trust)}</p>:null}
          <p className="mt-0.5 line-clamp-1 text-xs font-medium text-zinc-600">
            <SalonAddressLink address={selectedSalon.locationLabel ?? selectedSalon.name} coordinates={selectedSalon} />
            {selectedSalon.distanceMiles !== null ? ` · ${selectedSalon.distanceMiles < 10 ? selectedSalon.distanceMiles.toFixed(1) : Math.round(selectedSalon.distanceMiles)} mi` : null}
          </p>
          <SalonOperatingStatusBadge
            salonId={selectedSalon.id}
            className="mt-2 max-w-full"
            status={selectedSalon.operatingStatus}
          />
        </div>
      ) : null}
    </div>
  );
}
