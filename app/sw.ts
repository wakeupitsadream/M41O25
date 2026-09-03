import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // Документы (навигации): свежая версия из сети, при плохой связи через 8 с — последняя сохранённая
      // (холодный старт функции + пробуждение Neon утром укладываются в это окно; офлайн срабатывает сразу по ошибке сети).
      matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "raspison-pages",
        networkTimeoutSeconds: 8,
        plugins: [new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 14 })],
      }),
    },
    {
      // Расписание: в универе связь плохая — 6 секунд ждём сеть, потом отдаём последнюю сохранённую версию.
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/schedule"),
      handler: new NetworkFirst({
        cacheName: "raspison-schedule",
        networkTimeoutSeconds: 6,
        plugins: [new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 })],
      }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
