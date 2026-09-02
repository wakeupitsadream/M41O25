import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Raspison",
    short_name: "Raspison",
    description: "Расписание, домашка и жизнь группы — в одном месте",
    lang: "ru",
    start_url: "/s",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0e",
    theme_color: "#0a0a0e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
