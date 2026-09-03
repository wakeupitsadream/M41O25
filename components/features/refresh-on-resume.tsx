"use client";

import { useEffect, useRef } from "react";
import { useGuardedRouter } from "@/components/features/nav-guard";

/**
 * iOS держит установленную PWA замороженной сутками: при возвращении на экран после долгой паузы,
 * при появлении сети и при восстановлении из bfcache перечитываем данные страницы (RSC), иначе
 * домашка и лента показывают вчерашнее. Расписание обновляется своим хуком, здесь его не трогаем.
 */
export function RefreshOnResume({ minHiddenMs = 60_000 }: { minHiddenMs?: number }) {
  const router = useGuardedRouter();
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      if (hiddenAt.current !== null && Date.now() - hiddenAt.current >= minHiddenMs && !typing()) router.refresh();
      hiddenAt.current = null;
    };
    const onOnline = () => {
      if (!typing()) router.refresh();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && !typing()) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router, minHiddenMs]);

  return null;
}
