"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { mapDirectionsUrl } from "@/lib/location/map-links";
import type { Coordinates } from "@/types/location";

const subscribe = () => () => {};
const isAppleDevice = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
const serverSnapshot = () => false;

/** A real anchor keeps keyboard, copy-link and browser fallback behavior. */
export function SalonAddressLink({ address, coordinates, children, className }: {
  address: string; coordinates?: Coordinates; children?: ReactNode; className?: string;
}) {
  const apple = useSyncExternalStore(subscribe, isAppleDevice, serverSnapshot);
  const href = mapDirectionsUrl(coordinates ?? address, apple);
  if (!href) return null;
  return <a href={href} className={className ?? "underline decoration-current/30 underline-offset-4 hover:decoration-current"}>
    {children ?? address}
  </a>;
}
