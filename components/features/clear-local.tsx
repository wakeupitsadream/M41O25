"use client";

import { useEffect } from "react";

/** На экране входа сессии нет — вычищаем кеш прошлого пользователя (расписание в localStorage и кеши service worker). */
export function ClearLocal() {
  useEffect(() => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("raspison.schedule"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
    if ("caches" in window) {
      // Не только наши raspison-*: defaultCache Serwist держит RSC-страницы и ответы /api/* (в т.ч. файлы) прошлого пользователя.
      void caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.includes("precache")).map((k) => caches.delete(k))));
    }
  }, []);
  return null;
}
