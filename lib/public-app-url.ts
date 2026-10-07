export const REYLUMI_PUBLIC_APP_URL = "https://reylumi.com";

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" || hostname === "[::1]";
}

export function getPublicAppOrigin() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_APP_URL?.trim() || REYLUMI_PUBLIC_APP_URL);
    if (!url.username && !url.password &&
      (url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:")) &&
      (process.env.NODE_ENV !== "production" || !isLocalHostname(url.hostname))) return url.origin;
  } catch { /* Use the public website when configuration is invalid. */ }
  return REYLUMI_PUBLIC_APP_URL;
}

// Older salon settings may still contain a download URL saved during local development.
export function normalizePublicDownloadUrl(value: string) {
  try {
    const url = new URL(value);
    if (isLocalHostname(url.hostname)) {
      return new URL(url.pathname + url.search + url.hash, getPublicAppOrigin()).href;
    }
  } catch { /* The caller validates other URL formats. */ }
  return value;
}
