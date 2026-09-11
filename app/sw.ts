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
 *
 * Отдельно про /api/health: под правила ниже он не попадает (не навигация, не /api/schedule, не статика) и обязан
 * не попадать впредь — проверка «сервер жив» с экрана ошибки должна каждый раз реально ходить в сеть, иначе
 * она бодро ответит из кеша над лежащим сервером. Fallback /~offline тоже мимо: он только для document-запросов.
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

/**
 * Пуш-уведомления (Web Push). На iPhone это работает только у приложения, поставленного на «Домой», и только с iOS 16.4.
 * Показать уведомление обязаны всегда: iOS отзывает разрешение у приложения, которое получило пуш и промолчало.
 * Поэтому при кривом или пустом payload показываем нейтральный текст, а не выходим молча.
 */
type PushBody = { title?: string; body?: string; url?: string; tag?: string };

self.addEventListener("push", (event) => {
  let data: PushBody = {};
  try {
    data = (event.data?.json() as PushBody) ?? {};
  } catch {
    const text = event.data?.text();
    if (text) data = { body: text };
  }
  const title = data.title || "Raspison";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Что-то новое в группе",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "raspison",
      data: { url },
    }),
  );
});

/** Тап по уведомлению: открытую вкладку приложения переиспользуем (на iPhone она обычно уже есть), иначе открываем новую. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  const url = typeof data?.url === "string" && data.url.startsWith("/") ? data.url : "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

serwist.addEventListeners();
