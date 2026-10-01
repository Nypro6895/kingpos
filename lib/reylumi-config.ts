export const REYLUMI_APP_NAME = "ReyLUMI";
export const REYLUMI_COPYRIGHT_YEAR = 2026;
export const REYLUMI_LOCAL_APP_URL = "http://localhost:3000";

function resolveReylumiAppUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configuredUrl) {
    try {
      const url = new URL(configuredUrl);

      if (url.protocol === "http:" || url.protocol === "https:") {
        return url;
      }
    } catch {
      // Fall back to a local absolute URL when the public app URL is unset or invalid.
    }
  }

  return new URL(REYLUMI_LOCAL_APP_URL);
}

export const REYLUMI_METADATA_BASE = resolveReylumiAppUrl();

export const LEGAL_EFFECTIVE_DATE = "August 21, 2026";
export const LEGAL_LAST_UPDATED = "August 21, 2026";

export const LEGAL_ROUTE_PATHS = [
  "/legal",
  "/terms",
  "/privacy",
  "/community",
  "/business-terms",
] as const;

export const LEGAL_FOOTER_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/community", label: "Community Standards" },
  { href: "/legal", label: "Legal" },
] as const;

export function isLegalRoutePath(pathname: string) {
  return LEGAL_ROUTE_PATHS.some((path) => pathname === path);
}
