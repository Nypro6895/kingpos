// Pin the URL to the audited package revision so old immutable browser caches
// cannot keep serving a vulnerable library after a dependency update.
export const MAPLIBRE_ASSET_VERSION = "5.24.1";
export const MAPLIBRE_SCRIPT_URL = `/api/vendor/maplibre-gl/${MAPLIBRE_ASSET_VERSION}.js`;
