import { readFile } from "node:fs/promises";
import path from "node:path";
import mapLibrePackage from "maplibre-gl/package.json";
import { MAPLIBRE_ASSET_VERSION } from "./maplibre-assets";

export async function mapLibreVendorResponse(version: string, immutable: boolean) {
  if (version !== MAPLIBRE_ASSET_VERSION || mapLibrePackage.version !== MAPLIBRE_ASSET_VERSION) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const body = await readFile(path.join(process.cwd(), "node_modules", "maplibre-gl", "dist", "maplibre-gl.js"));
  return new Response(body, { headers: {
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-store",
    "Content-Type": "text/javascript; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  } });
}
