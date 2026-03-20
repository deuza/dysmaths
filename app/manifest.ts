import type {MetadataRoute} from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dysmaths",
    short_name: "Dysmaths",
    description: "Offline-first multilingual math writing workspace for school use.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fffefb",
    theme_color: "#1f2d3d",
    lang: "en",
    orientation: "portrait",
    icons: [
      {
        src: "/pwa-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/pwa-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      }
    ]
  };
}
