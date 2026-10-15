"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useRememberedExperience } from "@/lib/use-remembered-experience";
import { getExperienceRouteKey, getExperienceRoutePolicy } from "@/lib/experience-route-policies";

const EMPTY_STATE = {};
const validEmptyState = (value: unknown): value is Record<string, never> => Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);

// Retain scroll only. Route authorization and current records stay independent.
export function canRememberNavigation(href: string): boolean {
  return getExperienceRoutePolicy(href).rememberUi;
}

export function ExperienceNavigation({ scope }: { scope: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const href = pathname + (search ? `?${search}` : "");
  const key = getExperienceRouteKey(href);
  useRememberedExperience({ namespace: "navigation", scope, key: key ?? "excluded" }, {
    value: EMPTY_STATE,
    validate: validEmptyState,
    onRestore: () => {},
    enabled: key !== null,
    restoreOnVisit: true,
  });
  return null;
}
