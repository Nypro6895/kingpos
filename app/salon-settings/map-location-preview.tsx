"use client";

import dynamic from "next/dynamic";
import type { ExploreMapSalon } from "@/types/explore";
import type { Coordinates } from "@/types/location";

const ExploreMap = dynamic(
  () => import("@/app/explore/explore-map").then((mod) => mod.ExploreMap),
  {
    loading: () => (
      <div className="grid min-h-[16rem] place-items-center rounded-lg border border-zinc-200 bg-zinc-100 text-sm font-medium text-zinc-500">
        Loading map
      </div>
    ),
    ssr: false,
  },
);

const MAPTILER_BROWSER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() ?? "";

export function MapLocationPreview({
  coordinates,
  locationLabel,
  salonName,
}: {
  coordinates: Coordinates;
  locationLabel: string | null;
  salonName: string;
}) {
  if (!MAPTILER_BROWSER_KEY) {
    return null;
  }

  const salon: ExploreMapSalon = {
    coverImageUrl: null,
    distanceMiles: null,
    href: null,
    id: "current-salon",
    latitude: coordinates.latitude,
    locationLabel,
    longitude: coordinates.longitude,
    name: salonName,
    serviceLabel: null,
  };

  return (
    <div className="grid gap-2">
      <p className="text-xs font-semibold uppercase text-zinc-500">
        Map preview
      </p>
      <ExploreMap
        maptilerKey={MAPTILER_BROWSER_KEY}
        salons={[salon]}
        selectedSalonId={salon.id}
      />
    </div>
  );
}
