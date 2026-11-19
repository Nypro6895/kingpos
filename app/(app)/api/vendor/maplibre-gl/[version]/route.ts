import { mapLibreVendorResponse } from "@/lib/maplibre-vendor";

export async function GET(_request: Request, context: { params: Promise<{ version: string }> }) {
  const { version } = await context.params;
  // A .js suffix also works with the installed bundle's existing MIME rules.
  return mapLibreVendorResponse(version.endsWith(".js") ? version.slice(0, -3) : version, true);
}
