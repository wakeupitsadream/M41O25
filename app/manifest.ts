import type { MetadataRoute } from "next";

/**
 * start_url и scope — только относительные пути. Абсолютный адрес здесь означал бы, что preview-сборка
 * ставит на домашний экран ярлык на production (и наоборот), а превью-проверки уводят на боевые данные.
 * Установленное приложение остаётся на своём домене; о том, что домен не рабочий, предупреждает
 * WrongOriginNotice на экране входа — до установки, а не после.
 */
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
