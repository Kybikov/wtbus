import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/driver",
    name: "Vivat Bus",
    short_name: "Vivat Bus",
    description: "Рейсы, бронирования и управление перевозками.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1f1f1b",
    theme_color: "#1f1f1b",
    icons: [
      {
        src: "/icon/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
