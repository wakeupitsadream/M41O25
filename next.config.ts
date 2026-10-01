import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Serwist собирается только webpack-сборкой; в dev (turbopack) service worker отключён.
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: false,
  // Страница офлайн-фолбэка должна лежать в precache, иначе fallbacks никогда не сработает.
  additionalPrecacheEntries: [{ url: "/~offline", revision: process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now()) }],
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next 16 при `next dev` дописывает свой блок правил для ИИ-агентов прямо в CLAUDE.md проекта — он у нас свой.
  // Единственное полезное из того блока: актуальная документация Next лежит в node_modules/next/dist/docs/.
  agentRules: false,
  // web-push — обычный node-пакет (crypto, https, опциональные зависимости): пусть остаётся внешним, а не идёт в бандл.
  // unpdf, jszip — извлечение текста из вложений помощника (lib/assistant/extract.ts): тяжёлые, с динамическими
  // require и worker-ами, в бандле ломаются или раздувают функцию.
  serverExternalPackages: ["web-push", "unpdf", "jszip"],
  images: { unoptimized: true },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        // Во фрейме чужого сайта приложению делать нечего (SameSite=Lax и так не отдаст туда cookie — это защита в глубину).
        { key: "X-Frame-Options", value: "DENY" },
        // Камеру и геолокацию приложение не запрашивает: файл выбирается системным пикером, погода — по координатам Оренбурга.
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
      ],
    },
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
  ],
};

export default withSerwist(nextConfig);
