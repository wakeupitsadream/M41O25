"use client";

import { useEffect } from "react";

/**
 * На экране входа сессии нет — вычищаем данные прошлого пользователя: расписание и отметки просмотра вкладок
 * в localStorage плюс кеши service worker. Подсказку установки и отметку баннера дней рождения не трогаем:
 * они про устройство, а не про человека, и всплывали бы заново после каждой протухшей сессии.
 */
export function ClearLocal() {
  useEffect(() => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("raspison.schedule") || k.startsWith("raspison.tab.seen."))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
    if ("caches" in window) {
      // Не только наши raspison-*: defaultCache Serwist держит RSC-страницы и ответы /api/* (в т.ч. файлы) прошлого пользователя.
      void caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.includes("precache")).map((k) => caches.delete(k))));
    }
  }, []);
  return null;
}
