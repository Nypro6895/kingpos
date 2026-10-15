import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#ffffff",
    description: "Reylumi beauty booking and salon workspace",
    display: "standalone",
    icons: [
      {
        src: "/brand/reylumi-app-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/reylumi-app-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    id: "/",
    name: "Reylumi",
    scope: "/",
    short_name: "Reylumi",
    start_url: "/",
    theme_color: "#0f766e",
  };
}
