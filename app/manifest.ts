import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#ffffff",
    description: "Reylumi customer-facing POS checkout display.",
    display: "standalone",
    icons: [
      {
        src: "/brand/reylumi-favicon.png",
        sizes: "364x364",
        type: "image/png",
      },
      {
        src: "/apple-icon.png",
        sizes: "364x364",
        type: "image/png",
      },
    ],
    id: "/pos/customer-display",
    name: "Reylumi Customer Display",
    scope: "/pos/",
    short_name: "Reylumi Display",
    start_url: "/pos/customer-display/setup",
    theme_color: "#0f766e",
  };
}
