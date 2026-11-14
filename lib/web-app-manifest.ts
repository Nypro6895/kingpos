import type { MetadataRoute } from "next";

/** Stable identities let the main site and Portable be installed separately. */
export function webAppManifest(portable = false): MetadataRoute.Manifest {
  return {
    background_color: portable ? "#f4f4f5" : "#ffffff",
    description: portable
      ? "Reylumi POS Portable salon workspace"
      : "Reylumi beauty booking and salon workspace",
    display: "standalone",
    icons: [
      { src: "/brand/reylumi-app-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/reylumi-app-512.png", sizes: "512x512", type: "image/png" },
    ],
    id: portable ? "/pos/portable" : "/",
    name: portable ? "Reylumi POS Portable" : "Reylumi",
    scope: portable ? "/pos/portable" : "/",
    short_name: portable ? "Reylumi POS" : "Reylumi",
    start_url: portable ? "/pos/portable" : "/",
    theme_color: "#0f766e",
  };
}

export function webAppManifestResponse(portable = false) {
  return new Response(JSON.stringify(webAppManifest(portable)), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
