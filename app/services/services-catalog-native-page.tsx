"use client";

import { useLayoutEffect } from "react";
import type { AppLocalPageProps } from "@/lib/app-local-page-registry";
import { observeServicesCatalogScope } from "@/lib/services-catalog-runtime";
import { ServicesCatalogPilot } from "./services-catalog-pilot";

/** Registry admission controls mounting; the catalog separately checks services.view. */
export function ServicesCatalogNativePage({ context, path, host }: AppLocalPageProps) {
  const scope = context?.context.scope;
  useLayoutEffect(() => {
    observeServicesCatalogScope(scope ?? null);
    return () => observeServicesCatalogScope(null);
  }, [scope]);
  return scope ? <ServicesCatalogPilot scope={scope} serviceId={new URL(path, "https://reylumi.com").searchParams.get("service")} host={host} /> : null;
}
