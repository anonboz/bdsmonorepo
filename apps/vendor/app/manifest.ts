import type { MetadataRoute } from "next";

// Colors approximate @repo/ui's theme.css light tokens (--primary, --background)
// converted from HSL — retune to the exact brand palette once one exists.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vendor — House Renting",
    short_name: "Vendor",
    description: "Contractor dashboard: work orders, schedule, profile.",
    start_url: "/",
    display: "standalone",
    background_color: "#fdfdfc",
    theme_color: "#1f8e66",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icons/icon-maskable.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
