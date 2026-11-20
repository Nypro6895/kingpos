import { MAPLIBRE_ASSET_VERSION } from "@/lib/maplibre-assets";
import { mapLibreVendorResponse } from "@/lib/maplibre-vendor";


export async function GET() {
  // Older/native clients still use this URL. New clients use a versioned URL;
  // do not create another year-long cache entry at the compatibility endpoint.
  return mapLibreVendorResponse(MAPLIBRE_ASSET_VERSION, false);
}
