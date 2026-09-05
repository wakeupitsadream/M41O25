import type { PrecacheEntry, SerwistGlobalConfig, SerwistPlugin } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Service worker намеренно узкий: precache сборки, HTML-навигации и /api/schedule для офлайна, статика.
 * RSC-ответы (клиентская навигация, server actions) и остальные API через SW НЕ проходят — им нечего делать
 * в кеше, а лишний перехват потоковых ответов только затрудняет диагностику (см. CLAUDE.md, «зависание навигации»).
 */
/**
 * Ответ из кеша помечаем заголовком: страница узнаёт, что данные не с сервера, даже когда navigator.onLine врёт
 * (iOS на wifi без интернета, headless-браузеры). Сам кеш не меняется — заголовок только у копии для страницы.
 */
const markFromCache: SerwistPlugin = {
  cachedResponseWillBeUsed: async ({ cachedResponse }) => {
    if (!cachedResponse) return cachedResponse;
    const headers = new Headers(cachedResponse.headers);
    headers.set("x-raspison-cache", "1");
    return new Response(cachedResponse.body, { status: cachedResponse.status, statusText: cachedResponse.statusText, headers });
  },
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // Документы (только GET-навигации): свежая версия из сети, при плохой связи через 8 с — последняя сохранённая
      // (холодный старт функции + пробуждение Neon утром укладываются в это окно; офлайн срабатывает сразу по ошибке сети).
      matcher: ({ request, sameOrigin }) => sameOrigin && request.method === "GET" && request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "raspison-pages",
        networkTimeoutSeconds: 8,
        plugins: [new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 14 })],
      }),
    },
    {
      // Расписание: в универе связь плохая — 6 секунд ждём сеть, потом отдаём последнюю сохранённую версию.
      matcher: ({ url, sameOrigin, request }) => sameOrigin && request.method === "GET" && url.pathname.startsWith("/api/schedule"),
      handler: new NetworkFirst({
        cacheName: "raspison-schedule",
        networkTimeoutSeconds: 6,
        plugins: [new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 }), markFromCache],
      }),
    },
    {
      // Статика сборки с хешами в имени и иконки: неизменяемы, берём из кеша.
      matcher: ({ url, sameOrigin, request }) => sameOrigin && request.method === "GET" && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")),
      handler: new CacheFirst({
        cacheName: "raspison-static",
        plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })],
      }),
    },
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
