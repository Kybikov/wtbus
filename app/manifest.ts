import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/driver",
    name: "Vivat Bus — водительское приложение",
    short_name: "Vivat Bus",
    description: "Водительское приложение Vivat Bus для передачи геолокации.",
    start_url: "/driver",
    scope: "/",
    display: "standalone",
    background_color: "#1f1f1b",
    theme_color: "#1f1f1b",
    icons: [
      {
        src: "/brand/vivat-bus.png",
        sizes: "1280x1280",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/vivat-bus.png",
        sizes: "1280x1280",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
