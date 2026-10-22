// Only the local bundle builder can opt in. No URL, localStorage value, server
// payload or production environment variable activates this installed surface.
declare const __REYLUMI_SERVICES_CATALOG_QA__: boolean | undefined;
export function servicesCatalogNativePilotEnabled(): boolean {
  return typeof __REYLUMI_SERVICES_CATALOG_QA__ !== "undefined" && __REYLUMI_SERVICES_CATALOG_QA__ === true;
}
