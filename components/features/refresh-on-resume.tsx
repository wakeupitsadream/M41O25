"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { sectionOfPath } from "@/lib/group/unread";

/**
 * iOS держит установленную PWA замороженной сутками: при возвращении на экран после долгой паузы,
 * при появлении сети и при восстановлении из bfcache перечитываем данные страницы (RSC), иначе
 * домашка и лента показывают вчерашнее. Расписание обновляется своим хуком (components/schedule/use-schedule.ts:
 * те же visibilitychange и online плюс интервал), поэтому на /s router.refresh() не делаем — иначе один возврат
 * в приложение стоил бы трёх запросов одних и тех же данных (ревью PERF-03).
 */
export function RefreshOnResume({ minHiddenMs = 60_000 }: { minHiddenMs?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    if (sectionOfPath(pathname) === "schedule") return;
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
  }, [router, pathname, minHiddenMs]);

  return null;
}
